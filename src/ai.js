// Workers AI helper: tries current models in order, handles different response shapes. No API key.
// COST SAFETY (v2): reasoning models can burn the whole token budget on "thinking" and return an empty answer.
//  - reasoning is switched to LOW (gpt-oss) / thinking OFF (others) when the model accepts it
//  - the one retry after "finish=length" is capped at RETRY_CAP tokens (was 8000)
//  - by default only MAX_MODELS models are tried per call (was all 4)
const FALLBACKS = ['@cf/zai-org/glm-4.7-flash', '@cf/google/gemma-4-26b-a4b-it', '@cf/openai/gpt-oss-20b', '@cf/qwen/qwen3.8-27b'];
export const RETRY_CAP = 4500;
export const MAX_MODELS = 2;

const pickText = (r) => {
  if (!r) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string' && r.response) return r.response;
  const c = r.choices && r.choices[0] && (r.choices[0].message || r.choices[0]);
  if (c) {
    if (typeof c.content === 'string' && c.content) return c.content;
    if (Array.isArray(c.content)) return c.content.map((x) => x.text || '').join('');
    if (typeof c.text === 'string' && c.text) return c.text;
  }
  if (r.result && r.result.response) return r.result.response;
  if (typeof r.output_text === 'string' && r.output_text) return r.output_text;
  // Responses-API style: output: [{type:'reasoning',...},{type:'message',content:[{type:'output_text',text}]}]
  if (Array.isArray(r.output)) {
    const t = r.output.filter((o) => o && o.type === 'message').flatMap((o) => (Array.isArray(o.content) ? o.content : [])).map((p) => (p && p.text) || '').join('');
    if (t) return t;
  }
  return '';
};

const finishOf = (r) => {
  try { return String((r && r.choices && r.choices[0] && r.choices[0].finish_reason) || (r && r.status) || ''); } catch { return ''; }
};
const tokensOf = (r) => { try { return Number((r && r.usage && r.usage.completion_tokens) || 0) || 0; } catch { return 0; } };
// short description of an empty reply, so the admin error message says WHY it was empty
const diag = (r) => {
  try {
    const ch = r && r.choices && r.choices[0];
    const msg = ch && ch.message ? Object.keys(ch.message).join('+') : '';
    const usage = r && r.usage ? ` out_tokens=${r.usage.completion_tokens ?? '?'}` : '';
    return `finish=${finishOf(r) || '?'}${msg ? ' msg=' + msg : ''}${usage}`;
  } catch { return 'diag-failed'; }
};

// settings that make reasoning models think less (not every model accepts them: see call() below)
export const thinkLess = (model) => (/gpt-oss/i.test(model) ? { reasoning: { effort: 'low' } } : { chat_template_kwargs: { enable_thinking: false } });

export function modelList(env) {
  return [env.AI_MODEL, ...FALLBACKS].filter(Boolean).filter((m, i, a) => a.indexOf(m) === i);
}

// returns { text, model, errors[], tokens }  (tokens = output tokens used by all attempts, 0 if unknown)
export async function runAI(env, messages, opts = {}) {
  const errors = [];
  let tokens = 0;
  // opts.models = try exactly these models (caller decides); otherwise only the first MAX_MODELS
  const list = opts.models || modelList(env).slice(0, opts.maxModels || MAX_MODELS);
  for (const model of list) {
    try {
      const max = opts.max_tokens || 1200;
      let extras = opts.thinkLess === false ? null : thinkLess(model);
      const call = async (mt) => {
        const base = { messages, max_tokens: mt, temperature: opts.temperature ?? 0.5 };
        if (extras) {
          try { return await env.AI.run(model, { ...base, ...extras }); }
          catch (e) { extras = null; errors.push(`${model}: thinkLess nahi chala (${String(e.message).slice(0, 60)}), bina uske try`); }
        }
        return env.AI.run(model, base);
      };
      let r = await call(max);
      tokens += tokensOf(r);
      let text = String(pickText(r)).trim();
      // reasoning models can spend the whole budget thinking and return nothing: retry ONCE with a modestly bigger budget (never 8000)
      if (!text && /length|max_tokens|incomplete/i.test(finishOf(r))) {
        r = await call(Math.min(Math.round(max * 1.5), RETRY_CAP));
        tokens += tokensOf(r);
        text = String(pickText(r)).trim();
      }
      if (text) return { text, model, errors, tokens };
      errors.push(`${model}: empty response (${diag(r)})`);
    } catch (e) { errors.push(`${model}: ${e.message}`); }
  }
  return { text: '', model: null, errors, tokens };
}
