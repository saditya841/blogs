// similarity.js — ZERO-token duplicate detection (no AI, no network).
//
// Why: AdSense/Google do not want the same story published five times with a new headline.
// This module fingerprints every post (SimHash + MinHash + exact title hash) and compares a new
// topic against the posts we already have BEFORE any AI token is spent.
//
// Pure functions are exported for the tests. The small DB helpers at the bottom lazily create the
// post_fingerprints table, so old databases keep working even before migration_v4.sql is run.

import { tok } from './verify.js';

const STOP = new Set((
  'the a an of in on at to for and or is are was were be been by with from that this it its as has have had ' +
  'also after before over about into than then them they their there here what which who whom whose when where why how ' +
  'ke ki ka mein me se ne ko hai hain tha the thi aur par ki yeh vah ek bhi to hi kar ho gaya gai gae jo is us tak ' +
  'liye saath baad pehle karne kiya kie di diya ve yahan vahan kuch sabhi apne apni raha rahi rahe ja jane nahi ya ab ' +
  'jab tab kaha bataya hui hua hue hoga hogi honge sakta sakti dwara dauran beech'
).split(' '));

const MASK64 = (1n << 64n) - 1n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

// Content words only: stopwords and bare numbers add noise to a fingerprint.
export function contentTokens(text) {
  return tok(text).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
}

// FNV-1a 64-bit + avalanche. Deterministic across Workers and Node.
export function hash64(str) {
  let h = FNV_OFFSET;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  h ^= h >> 33n; h = (h * 0xff51afd7ed558ccdn) & MASK64;
  h ^= h >> 33n; h = (h * 0xc4ceb9fe1a85ec53n) & MASK64;
  h ^= h >> 33n;
  return h & MASK64;
}

export const hashHex = (str) => hash64(str).toString(16).padStart(16, '0');

// 64-bit SimHash: similar word sets get a similar bit pattern.
export function simhash(text) {
  const tokens = contentTokens(text);
  if (!tokens.length) return '0000000000000000';
  const v = new Array(64).fill(0);
  for (const t of tokens) {
    const h = hash64(t);
    for (let b = 0; b < 64; b++) v[b] += ((h >> BigInt(b)) & 1n) ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (v[b] > 0) out |= 1n << BigInt(b);
  return out.toString(16).padStart(16, '0');
}

export function hammingHex(a, b) {
  let x;
  try { x = BigInt('0x' + String(a || '0')) ^ BigInt('0x' + String(b || '0')); }
  catch { return 64; }
  let n = 0;
  while (x) { x &= x - 1n; n++; }
  return n;
}

// MinHash signature: compact, order-independent Jaccard estimate.
export function minhash(text, n = 48) {
  const toks = [...new Set(contentTokens(text))];
  const sig = new Array(n).fill(0xffffffff);
  if (!toks.length) return sig;
  for (let i = 0; i < n; i++) {
    let best = 0xffffffff;
    for (const t of toks) {
      const h = Number(hash64(i + ':' + t) & 0xffffffffn);
      if (h < best) best = h;
    }
    sig[i] = best;
  }
  return sig;
}

export function minhashJaccard(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const n = Math.min(a.length, b.length);
  let same = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  return same / n;
}

// Shape stored in D1 (minhash is JSON text there).
export function fingerprint(title, body = '') {
  const all = `${title || ''} ${body || ''}`;
  const titleTokens = contentTokens(title);
  return {
    version: 1,
    simhash: simhash(all),
    titleSimhash: simhash(titleTokens.join(' ')),
    titleHash: hashHex(titleTokens.join(' ')),
    minhash: minhash(all, 48),
    tokens: contentTokens(all).length
  };
}

// Combined score 0..1. Exact title hash wins; otherwise body fingerprint, with a title nudge.
export function compareFingerprints(a, b) {
  if (!a || !b) return { score: 0, exact: false, bodyScore: 0, titleScore: 0 };
  if (a.titleHash && b.titleHash && a.titleHash === b.titleHash) {
    return { score: 1, exact: true, bodyScore: 1, titleScore: 1 };
  }
  const bodyScore = Math.max(minhashJaccard(a.minhash, b.minhash), 1 - hammingHex(a.simhash, b.simhash) / 64);
  const titleScore = a.titleSimhash && b.titleSimhash ? 1 - hammingHex(a.titleSimhash, b.titleSimhash) / 64 : 0;
  return { score: Math.max(bodyScore, titleScore * 0.9), exact: false, bodyScore, titleScore };
}

export const DUP_BLOCK = 0.82;

// Returns the closest existing post. `duplicate` is true for exact or very high similarity.
export function findDuplicate(candidate, existing = [], opts = {}) {
  const block = Number(opts.block ?? DUP_BLOCK);
  let best = null;
  for (const e of existing || []) {
    const c = compareFingerprints(candidate, e);
    if (!best || c.score > best.score) best = { ...c, against: e };
  }
  if (!best) return { duplicate: false, score: 0, exact: false, against: null, reason: '' };
  const duplicate = best.exact || best.score >= block;
  return {
    duplicate,
    score: Math.round(best.score * 1000) / 1000,
    exact: !!best.exact,
    against: best.against || null,
    reason: duplicate
      ? `${best.exact ? 'Same headline' : 'Bahut milta-julta'} pehle se hai (${Math.round(best.score * 100)}% match)`
      : ''
  };
}

// ---------- D1 helpers (lazy table: old databases keep working) ----------
const now = () => Math.floor(Date.now() / 1000);

export async function ensureFingerprintTable(env) {
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS post_fingerprints (post_id INTEGER PRIMARY KEY, simhash TEXT, title_simhash TEXT, title_hash TEXT, minhash TEXT, tokens INTEGER DEFAULT 0, title TEXT, created_at INTEGER)'
  ).run();
}

