// Multi-API Manager v2 — OmniRoute-style router: Groq -> Gemini -> Hugging Face -> Cohere
// (Workers AI backup lives in ai.js).
//
// What is new vs v1 (all verified against provider docs, Oct 2026):
//  * Model lists updated: Groq retired llama-3.3-70b / llama-3.1-8b (16 Aug 2026), Gemini 1.5/2.0 are gone,
//    api-inference.huggingface.co is decommissioned (router.huggingface.co/v1 now), Cohere moved to /v2/chat.
//  * Every provider tries its model list in order (model-level failover), not just the first model.
//  * System prompt is kept for every provider (Gemini systemInstruction, Cohere v2 messages).
//  * API key for Gemini goes in a header, never in the URL (URLs end up in logs).
//  * Smart cooldown: 401/403 (bad key), 402 (credits over), 429 (rate limit) park that provider for a while,
//    so the next request does not waste time on it.
//  * 25s timeout per call. temperature 0 is respected. Usage counter is serialised (no lost counts).
//  * Models, order and soft daily limits can be changed from wrangler vars, no code edit needed:
//    API_ORDER, GROQ_MODELS, GEMINI_MODELS, HUGGINGFACE_MODELS, COHERE_MODELS, <PROVIDER>_DAILY_LIMIT, API_TIMEOUT_MS

export const API_CONFIGS = {
  groq: {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'],
    dailyLimit: 1000,
    style: 'conversational'
  },
  gemini: {
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'],
    dailyLimit: 250,
    style: 'informative'
  },
  huggingface: {
    name: 'Hugging Face',
    endpoint: 'https://router.huggingface.co/v1/chat/completions',
    models: ['openai/gpt-oss-120b', 'meta-llama/Llama-3.3-70B-Instruct'],
    dailyLimit: 50,
    style: 'detailed'
  },
  cohere: {
    name: 'Cohere',
    endpoint: 'https://api.cohere.com/v2/chat',
    models: ['command-a-03-2025', 'command-r-08-2024'],
    dailyLimit: 30,
    style: 'professional'
  }
};

const DEFAULT_ORDER = ['groq', 'gemini', 'huggingface', 'cohere'];
const ENV_KEY = { groq: 'GROQ', gemini: 'GEMINI', huggingface: 'HUGGINGFACE', cohere: 'COHERE' };

const parseList = (v) => (typeof v === 'string' && v.trim() ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);

export function configFor(env, provider) {
  const base = API_CONFIGS[provider];
  const k = ENV_KEY[provider];
  return {
    ...base,
    models: parseList(env && env[`${k}_MODELS`]) || base.models,
    dailyLimit: Number(env && env[`${k}_DAILY_LIMIT`]) || base.dailyLimit
  };
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// One write at a time inside an isolate -> the usage counter does not lose counts when calls overlap.
let writeChain = Promise.resolve();
const serialize = (fn) => {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => {});
  return run;
};

const MIN = 60 * 1000;
const COOLDOWN_MS = { auth: 180 * MIN, credits: 360 * MIN, rate: 10 * MIN };

export class MultiAPIManager {
  constructor(env) {
    this.env = env || {};
    this.apiKeys = {
      groq: this.env.GROQ_API_KEY,
      gemini: this.env.GEMINI_API_KEY,
      huggingface: this.env.HUGGINGFACE_API_KEY,
      cohere: this.env.COHERE_API_KEY
    };
    const order = (parseList(this.env.API_ORDER) || DEFAULT_ORDER).filter((p) => API_CONFIGS[p]);
    this.order = order.length ? order : DEFAULT_ORDER;
    this.timeoutMs = Number(this.env.API_TIMEOUT_MS) || 25000;
  }

  // ---------- usage (KV) ----------
  today() {
    return new Date().toISOString().split('T')[0];
  }

  async getUsageStats() {
    try {
      const stats = await this.env.API_USAGE?.get(`usage:${this.today()}`);
      return stats ? JSON.parse(stats) : {};
    } catch {
      return {};
    }
  }

  async saveUsageStats(stats) {
    try {
      await this.env.API_USAGE?.put(`usage:${this.today()}`, JSON.stringify(stats), { expirationTtl: 86400 * 2 });
    } catch (e) {
      console.error('Failed to save usage stats:', e && e.message);
    }
  }

