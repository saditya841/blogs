import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MultiAPIManager, API_CONFIGS, configFor } from '../../src/multi-api-manager.js';

const MIN = 60 * 1000;

class FakeKV {
  constructor() {
    this.map = new Map();
  }
  async get(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  async put(k, v) {
    this.map.set(k, v);
  }
}

const success = (json) => ({ ok: true, status: 200, json: async () => json });
const failure = (status, text = 'error') => ({
  ok: false,
  status,
  statusText: 'Error',
  text: async () => text,
});

describe('configFor — settings from wrangler vars', () => {
  test('defaults come from API_CONFIGS', () => {
    assert.deepEqual(configFor({}, 'groq'), API_CONFIGS.groq);
    assert.equal(configFor({}, 'gemini').dailyLimit, 250);
  });

  test('model list and daily limit can be overridden per provider', () => {
    const c = configFor({ GROQ_MODELS: 'a, b ,c', GROQ_DAILY_LIMIT: '7' }, 'groq');
    assert.deepEqual(c.models, ['a', 'b', 'c']);
    assert.equal(c.dailyLimit, 7);
  });

  test('an empty or invalid override falls back to the default', () => {
    assert.deepEqual(configFor({ GEMINI_MODELS: '   ' }, 'gemini').models, API_CONFIGS.gemini.models);
    assert.equal(configFor({ GEMINI_DAILY_LIMIT: 'abc' }, 'gemini').dailyLimit, 250);
  });
});

describe('constructor — provider order and keys', () => {
  test('unknown providers are ignored and the rest keep their order', () => {
    const m = new MultiAPIManager({ API_ORDER: 'cohere, nope, groq' });
    assert.deepEqual(m.order, ['cohere', 'groq']);
  });

  test('an all-invalid order falls back to the full default order', () => {
    assert.deepEqual(new MultiAPIManager({ API_ORDER: 'nope' }).order, ['groq', 'gemini', 'huggingface', 'cohere']);
    assert.deepEqual(new MultiAPIManager({}).order, ['groq', 'gemini', 'huggingface', 'cohere']);
  });

  test('API keys are read from the matching env vars', () => {
    const m = new MultiAPIManager({ GROQ_API_KEY: 'g', COHERE_API_KEY: 'c' });
    assert.equal(m.apiKeys.groq, 'g');
    assert.equal(m.apiKeys.cohere, 'c');
    assert.equal(m.apiKeys.gemini, undefined);
  });

  test('a custom timeout is honoured', () => {
    assert.equal(new MultiAPIManager({}).timeoutMs, 25000);
    assert.equal(new MultiAPIManager({ API_TIMEOUT_MS: '1000' }).timeoutMs, 1000);
  });
});

describe('availability — daily soft limit and cooldown', () => {
  test('a fresh provider is available', async () => {
    const m = new MultiAPIManager({ API_USAGE: new FakeKV() });
    assert.deepEqual(await m.isAvailable('groq'), { available: true });
  });

  test('the daily limit blocks the provider', async () => {
    const kv = new FakeKV();
    await kv.put(`usage:${new Date().toISOString().split('T')[0]}`, JSON.stringify({ groq: { requests: 1000, tokens: 0 } }));
    const m = new MultiAPIManager({ API_USAGE: kv });
    const r = await m.isAvailable('groq');
    assert.equal(r.available, false);
    assert.match(r.reason, /Daily limit/);
  });

  test('a future cooldown blocks the provider, a past one does not', async () => {
    const kv = new FakeKV();
    await kv.put('cooldown:groq', String(Date.now() + 5 * MIN));
    const m = new MultiAPIManager({ API_USAGE: kv });
    assert.match((await m.isAvailable('groq')).reason, /Cooling down/);

    await kv.put('cooldown:groq', String(Date.now() - 5 * MIN));
    assert.equal((await m.isAvailable('groq')).available, true);
  });

  test('setCooldown stores a future timestamp', async () => {
    const kv = new FakeKV();
    const m = new MultiAPIManager({ API_USAGE: kv });
    await m.setCooldown('groq', 5000);
    assert.ok(Number(await kv.get('cooldown:groq')) > Date.now() + 4000);
  });
});

describe('usage tracking', () => {
  test('two overlapping calls are both counted (serialised writes)', async () => {
    const kv = new FakeKV();
    const m = new MultiAPIManager({ API_USAGE: kv });
    await Promise.all([m.trackUsage('groq', 2), m.trackUsage('groq', 3)]);
    assert.deepEqual(await m.getUsageStats(), { groq: { requests: 2, tokens: 5 } });
  });

  test('a missing KV binding never throws', async () => {
    const m = new MultiAPIManager({});
    assert.deepEqual(await m.getUsageStats(), {});
    assert.equal((await m.isAvailable('groq')).available, true);
    await m.saveUsageStats({ x: 1 });
  });
});

describe('generate — provider routing', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('with no keys every provider is reported and nothing is fetched', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error('should not fetch');
    };
    const r = await new MultiAPIManager({}).generate([{ role: 'user', content: 'hi' }]);
    assert.equal(r.text, '');
    assert.equal(r.provider, null);
    assert.equal(calls, 0);
    assert.equal(r.errors.filter((e) => /API key not configured/.test(e)).length, 4);
  });

  test('a successful Groq call is returned and counted', async () => {
    const kv = new FakeKV();
    const env = { API_USAGE: kv, API_ORDER: 'groq', GROQ_API_KEY: 'k' };
    globalThis.fetch = async (url, init) => {
      assert.match(url, /api\.groq\.com/);
      const body = JSON.parse(init.body);
      assert.equal(body.model, API_CONFIGS.groq.models[0]);
      assert.equal(body.temperature, 0.2);
      assert.equal(body.max_tokens, 50);
      assert.equal(body.reasoning_effort, 'low'); // gpt-oss model
      assert.equal(init.headers.Authorization, 'Bearer k');
      return success({ choices: [{ message: { content: 'namaste' }, finish_reason: 'stop' }], usage: { total_tokens: 5 } });
    };
    const r = await new MultiAPIManager(env).generate([{ role: 'user', content: 'hi' }], { temperature: 0.2, max_tokens: 50 });
    assert.equal(r.text, 'namaste');
    assert.equal(r.provider, 'groq');
    assert.equal(r.model, API_CONFIGS.groq.models[0]);
    assert.equal(r.tokens, 5);
    assert.deepEqual(await new MultiAPIManager(env).getUsageStats(), { groq: { requests: 1, tokens: 5 } });
  });

  test('temperature 0 is respected, not replaced by the default', async () => {
    const env = { API_USAGE: new FakeKV(), API_ORDER: 'groq', GROQ_API_KEY: 'k' };
    let seen;
    globalThis.fetch = async (_url, init) => {
      seen = JSON.parse(init.body).temperature;
      return success({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] });
    };
    await new MultiAPIManager(env).generate([{ role: 'user', content: 'hi' }], { temperature: 0 });
    assert.equal(seen, 0);
  });

  test('a 400 on the reasoning body is retried once without it', async () => {
    const env = { API_USAGE: new FakeKV(), API_ORDER: 'groq', GROQ_API_KEY: 'k' };
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (body.reasoning_effort) return failure(400, 'reasoning not supported');
      return success({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    };
    const r = await new MultiAPIManager(env).generate([{ role: 'user', content: 'hi' }]);
    assert.equal(r.text, 'ok');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].reasoning_effort, 'low');
    assert.equal(bodies[1].reasoning_effort, undefined);
  });

  test('a 429 parks the provider for a while', async () => {
    const kv = new FakeKV();
    const env = { API_USAGE: kv, API_ORDER: 'groq', GROQ_API_KEY: 'k' };
    globalThis.fetch = async () => failure(429, 'rate limited');
    const r = await new MultiAPIManager(env).generate([{ role: 'user', content: 'hi' }]);
    assert.equal(r.text, '');
    assert.match(r.errors[0], /429/);
    assert.ok(Number(await kv.get('cooldown:groq')) > Date.now());
  });

  test('a provider at its daily limit is skipped without a request', async () => {
    const kv = new FakeKV();
    await kv.put(`usage:${new Date().toISOString().split('T')[0]}`, JSON.stringify({ groq: { requests: 1000, tokens: 0 } }));
    const env = { API_USAGE: kv, API_ORDER: 'groq', GROQ_API_KEY: 'k' };
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error('should not fetch');
    };
    const r = await new MultiAPIManager(env).generate([{ role: 'user', content: 'hi' }]);
    assert.equal(calls, 0);
    assert.match(r.errors[0], /Daily limit/);
  });

  test('a provider in cooldown is skipped without a request', async () => {
    const kv = new FakeKV();
    await kv.put('cooldown:groq', String(Date.now() + MIN));
    const env = { API_USAGE: kv, API_ORDER: 'groq', GROQ_API_KEY: 'k' };
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error('should not fetch');
    };
    const r = await new MultiAPIManager(env).generate([{ role: 'user', content: 'hi' }]);
    assert.equal(calls, 0);
    assert.match(r.errors[0], /Cooling down/);
  });

  test('a failed first provider falls through to the next one', async () => {
    const env = {
      API_USAGE: new FakeKV(), API_ORDER: 'groq,gemini',
      GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm',
    };
    globalThis.fetch = async (url) => {
      if (String(url).includes('groq')) return failure(500, 'groq down');
      return success({
        candidates: [{ content: { parts: [{ text: 'gemini answer' }] }, finishReason: 'STOP' }],
        usageMetadata: { totalTokenCount: 3 },
      });
    };
    const r = await new MultiAPIManager(env).generate([{ role: 'user', content: 'hi' }]);
    assert.equal(r.text, 'gemini answer');
    assert.equal(r.provider, 'gemini');
    assert.ok(r.errors.some((e) => /groq/.test(e)));
  });
});

