// conflicts.js — ZERO-token contradiction detector.
//
// Problem it solves: two outlets can report the SAME fact with DIFFERENT numbers
// ("project cost 1,200 crore" vs "project cost 2,100 crore"). The normal grounded check
// only asks "does this evidence exist somewhere" — it cannot see that the sources disagree.
//
// This module compares the numbers a claim uses against the same fact in every outlet.
// If two outlets give different values, the claim is marked `conflict`:
//   * the writer is told to write "reports differ" or to leave the number out,
//   * the claim is never treated as `verified`.
//
// No AI, no network. Pure functions, so the tests can cover them.

import { tok, numbersIn } from './verify.js';

const STOP = new Set((
  'the a an of in on at to for and or is are was were be been by with from that this it its as has have had ' +
  'also after before over about into than then them they their there here what which who whom whose when where why how ' +
  'will would can could should may might must said says told report reports reported according ' +
  'ke ki ka mein me se ne ko hai hain tha the thi aur par yeh vah ek bhi to hi kar ho gaya gai gae jo is us tak ' +
  'liye saath baad pehle karne kiya kie di diya ve yahan vahan kuch sabhi apne apni raha rahi rahe ja jane nahi ya ab ' +
  'jab tab kaha bataya hui hua hue hoga hogi honge sakta sakti dwara dauran beech bhi koi kuch'
).split(' ').filter(Boolean));

const UNITS = [
  [/(crore|करोड़|करोड)/i, 'crore'],
  [/(lakh|लाख)/i, 'lakh'],
  [/(thousand|हज़ार|हजार)/i, 'thousand'],
  [/(million)/i, 'million'],
  [/(billion)/i, 'billion'],
  [/(percent|प्रतिशत|%)/i, 'percent'],
  [/(kilometre|kilometer|kms?|किमी|किलोमीटर)/i, 'km'],
  [/(kilogram|kgs?|किलो|किलोग्राम)/i, 'kg'],
  [/(rupees?|\brs\.?\b|रुपये|रुपए|₹)/i, 'rupee'],
  [/(tonnes?|tons?|टन)/i, 'ton'],
  [/(years?|साल|वर्ष)/i, 'year'],
  [/(months?|महीना|महीने|माह)/i, 'month'],
  [/(days?|दिन)/i, 'day'],
  [/(hours?|घंटे|घंटा)/i, 'hour'],
  [/(minutes?|मिनट)/i, 'minute'],
  [/(metres?|meters?|मीटर)/i, 'metre'],
  [/(feet|foot|फीट)/i, 'feet']
];

// "1,200 crore" and "१२०० करोड़" both give unit = crore.
export function unitOf(text) {
  const s = String(text || '');
  for (const [re, unit] of UNITS) if (re.test(s)) return unit;
  return '';
}

const SENT_SPLIT = /(?<=[।.!?])\s+|\n+/;

export function sentencesOf(text) {
  return String(text || '')
    .replace(/^##.*$/gm, ' ')
    .split(SENT_SPLIT)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 10);
}

const content = (s) => tok(s).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));

// Every number in a sentence with the unit that belongs to it.
// The search window stops at the neighbouring number, so "1200 and 3 years" does not
// give the year unit to 1200.
export function numberPairs(sentence) {
  const s = String(sentence || '');
  const ms = [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => ({ value: m[0], index: m.index, end: m.index + m[0].length }));
  const out = [];
  for (let i = 0; i < ms.length; i++) {
    const cur = ms[i];
    const prevEnd = i ? ms[i - 1].end : 0;
    const nextStart = i + 1 < ms.length ? ms[i + 1].index : s.length;
    const after = s.slice(cur.end, Math.min(nextStart, cur.end + 24));
    const before = s.slice(Math.max(prevEnd, cur.index - 24), cur.index);
    out.push({ value: cur.value, unit: unitOf(after) || unitOf(before) });
  }
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const outletName = (s, i) => String((s && (s.source || s.title)) || hostOf(s && s.url) || `source${i + 1}`);

// Does any claim number get a different value in two different outlets?
// Conservative: only sentences that share enough claim words are compared, and only the
// number closest to the claimed value is picked from each outlet.
export function claimConflict(claim, sources) {
  const claimNums = numbersIn(claim);
  if (!claimNums.length) return { conflict: false, values: [] };

  const anchor = new Set(content(claim));
  if (anchor.size < 2) return { conflict: false, values: [] };

  const claimPairs = numberPairs(claim);
  const chosen = new Map(); // outlet -> [{ value, unit, claimValue }]

  (sources || []).forEach((s, i) => {
    const name = outletName(s, i);
    const per = [];
    for (const sent of sentencesOf(s && s.text)) {
      const pairs = numberPairs(sent);
      if (!pairs.length) continue;
      const st = new Set(content(sent));
      let hit = 0;
      for (const w of anchor) if (st.has(w)) hit++;
      if (hit < 2 || hit / anchor.size < 0.5) continue;
      per.push(...pairs);
    }
    if (!per.length) return;

    const vals = [];
    for (const n of claimNums) {
      const cp = claimPairs.find((p) => p.value === n) || { unit: unitOf(claim) };
      let cand = per.filter((p) => (cp.unit ? p.unit === cp.unit : p.unit === ''));
      if (!cand.length) cand = per.filter((p) => p.unit === cp.unit);
      if (!cand.length) cand = per;
      const num = Number(n);
      cand.sort((a, b) => Math.abs(Number(a.value) - num) - Math.abs(Number(b.value) - num));
      if (cand[0]) vals.push({ value: cand[0].value, unit: cand[0].unit, claimValue: n });
    }
    if (vals.length) chosen.set(name, vals);
  });

  if (chosen.size < 2) return { conflict: false, values: [] };

  const values = [];
  let conflict = false;
  for (const n of claimNums) {
    const picks = [...chosen.entries()]
      .map(([outlet, vals]) => {
        const v = vals.find((x) => x.claimValue === n);
        return v ? { ...v, outlet } : null;
      })
      .filter(Boolean);
    if (new Set(picks.map((p) => p.value)).size > 1) {
      conflict = true;
      values.push(...picks);
    }
  }
  if (!conflict) return { conflict: false, values: [] };

  const seen = new Set();
  const compact = [];
  for (const v of values) {
    const k = `${v.outlet}|${v.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    compact.push(v);
  }
  return { conflict: true, values: compact.slice(0, 8) };
}

// "Outlook: 1200, Bhaskar: 2100" — used in the ledger and the admin review page.
export function conflictSummary(values) {
  return (values || []).map((v) => `${v.outlet}: ${v.value}${v.unit ? ' ' + v.unit : ''}`).join(', ');
}