  trackUsage(provider, tokens = 1) {
    return serialize(async () => {
      const stats = await this.getUsageStats();
      if (!stats[provider]) stats[provider] = { requests: 0, tokens: 0 };
      stats[provider].requests++;
      stats[provider].tokens += tokens;
      await this.saveUsageStats(stats);
      return stats[provider];
    });
  }

  // ---------- cooldown (KV) ----------
  async getCooldownUntil(provider) {
    try {
      const v = await this.env.API_USAGE?.get(`cooldown:${provider}`);
      const until = Number(v);
      return Number.isFinite(until) ? until : 0;
    } catch {
      return 0;
    }
  }

  async setCooldown(provider, ms) {
    try {
      await this.env.API_USAGE?.put(`cooldown:${provider}`, String(Date.now() + ms), {
        expirationTtl: Math.max(60, Math.ceil(ms / 1000))
      });
    } catch (e) {
      console.error('Failed to save cooldown:', e && e.message);
    }
  }

  // Is this provider usable right now? (daily soft limit + cooldown)
  async isAvailable(provider, stats) {
    const config = configFor(this.env, provider);
    const s = stats || (await this.getUsageStats());
    const used = s[provider]?.requests || 0;
    if (used >= config.dailyLimit) {
      return { available: false, reason: `Daily limit reached (${used}/${config.dailyLimit})` };
    }
    const until = await this.getCooldownUntil(provider);
    if (until > Date.now()) {
      return { available: false, reason: `Cooling down (${Math.ceil((until - Date.now()) / MIN)} min)` };
    }
    return { available: true };
  }

