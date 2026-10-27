// card.js — ZERO-token "Fact Card": topic ke sources se admin ke liye ek chhota fact-sheet. AI ka ek bhi call nahi.
// Card = headline + 3-5 facts (har fact kam se kam 2 outlet mein mila) + source links.
// AI (token) tab chalta hai jab aap card dekhkar "article likho" dabate ho.
import { preflight } from './playbook.js';
import { extractFacts } from './facts.js';
import { makeHook } from './media.js';
import { JUNK } from './trends.js';

export const MAX_PENDING = 10;
const now = () => Math.floor(Date.now() / 1000);
const trafficNum = (t) => Number(String(t || '').replace(/[^0-9]/g, '')) || 0;
const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length > 2);

export const richEnough = (rs) => {
  const s = (rs && rs.sources) || [];
  const full = s.filter((x) => (x.text || '').length > 300).length;
  const chars = s.reduce((a, x) => a + (x.text || x.snippet || '').length, 0);
  return s.length >= 3 && full >= 2 && chars >= 1500;
};

// topic ko "baad mein dobara" (thin) ya "hamesha ke liye" (rejected) rakho. Kabhi bhi AI nahi chalta.
export async function parkTopic(env, topic, research, reason, retry) {
  const status = retry ? 'thin' : 'rejected';
  if (retry) { research.park_reason = reason; research.parked_at = now(); } else research.reject_reason = reason;
  await env.DB.prepare('UPDATE topics SET status=?,research=?,updated_at=? WHERE id=?').bind(status, JSON.stringify(research), now(), topic.id).run();
  return status;
}

function pickHook(topic, research, lang) {
  const qw = new Set(words(topic.query));
  let best = null, bestScore = -1;
  for (const s of research.sources || []) {
    const tw = words(s.title);
    const hit = tw.filter((w) => qw.has(w)).length;
    const dev = /[\u0900-\u097F]/.test(s.title || '');
    const sc = hit + (lang === 'hi' ? (dev ? 0.5 : 0) : (dev ? 0 : 0.5));
    if (sc > bestScore) { best = s; bestScore = sc; }
  }
  return makeHook((best && best.title) || topic.query, 7);
}

// pure: topic + research -> card ya wajah
export function buildCard(topic, research, opts = {}) {
  const lang = opts.lang || 'hi';
  const pf = preflight(topic, research, opts.nowSec);
  if (!pf.ok) return { ok: false, retry: !!pf.retry, reason: pf.reason, type: pf.type, label: pf.label };
  const fx = extractFacts(research.sources || [], { lang, max: opts.max || 5 });
  if (fx.agreed < 2) return { ok: false, retry: true, reason: `Sources ek khabar par sehmat nahi (2 outlet ke sanjhe facts: ${fx.agreed})`, type: pf.type, label: pf.label };
  return { ok: true, type: pf.type, label: pf.label, rules: pf.rules, hook: pickHook(topic, research, lang), facts: fx.facts, agreed: fx.agreed, sources: (research.sources || []).length };
}

// ek 'ready' topic ka card banao (traffic ke hisaab se); jo fail ho wo thin/rejected hota hai, AI kabhi nahi
export async function cardOne(env, opts = {}) {
  const lang = env.POST_LANG === 'en' ? 'en' : 'hi';
  const pending = (await env.DB.prepare("SELECT COUNT(*) c FROM topics WHERE status='carded'").first()).c;
  if (pending >= MAX_PENDING) return { ok: false, reason: `${pending} purane cards pending hain: pehle unhe approve ya reject karo`, skipped: [] };
  const cands = (await env.DB.prepare("SELECT * FROM topics WHERE status='ready' ORDER BY id LIMIT 8").all()).results
    .sort((a, b) => trafficNum(b.traffic) - trafficNum(a.traffic));
  const skipped = [];
  for (const c of cands) {
    let rs = {}; try { rs = JSON.parse(c.research || '{}'); } catch {}
    if (JUNK.test(c.query)) { await parkTopic(env, c, rs, 'Live/rate type topic: article ke kaam ka nahi', false); skipped.push(`${c.query} (junk)`); continue; }
    if (!richEnough(rs)) { await parkTopic(env, c, rs, 'Sources mein article text kam hai', true); skipped.push(`${c.query} (text kam)`); continue; }
    const card = buildCard(c, rs, { lang, nowSec: opts.nowSec });
    if (!card.ok) { await parkTopic(env, c, rs, card.reason, card.retry); skipped.push(`${c.query} (${card.reason.slice(0, 60)})`); continue; }
    rs.card = { hook: card.hook, facts: card.facts, agreed: card.agreed, type: card.type, label: card.label, built_at: now() };
    await env.DB.prepare('UPDATE topics SET status=?,research=?,updated_at=? WHERE id=?').bind('carded', JSON.stringify(rs), now(), c.id).run();
    return { ok: true, id: c.id, query: c.query, hook: card.hook, facts: card.facts.length, skipped };
  }
  return { ok: false, reason: 'Koi topic card ke layak nahi mila' + (skipped.length ? ` (${skipped.join('; ')})` : ''), skipped };
}
