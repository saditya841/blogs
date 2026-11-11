// debate.js — safe multi-AI discussion + cross-checking.
//
// Aaj Tak style "har party ka neta bahas karta hai" ka SAFE version:
//   * roles are neutral analysts (Reporter / Analyst / Skeptic), never real politicians,
//   * no AI is allowed to put words / quotes in a real person's mouth,
//   * every role must attach the exact source line (EVIDENCE) to every claim,
//   * a Judge AI cross-examines the three roles and returns one final claim list,
//   * claims.js (plain code) then checks the evidence against the sources and counts outlets.
//
// The writer only receives the CODE-VERIFIED ledger. This is why tokens are spent on research
// first and writing second: the writer starts from checked facts instead of guessing.
//
// Nothing here throws: a failed provider/role is recorded and the pipeline continues.

import { runAI } from './ai.js';
import { parseClaimLines, buildLedger, ledgerText, ledgerMeta, ledgerTextFromMeta } from './claims.js';

const PROVIDER_KEYS = {
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',
  cohere: 'COHERE_API_KEY'
};

export const DEBATE_ROLES = [
  {
    id: 'reporter',
    name: 'Reporter',
    focus: 'Sirf confirmed facts: kya hua, kab hua, kahan hua, kaun shamil hai. Koi ray nahi.'
  },
  {
    id: 'analyst',
    name: 'Analyst',
    focus: 'Is khabar ka matlab, context aur asar. Har baat source se, koi prediction nahi.'
  },
  {
    id: 'skeptic',
    name: 'Skeptic',
    focus: 'Kya missing hai, kaun si baat sirf ek source me hai, kahan contradictions hain. Jhooth aur gaps pakdo.'
  }
];

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const safeText = (s) => String(s || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim();

export function sourceBlock(sources, opts = {}) {
  const max = Math.max(1, Math.min(6, Number(opts.max ?? 4)));
  const chars = Math.max(400, Math.min(2200, Number(opts.chars ?? 1400)));
  return (sources || [])
    .slice(0, max)
    .map((s, i) => {
      const name = safeText(s.title || hostOf(s.url) || 'source');
      const host = hostOf(s.url);
      return `[${i + 1}] ${name}${host ? ' (' + host + ')' : ''}\n${safeText(s.text).slice(0, chars)}`;
    })
    .join('\n\n');
}

const briefBlock = (brief) => (brief && brief.briefText ? `READING BRIEF (already checked by code):\n${String(brief.briefText).slice(0, 2200)}\n\n` : '');

export function roleMessages(env, o = {}) {
  const topic = safeText(o.topic && (o.topic.query || o.topic.title) || o.query || '');
  const role = o.role || DEBATE_ROLES[0];
  const system =
    'You are a neutral Indian news analyst in a multi-AI editorial discussion. ' +
    'You are NOT a politician, party leader, celebrity or any real person. Never write in the first person as a public figure. ' +
    'Never invent quotes, dialogues, statements, names, numbers or dates. ' +
    'Use ONLY the SOURCES and the READING BRIEF. If a detail is missing, say it is missing instead of guessing. ' +
    'No opinions presented as facts. No hate, no defamation, no election misinformation.';
  const user =
    `Topic: ${topic}\n\n${briefBlock(o.brief)}SOURCES:\n${sourceBlock(o.sources)}\n\n` +
    `YOUR ROLE: ${role.name} — ${role.focus}\n\n` +
    'Do this:\n' +
    '1. Read the sources first.\n' +
    '2. Write 3 to 5 short analytical points for your role.\n' +
    '3. Then list every factual claim you relied on, one line each, in exactly this format:\n' +
    'CLAIM: <short claim> || EVIDENCE: <exact words copied from a source that prove it>\n\n' +
    'Rules:\n' +
    '- The EVIDENCE must be an exact phrase from the SOURCES, not your paraphrase.\n' +
    '- If a claim has no exact evidence, do not write that claim.\n' +
    '- No bullet markers other than "-" for the points above the claims.\n' +
    '- No quotation marks around anyone\'s words.\n' +
    '- Write in the same language as the sources (Hindi sources -> Hindi, English -> English).\n' +
    '- Maximum 5 CLAIM lines.';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function judgeMessages(env, o = {}) {
  const topic = safeText(o.topic && (o.topic.query || o.topic.title) || o.query || '');
  const rounds = (o.roles || [])
    .map((r) => `--- ${r.name} (${r.id}) ---\n${safeText(r.text).slice(0, 2400)}`)
    .join('\n\n');
  const system =
    'You are the strict judge of a multi-AI editorial discussion for a news website. ' +
    'You do not create new facts. You only compare what the three analysts wrote against the SOURCES. ' +
    'Never write quotes or put words in a real person\'s mouth. Reject any claim that the sources do not support. ' +
    'A claim that only one source makes must still be listed, but it will be treated as single-source by code.';
  const user =
    `Topic: ${topic}\n\n${briefBlock(o.brief)}SOURCES:\n${sourceBlock(o.sources, { max: 5, chars: 1500 })}\n\n` +
    `THREE AI ANALYSTS WROTE THIS:\n${rounds}\n\n` +
    'Task — cross-examine and build the FINAL CLAIM LIST:\n' +
    '- Compare the three analysts. Keep a claim only if at least one of them gave real evidence for it.\n' +
    '- For each kept claim, write exactly one line:\n' +
    '  CLAIM: <short claim> || EVIDENCE: <exact words from a source> || SUPPORT: <role ids that agree, comma separated>\n' +
    '- Remove duplicates (same fact written differently) and merge their SUPPORT.\n' +
    '- Remove anything that is opinion, prediction, or not in the sources.\n' +
    '- Maximum 10 lines. No other text before or after the claim lines.\n' +
    '- Same language as the sources.';
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// Provider list from the keys that actually exist. Empty list = let MultiAPIManager use its order.
export function debateProviders(env) {
  const asked = String((env && env.DEBATE_PROVIDER_ORDER) || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const keys = asked.length ? asked : Object.keys(PROVIDER_KEYS);
  return keys.filter((p) => PROVIDER_KEYS[p] && env && env[PROVIDER_KEYS[p]]);
}

export function rotateProviders(list, i) {
  if (!Array.isArray(list) || !list.length) return [];
  const n = i % list.length;
  return [...list.slice(n), ...list.slice(0, n)];
}

const emptyLedger = (minAgree) => ({
  version: 1, minAgree, items: [], verified: [], singleSource: [], unsupported: [], conflict: [],
  stats: { total: 0, verified: 0, singleSource: 0, unsupported: 0, conflict: 0 }
});

// A hard cap so one slow provider cannot hold the whole write click forever.
function within(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(onTimeout), Math.max(1000, Number(ms) || 45000));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function debateMeta(d, opts = {}) {
  if (!d) return null;
  const roleChars = Math.max(120, Number(opts.roleChars ?? 700));
  return {
    version: 1,
    at: Math.floor(Date.now() / 1000),
    ok: !!d.ok,
    rounds: d.rounds ?? 0,
    ms: d.ms || 0,
    stats: d.stats || {},
    judge: d.judge ? { ok: !!d.judge.ok, provider: d.judge.provider || null, model: d.judge.model || null, error: d.judge.error || '' } : null,
    roles: (d.roles || []).map((r) => ({
      id: r.id, name: r.name, ok: !!r.ok, provider: r.provider || null, model: r.model || null,
      claims: r.claims || 0, error: r.error || '', text: String(r.text || '').slice(0, roleChars)
    })),
    ledger: d.ledger ? ledgerMeta(d.ledger, { max: opts.maxClaims ?? 12 }) : null,
    errors: (d.errors || []).slice(0, 6)
  };
}

// Main entry. opts.runAI is injectable so tests can run offline.
export async function runDebate(env, opts = {}) {
  const started = Date.now();
  const callAI = opts.runAI || runAI;
  const topic = opts.topic || { query: opts.query || '' };
  const sources = (opts.sources || [])
    .map((s) => ({ ...s, text: safeText(s && (s.text || s.content || s.snippet)).replace(/\s+/g, ' ') }))
    .filter((s) => s.text);
  const brief = opts.brief || null;
  const minAgree = Math.max(1, Number((env && env.MIN_AGREE_SOURCES) ?? 2));
  const rounds = Math.max(0, Math.min(2, Number((env && env.DEBATE_ROUNDS) ?? 1)));
  const deadline = Number((env && env.DEBATE_TIMEOUT_MS) || 45000);
  const maxRoles = Math.max(2, Math.min(3, Number((env && env.DEBATE_ROLES) || 3)));
  const errors = [];

  if (!sources.length) {
    return { ok: false, reason: 'Debate ke liye koi source text nahi', roles: [], judge: null, ledger: emptyLedger(minAgree), stats: emptyLedger(minAgree).stats, errors: ['no source text'], rounds, ms: 0 };
  }

  try {
    const roles = (Array.isArray(opts.roles) && opts.roles.length ? opts.roles : DEBATE_ROLES).slice(0, maxRoles);
    const providers = debateProviders(env);

    const roleRuns = roles.map((role, i) => {
      const options = { max_tokens: 1000, temperature: 0.35 };
      const plan = rotateProviders(providers, i);
      if (plan.length) options.providers = plan;
      return within(
        Promise.resolve().then(() => callAI(env, roleMessages(env, { topic, sources, brief, role }), options)),
        deadline,
        { text: '', provider: null, model: null, errors: [`${deadline}ms timeout`] }
      )
        .then((ai) => ({ role, ai: ai || {} }))
        .catch((e) => ({ role, ai: { text: '', errors: [String((e && e.message) || e)] } }));
    });

    const roleResults = await Promise.all(roleRuns);
    const roleOut = roleResults.map(({ role, ai }) => {
      const text = safeText(ai.text);
      const claims = parseClaimLines(text);
      if (!text) errors.push(`${role.id}: ${((ai.errors || [])[0] || 'no answer').toString().slice(0, 120)}`);
      return {
        id: role.id,
        name: role.name,
        ok: !!text,
        text,
        claims: claims.length,
        claimItems: claims,
        provider: ai.provider || null,
        model: ai.model || null,
        error: text ? '' : String(((ai.errors || [])[0] || 'no answer')).slice(0, 160)
      };
    });

    const okRoles = roleOut.filter((r) => r.ok);
    if (okRoles.length < 2) {
      return {
        ok: false,
        reason: `Sirf ${okRoles.length} AI role ne jawab diya (2 chahiye)`,
        roles: roleOut.map(({ claimItems, ...r }) => r),
        judge: null,
        ledger: emptyLedger(minAgree),
        stats: emptyLedger(minAgree).stats,
        errors,
        rounds,
        ms: Date.now() - started
      };
    }

    // Cross-exam round: one judge call over all three role answers.
    let judge = { ok: false, provider: null, model: null, error: '', text: '' };
    let judgeItems = [];
    if (rounds >= 1) {
      const options = { max_tokens: 1300, temperature: 0.1 };
      const plan = rotateProviders(providers, okRoles.length);
      if (plan.length) options.providers = plan;
      const ai = await within(
        Promise.resolve().then(() => callAI(env, judgeMessages(env, { topic, sources, brief, roles: okRoles }), options)),
        deadline,
        { text: '', provider: null, model: null, errors: [`${deadline}ms timeout`] }
      ).catch((e) => ({ text: '', errors: [String((e && e.message) || e)] }));
      const text = safeText(ai.text);
      judge = {
        ok: !!text,
        text,
        provider: ai.provider || null,
        model: ai.model || null,
        error: text ? '' : String(((ai.errors || [])[0] || 'no answer')).slice(0, 160)
      };
      judgeItems = parseClaimLines(text);
      if (!text) errors.push(`judge: ${judge.error}`);
    }

    // If the judge failed, fall back to the union of role claims (still code-verified).
    const items = judgeItems.length ? judgeItems : okRoles.flatMap((r) => r.claimItems);
    const ledger = buildLedger(items, sources, { minAgree });

    return {
      ok: ledger.items.length > 0,
      reason: ledger.items.length ? '' : 'Koi claim evidence ke saath nahi mila',
      roles: roleOut.map(({ claimItems, ...r }) => r),
      judge: { ok: judge.ok, provider: judge.provider, model: judge.model, error: judge.error },
      ledger,
      stats: ledger.stats,
      errors,
      rounds,
      ms: Date.now() - started
    };
  } catch (e) {
    return {
      ok: false,
      reason: `Debate fail: ${String((e && e.message) || e).slice(0, 200)}`,
      roles: [],
      judge: null,
      ledger: emptyLedger(minAgree),
      stats: emptyLedger(minAgree).stats,
      errors: [...errors, String((e && e.message) || e).slice(0, 200)],
      rounds,
      ms: Date.now() - started
    };
  }
}

export { ledgerText, ledgerMeta, ledgerTextFromMeta, buildLedger, parseClaimLines };

// What writer.js sends to the writing model: only the code-checked ledger.
export function debateBrief(ledger, opts = {}) {
  return ledgerText(ledger, opts);
}