describe('provider request shapes', () => {
  let realFetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('Gemini keeps the system prompt and never puts the key in the URL', async () => {
    const env = { API_USAGE: new FakeKV(), API_ORDER: 'gemini', GEMINI_API_KEY: 'secret' };
    let seen;
    globalThis.fetch = async (url, init) => {
      seen = { url, init };
      return success({ candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 9 } });
    };
    const r = await new MultiAPIManager(env).generate([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Earlier' },
    ]);
    assert.equal(r.text, 'hello');
    assert.equal(r.provider, 'gemini');
    assert.ok(!seen.url.includes('secret'));
    assert.equal(seen.init.headers['x-goog-api-key'], 'secret');
    const body = JSON.parse(seen.init.body);
    assert.deepEqual(body.systemInstruction, { parts: [{ text: 'SYS' }] });
    assert.deepEqual(body.contents, [
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts: [{ text: 'Earlier' }] },
    ]);
  });

  test('Cohere v2 skips thinking parts and reads output tokens', async () => {
    const env = { API_USAGE: new FakeKV(), API_ORDER: 'cohere', COHERE_API_KEY: 'c' };
    globalThis.fetch = async (url, init) => {
      assert.match(url, /api\.cohere\.com\/v2\/chat/);
      assert.equal(JSON.parse(init.body).messages.length, 1);
      return success({
        message: { content: [{ type: 'thinking', text: 'skip me' }, { type: 'text', text: 'answer' }] },
        usage: { tokens: { output_tokens: 4 } },
        finish_reason: 'COMPLETE',
      });
    };
    const r = await new MultiAPIManager(env).generate([{ role: 'user', content: 'hi' }]);
    assert.equal(r.text, 'answer');
    assert.equal(r.tokens, 4);
  });

  test('an empty provider answer is a failure, not an empty success', async () => {
    const env = { API_USAGE: new FakeKV(), API_ORDER: 'groq', GROQ_API_KEY: 'k', GROQ_MODELS: 'only' };
    globalThis.fetch = async () => success({ choices: [{ message: { content: '   ' }, finish_reason: 'length' }] });
    const r = await new MultiAPIManager(env).generate([{ role: 'user', content: 'hi' }]);
    assert.equal(r.text, '');
    assert.match(r.errors[0], /empty response/);
  });
});