  // ---------- low level ----------
  async _post(url, headers, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 140); } catch { /* ignore */ }
        throw new ApiError(`${res.status} ${res.statusText || ''}${detail ? ' - ' + detail : ''}`.trim(), res.status);
      }
      return await res.json();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new ApiError(`timeout (${this.timeoutMs} ms)`, 408);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Try the provider's models in order. Bad key / no credits stop immediately (other models will fail the same way).
  async _tryModels(provider, options, run) {
    const models = options.model ? [options.model] : configFor(this.env, provider).models;
    const errors = [];
    let lastStatus = 0;
    for (const model of models) {
      try {
        return await run(model);
      } catch (e) {
        lastStatus = e.status || 0;
        errors.push(`${model}: ${e.message}`);
        if ([401, 402, 403, 408].includes(lastStatus)) break;
      }
    }
    const err = new Error(errors.join(' | '));
    err.status = lastStatus;
    throw err;
  }

  _temp(options) { return options.temperature ?? 0.7; }
  _max(options) { return options.max_tokens ?? 1200; }

  // OpenAI-compatible body (Groq, Hugging Face router)
  _openaiResult(data, provider, model) {
    const choice = data.choices?.[0];
    const text = choice?.message?.content || '';
    if (!text.trim()) throw new ApiError(`empty response (finish=${choice?.finish_reason || '?'})`, 502);
    return { text, tokens: data.usage?.total_tokens || 0, provider, model };
  }

  // ---------- providers ----------
  async callGroq(messages, options = {}) {
    const config = configFor(this.env, 'groq');
    const headers = { Authorization: `Bearer ${this.apiKeys.groq}` };
    return this._tryModels('groq', options, async (model) => {
      const base = { model, messages, temperature: this._temp(options), max_tokens: this._max(options) };
      const reasoning = /gpt-oss/i.test(model) ? { ...base, reasoning_effort: 'low' } : null;
      let data;
      try {
        data = await this._post(config.endpoint, headers, reasoning || base);
      } catch (e) {
        if (reasoning && e.status === 400) data = await this._post(config.endpoint, headers, base);
        else throw e;
      }
      return this._openaiResult(data, 'groq', model);
    });
  }

  async callGemini(messages, options = {}) {
    const config = configFor(this.env, 'gemini');
    const headers = { 'x-goog-api-key': this.apiKeys.gemini };
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] }));
    return this._tryModels('gemini', options, async (model) => {
      const body = {
        contents,
        generationConfig: { temperature: this._temp(options), maxOutputTokens: this._max(options) }
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const data = await this._post(`${config.endpoint}/${model}:generateContent`, headers, body);
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
      if (!text.trim()) {
        throw new ApiError(`empty response (${cand?.finishReason || data.promptFeedback?.blockReason || '?'})`, 502);
      }
      return { text, tokens: data.usageMetadata?.totalTokenCount || 0, provider: 'gemini', model };
    });
  }

  async callHuggingFace(messages, options = {}) {
    const config = configFor(this.env, 'huggingface');
    const headers = { Authorization: `Bearer ${this.apiKeys.huggingface}` };
    return this._tryModels('huggingface', options, async (model) => {
      const data = await this._post(config.endpoint, headers, {
        model, messages, temperature: this._temp(options), max_tokens: this._max(options)
      });
      return this._openaiResult(data, 'huggingface', model);
    });
  }

  async callCohere(messages, options = {}) {
    const config = configFor(this.env, 'cohere');
    const headers = { Authorization: `Bearer ${this.apiKeys.cohere}` };
    const msgs = messages.map((m) => ({ role: m.role, content: String(m.content) }));
    return this._tryModels('cohere', options, async (model) => {
      const data = await this._post(config.endpoint, headers, {
        model, messages: msgs, temperature: this._temp(options), max_tokens: this._max(options)
      });
      const parts = Array.isArray(data.message?.content) ? data.message.content : [];
      const text = parts.filter((p) => p && p.type !== 'thinking').map((p) => p.text || '').join('') || data.text || '';
      if (!text.trim()) throw new ApiError(`empty response (${data.finish_reason || '?'})`, 502);
      return {
        text,
        tokens: data.usage?.tokens?.output_tokens || data.usage?.billed_units?.output_tokens || 0,
        provider: 'cohere',
        model
      };
    });
  }

  // ---------- main entry ----------
  async generate(messages, options = {}) {
    const errors = [];
    const stats = await this.getUsageStats(); // one KV read for the whole round
    const callers = {
      groq: (m, o) => this.callGroq(m, o),
      gemini: (m, o) => this.callGemini(m, o),
      huggingface: (m, o) => this.callHuggingFace(m, o),
      cohere: (m, o) => this.callCohere(m, o)
    };

    for (const provider of this.order) {
      if (!this.apiKeys[provider]) {
        errors.push(`${provider}: API key not configured`);
        continue;
      }
      const availability = await this.isAvailable(provider, stats);
      if (!availability.available) {
        errors.push(`${provider}: ${availability.reason}`);
        continue;
      }
      try {
        const result = await callers[provider](messages, options);
        await this.trackUsage(provider, result.tokens);
        return { text: result.text, provider: result.provider, model: result.model, tokens: result.tokens, errors };
      } catch (e) {
        errors.push(`${provider}: ${e.message}`);
        if ([401, 403].includes(e.status)) await this.setCooldown(provider, COOLDOWN_MS.auth);
        else if (e.status === 402) await this.setCooldown(provider, COOLDOWN_MS.credits);
        else if (e.status === 429) await this.setCooldown(provider, COOLDOWN_MS.rate);
      }
    }
    return { text: '', provider: null, model: null, tokens: 0, errors };
  }

  // ---------- dashboard ----------
  async getStatus() {
    const stats = await this.getUsageStats();
    const status = {};
    for (const provider of this.order) {
      const config = configFor(this.env, provider);
      const usage = stats[provider] || { requests: 0, tokens: 0 };
      const availability = await this.isAvailable(provider, stats);
      status[provider] = {
        name: config.name,
        available: availability.available,
        reason: availability.reason || 'Available',
        requests: usage.requests,
        tokens: usage.tokens,
        limit: config.dailyLimit,
        models: config.models,
        hasApiKey: !!this.apiKeys[provider]
      };
    }
    return status;
  }
}

// Helper for backward compatibility
export async function runAI(env, messages, opts = {}) {
  const manager = new MultiAPIManager(env);
  const result = await manager.generate(messages, opts);
  return {
    text: result.text,
    model: result.model || 'unknown',
    provider: result.provider || 'none',
    errors: result.errors || [],
    tokens: result.tokens || 0
  };
}