const rowToFp = (r) => ({
  postId: r.post_id,
  title: r.title || '',
  simhash: r.simhash,
  titleSimhash: r.title_simhash,
  titleHash: r.title_hash,
  minhash: (() => { try { return JSON.parse(r.minhash || '[]'); } catch { return []; } })(),
  tokens: Number(r.tokens) || 0
});

// Loads stored fingerprints. If the table is empty (existing site), it builds them from the posts
// table once so duplicate protection works from day one.
export async function loadExistingFingerprints(env, limit = 300) {
  const cap = Math.max(1, Math.min(1000, Number(limit) || 300));
  try {
    await ensureFingerprintTable(env);
    const { results } = await env.DB.prepare(
      'SELECT post_id,simhash,title_simhash,title_hash,minhash,tokens,title FROM post_fingerprints ORDER BY post_id DESC LIMIT ?'
    ).bind(cap).all();
    if (results && results.length) return results.map(rowToFp);
  } catch { /* table missing / DB busy */ }
  try {
    const { results } = await env.DB.prepare(
      'SELECT id,title,summary,body FROM posts ORDER BY id DESC LIMIT ?'
    ).bind(cap).all();
    return (results || []).map((p) => ({ ...fingerprint(p.title, `${p.summary || ''} ${p.body || ''}`), postId: p.id, title: p.title || '' }));
  } catch { return []; }
}

export async function saveFingerprint(env, postId, title, body) {
  const fp = fingerprint(title, body);
  try {
    await ensureFingerprintTable(env);
    await env.DB.prepare(
      'INSERT OR REPLACE INTO post_fingerprints(post_id,simhash,title_simhash,title_hash,minhash,tokens,title,created_at) VALUES(?,?,?,?,?,?,?,?)'
    ).bind(Number(postId) || 0, fp.simhash, fp.titleSimhash, fp.titleHash, JSON.stringify(fp.minhash), fp.tokens, String(title || '').slice(0, 240), now()).run();
  } catch { /* never fail a draft because of a fingerprint write */ }
  return fp;
}