describe('_openaiResult / _temp / _max helpers', () => {
  const m = new MultiAPIManager({});

  test('an OpenAI result exposes text and token count', () => {
    const r = m._openaiResult({ choices: [{ message: { content: 'hi' } }], usage: { total_tokens: 3 } }, 'groq', 'x');
    assert.deepEqual(r, { text: 'hi', tokens: 3, provider: 'groq', model: 'x' });
  });

  test('empty content throws with status 502', () => {
    assert.throws(
      () => m._openaiResult({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }, 'groq', 'x'),
      (e) => e.status === 502 && /empty response/.test(e.message),
    );
  });

  test('temperature/default token budget are respected', () => {
    assert.equal(m._temp({}), 0.7);
    assert.equal(m._temp({ temperature: 0 }), 0);
    assert.equal(m._max({}), 1200);
    assert.equal(m._max({ max_tokens: 5 }), 5);
  });
});

describe('getStatus — admin dashboard view', () => {
  test('shows key presence, usage and limits', async () => {
    const kv = new FakeKV();
    const env = { API_USAGE: kv, API_ORDER: 'groq', GROQ_API_KEY: 'g' };
    const s = await new MultiAPIManager(env).getStatus();
    assert.equal(s.groq.hasApiKey, true);
    assert.equal(s.groq.requests, 0);
    assert.equal(s.groq.limit, 1000);
    assert.equal(s.groq.available, true);
    assert.ok(s.groq.models.length > 0);
  });
});
