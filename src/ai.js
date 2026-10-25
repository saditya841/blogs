// Workers AI helper: tries current models in order, handles different response shapes. No API key.
const FALLBACKS = ['@cf/zai-org/glm-4.7-flash', '@cf/google/gemma-4-26b-a4b-it', '@cf/openai/gpt-oss-20b', '@cf/qwen/qwen3.8-27b'];

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
// short description of an empty reply, so the admin error message says WHY it was empty
const diag = (r) => {
  try {
    const ch = r && r.choices && r.choices[0];
    const msg = ch && ch.message ? Object.keys(ch.message).join('+') : '';
    const usage = r && r.usage ? ` out_tokens=${r.usage.completion_tokens ?? '?'}` : '';
    return `finish=${finishOf(r) || '?'} keys=${Object.keys(r || {}).join(',') || 'none'}${msg ? ' msg=' + msg : ''}${usage}`;
  } catch { return 'diag-failed'; }
};

export function modelList(env) {
  return [env.AI_MODEL, ...FALLBACKS].filter(Boolean).filter((m, i, a) => a.indexOf(m) === i);
}

// returns { text, model, errors[] }
export async function runAI(env, messages, opts = {}) {
  const errors = [];
  for (const model of (opts.models || modelList(env))) { // opts.models = try only these models (used to ask several checkers one by one)
    try {
      const max = opts.max_tokens || 1200;
      const call = (mt) => env.AI.run(model, { messages, max_tokens: mt, temperature: opts.temperature ?? 0.5 });
      let r = await call(max);
      let text = String(pickText(r)).trim();
      // reasoning models can spend the whole token budget thinking and return nothing: retry once with a bigger budget
      if (!text && /length|max_tokens|incomplete/i.test(finishOf(r))) {
        r = await call(Math.min(max * 2, 8000));
        text = String(pickText(r)).trim();
      }
      if (text) return { text, model, errors };
      errors.push(`${model}: empty response (${diag(r)})`);
    } catch (e) { errors.push(`${model}: ${e.message}`); }
  }
  return { text: '', model: null, errors };
}
