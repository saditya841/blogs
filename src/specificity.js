// specificity.js — ZERO-token "is this real reporting or vague filler?" score.
//
// AI filler looks like: "The government is working on many important issues and will
// continue to take steps for the people." Nothing checkable.
// Real reporting has names, places, numbers and dates.
//
// This module counts those concrete details per 100 words. Too few = vague. Too many =
// a list/press release, which also reads machine-made.

import { numbersIn } from './verify.js';

const MONTHS = /(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?|जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|सितम्बर|अक्टूबर|अक्तूबर|नवंबर|नवम्बर|दिसंबर|दिसम्बर)/i;
const UNIT = /(crore|लाख|lakh|करोड़|thousand|हज़ार|हजार|million|billion|percent|प्रतिशत|km|किमी|किलोमीटर|kg|किलो|rupees?|रुपये|रुपए|rs\.?|₹|ton|टन|year|साल|वर्ष|month|महीने|दिन|day)/i;

const wordsOf = (s) => String(s || '').split(/\s+/).filter(Boolean);

// Capitalised grammar words are not "names". Sentence-start capitals are grammar, not facts.
const NOT_NAME = new Set((
  'the a an this that these those his her their our its my your he she it they we you i ' +
  'on in at as if but and or for with from by to of is are was were has have had ' +
  'said says will would can could may might not also when where while after before ' +
  'officials government minister ministers police court report reports according ' +
  'monday tuesday wednesday thursday friday saturday sunday today yesterday tomorrow'
).split(' ').filter(Boolean));

// Real reporting has names, places, numbers and dates.
export function specifics(text) {
  const s = String(text || '');
  const numbers = [...new Set(numbersIn(s))].filter((n) => {
    if (n.length >= 2 || n.includes('.')) return true;
    // a single digit is concrete only when it carries a unit ("5 crore")
    return new RegExp(`${n}\\s*(crore|lakh|करोड़|लाख|thousand|हज़ार|हजार|million|billion|percent|प्रतिशत|km|किमी|kg|किलो|ton|टन)`, 'i').test(s);
  });
  const monthSet = new Set((s.match(new RegExp(MONTHS.source, 'gi')) || []).map((m) => m.toLowerCase()));
  const names = [];
  const seenNames = new Set();
  for (const sent of s.split(/(?<=[.!?।])\s+|\n+/)) {
    const toks = sent.split(/\s+/).filter(Boolean);
    toks.forEach((w, i) => {
      if (i === 0 || !/^[A-Z][A-Za-z]{2,}$/.test(w)) return;
      const low = w.toLowerCase();
      if (NOT_NAME.has(low) || monthSet.has(low) || seenNames.has(low)) return;
      seenNames.add(low);
      names.push(w);
    });
  }
  const months = [...new Set((s.match(new RegExp(MONTHS.source, 'gi')) || []))];
  const unitNums = numbers.filter((n) => new RegExp(`${n}\\s*${UNIT.source}`, 'i').test(s));
  const dates = months.length + (/\b\d{1,2}\s*(?:\/|-)\s*\d{1,2}(?:\s*(?:\/|-)\s*\d{2,4})?\b/.test(s) ? 1 : 0);
  const facts = numbers.length + names.length + dates;
  return { numbers, names, months, unitNums, dates, facts };
}

// score 0..100, penalty 0..8, per100 = concrete details per 100 words.
export function specificity(text, opts = {}) {
  const words = wordsOf(text).length;
  const det = specifics(text);
  const per100 = words ? Math.round((det.facts / words) * 1000) / 10 : 0;
  const low = Number(opts.low ?? 3);
  const high = Number(opts.high ?? 10);

  let score = 100;
  if (per100 < low) score = Math.max(20, 40 + (per100 / Math.max(0.1, low)) * 40);
  else if (per100 > high) score = Math.max(55, 100 - (per100 - high) * 5);

  const penalty = Math.min(8, Math.round((100 - score) * 0.08));
  const notes = [];
  if (per100 < low) notes.push(`Bahut kam thos detail: ${per100}/100 shabd (naam, number, tareekh)`);
  if (per100 > high) notes.push(`Bahut zyada list-jaisi detail: ${per100}/100 shabd`);
  if (!det.numbers.length) notes.push('Koi sankhya/aankda nahi');

  return { score: Math.round(score), penalty, per100, words, ...det, notes };
}

export function specificityMeta(x) {
  if (!x) return null;
  return {
    score: x.score,
    penalty: x.penalty,
    per100: x.per100,
    numbers: (x.numbers || []).slice(0, 8),
    names: (x.names || []).slice(0, 8),
    notes: (x.notes || []).slice(0, 4)
  };
}
