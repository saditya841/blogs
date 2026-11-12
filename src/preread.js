// preread.js — ZERO-token pre-read stage.
//
// This is the "read the topic first, then write" step. Before writer.js calls any AI model, this module
// reads every collected source with plain JavaScript and builds a READING BRIEF:
//   * which sources are usable (language, relevance, real article text, injection-free)
//   * which facts two or more outlets agree on
//   * which numbers / dates / names are allowed
//   * what is missing (so the AI must leave it out instead of inventing it)
//
// If the brief is not good enough, the writer stops BEFORE spending tokens and returns a clear reason.
// No AI is called here. No network. Pure functions, so the tests can run offline.

import { tok, numbersIn, looksInjected } from './verify.js';
import { extractFacts, splitSentences } from './facts.js';
import { sortByTrust, trustSummary, trustText } from './sourcetrust.js';

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

const EN_STOP = new Set((
  'the a an of in on at to for and or is are was were be been by with from that this it its as has have had ' +
  'also after before over said says will would can could should may might than then them they their there here ' +
  'new latest news update updates report reports according while where when who whom whose what which'
).split(' '));

const ES_STOP = new Set((
  'el la los las un una unos unas de del en y o que es son fue fueron por para con sin sobre entre al se su sus ' +
  'le les lo como más pero ya está están este esta estos estas hay muy también tras desde hasta durante'
).split(' '));

const HI_STOP = new Set((
  'के की का में से ने को है हैं था थे थी और पर कि यह वह एक भी तो ही कर हो गया गई गए जो इस उस तक लिए साथ बाद पहले ' +
  'करने किया किए दी दिया वे यहां वहां कुछ सभी अपने अपनी रहा रही रहे जा जाने नहीं या अब जब तब कहा बताया हुई हुआ हुए'
).split(' '));

// Generic words that should not decide whether a source is about the topic.
const QUERY_STOP = new Set([
  ...EN_STOP, ...HI_STOP,
  'vs', 'v', 'match', 'matches', 'preview', 'previews', 'prediction', 'predictions', 'standings', 'table',
  'points', 'fixture', 'fixtures', 'schedule', 'lineup', 'lineups', 'probable', 'xi', 'live', 'score',
  'scores', 'result', 'results', 'today', 'tomorrow', 'latest', 'breaking', 'video', 'photos', 'watch',
]);

const DEV = /[\u0900-\u097F]/g;
const LAT = /[A-Za-z]/g;
const ES_ACCENT = /[áéíóúñ¿¡ü]/i;

export const targetLang = (env) => (/^en/i.test(String((env && env.POST_LANG) || '')) ? 'en' : 'hi');

const norm = (s) => String(s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isoDate = (ts) => { const d = new Date(Number(ts) * 1000); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : ''; };

// Hindi = Devanagari. Latin text = English vs Spanish by common function words + accents.
// Anything else is "other" and is never used for a Hindi/English post.
export function detectLang(text) {
  const s = String(text || '');
  const dev = (s.match(DEV) || []).length;
  const lat = (s.match(LAT) || []).length;
  if (dev >= 6 && dev / Math.max(1, dev + lat) >= 0.25) return 'hi';
  if (lat < 8) return 'other';
  const words = tok(s);
  let en = 0, es = 0;
  for (const w of words) {
    if (EN_STOP.has(w)) en++;
    if (ES_STOP.has(w)) es++;
  }
  if (ES_ACCENT.test(s) && en <= es) return 'es';
  if (es >= 2 && es > en * 1.15) return 'es';
  if (en >= 1 || lat >= 30) return 'en';
  return 'other';
}

const contentWords = (query) => tok(query).filter((w) => w.length > 1 && !/^\d+$/.test(w) && !QUERY_STOP.has(w));

// 0..1: how much this source is really about the topic. Title is weighted highest, and adjacent
// query words (bigrams) matter because "real sociedad" is a stronger signal than "real" alone.
export function relevance(query, src) {
  const q = contentWords(query);
  if (!q.length) return 0.5;
  const title = String((src && src.title) || '').toLowerCase();
  const text = `${(src && src.title) || ''} ${(src && src.snippet) || ''} ${(src && src.text) || ''}`.toLowerCase();
  const wordHits = q.filter((w) => text.includes(w)).length / q.length;
  const titleHits = q.filter((w) => title.includes(w)).length / q.length;
  let bigrams = 0, total = 0;
  for (let i = 0; i + 1 < q.length; i++) {
    total++;
    if (text.includes(`${q[i]} ${q[i + 1]}`)) bigrams++;
  }
  const bigramHits = total ? bigrams / total : wordHits;
  return round(0.4 * wordHits + 0.35 * titleHits + 0.25 * bigramHits);
}

// Names that appear at least twice (sentence-start noise is ignored by counting).
function namesIn(text) {
  const count = new Map();
  for (const m of String(text || '').matchAll(/\b[A-Z][A-Za-z]{2,}\b/g)) {
    const w = m[0];
    if (EN_STOP.has(w.toLowerCase())) continue;
    count.set(w, (count.get(w) || 0) + 1);
  }
  return [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w);
}

function briefText(b) {
  const lines = [];
  lines.push(`TOPIC: ${b.query}`);
  lines.push(`PRE-READ: ${b.stats.usable} usable source(s), ${b.stats.fullText} with full article text, ${b.stats.facts} facts (${b.stats.agreed} agreed by 2+ outlets), language ${b.lang}${b.mixed ? ' + fallback' : ''}, newest source ${b.stats.newestAgeHours == null ? 'unknown' : b.stats.newestAgeHours + 'h old'}.`);
  if (b.trust) lines.push(`SOURCE TRUST: ${trustText(b.trust)}. Official/financial sources first; blog/social/unknown is not proof.`);
  lines.push('');
  const agreed = b.facts.filter((f) => (f.agree || 0) >= 2);
  const single = b.facts.filter((f) => (f.agree || 0) < 2);
  lines.push('AGREED FACTS (reported by 2 or more outlets — safest to use):');
  if (agreed.length) for (const f of agreed.slice(0, 8)) lines.push(`- ${f.text} (${(f.outlets || []).join(', ')})`);
  else lines.push('- koi agreed fact nahi mila');
  if (single.length) {
    lines.push('');
    lines.push('SINGLE-SOURCE FACTS (use only with attribution, or leave out):');
    for (const f of single.slice(0, 5)) lines.push(`- ${f.text} (${(f.outlets || []).join(', ')})`);
  }
  lines.push('');
  lines.push(`NUMBERS ALLOWED (only these; never invent another): ${b.allowedNumbers.length ? b.allowedNumbers.join(', ') : 'none'}`);
  lines.push(`DATES IN SOURCES: ${b.dates.length ? b.dates.join(', ') : 'none'}`);
  lines.push(`NAMES SEEN: ${b.names.length ? b.names.join(', ') : 'none'}`);
  lines.push(`MISSING / DO NOT INVENT: ${b.gaps.length ? b.gaps.join('; ') : 'nothing obvious'}`);
  return lines.join('\n');
}

// Build the brief. opts: { lang, nowSec, minSources, maxAgeDays, needDates, label }
export function buildBrief(topic, sources, opts = {}) {
  const query = String((topic && topic.query) || topic || '').trim();
  const preferred = opts.lang === 'en' ? 'en' : opts.lang === 'hi' ? 'hi' : 'hi';
  const other = preferred === 'en' ? 'hi' : 'en';
  const nowSec = Number(opts.nowSec) || now();
  const minSources = Math.max(2, Number(opts.minSources) || 3);
  const minFull = Math.max(1, Number(opts.minFull) || 2);
  const minChars = Math.max(400, Number(opts.minChars) || 1500);
  const maxAgeDays = Math.max(1, Number(opts.maxAgeDays) || 7);
  const label = String(opts.label || '').trim();
  const raw = Array.isArray(sources) ? sources : [];

  const dropped = [];
  const seenUrl = new Set(), seenText = new Set();
  const read = [];

  for (const s0 of raw) {
    const s = s0 || {};
    const source = String(s.source || hostOf(s.url) || 'source');
    const title = String(s.title || '').trim();
    const url = String(s.url || '').trim();
    const text = norm(s.text || '');
    const snippet = norm(s.snippet || '');
    const combined = norm(`${title}\n${snippet}\n${text}`);
    const bad = (reason) => dropped.push({ source, title, url, reason });

    if (!combined) { bad('text nahi hai'); continue; }
    if (looksInjected(combined)) { bad('AI ko hukm dene wala text (injection)'); continue; }
    if (url && seenUrl.has(url)) { bad('duplicate URL'); continue; }
    if (url) seenUrl.add(url);
    const key = combined.slice(0, 180).toLowerCase();
    if (seenText.has(key)) { bad('duplicate text'); continue; }
    seenText.add(key);

    const lang = detectLang(combined);
    const rel = relevance(query, { title, snippet, text });
    const full = text.length > 300;
    const chars = combined.length;
    if (chars < 120) { bad('bahut kam text'); continue; }
    if (!['hi', 'en', 'es', 'other'].includes(lang)) { bad('language pata nahi chali'); continue; }
    read.push({ source, title, url, snippet, text, date: Number(s.date) || 0, lang, rel, full, chars });
  }

  // Language: prefer the site language. If that is too thin, allow the other supported language
  // (English <-> Hindi) with a warning. Spanish/other languages never pass.
  const primary = read.filter((s) => s.lang === preferred);
  const fallback = read.filter((s) => s.lang === other);
  const mixed = primary.length < minSources && fallback.length > 0;
  const pool = mixed ? [...primary, ...fallback] : primary;
  const foreign = read.filter((s) => s.lang !== preferred && s.lang !== other);

  // Relevance: unrelated sources are dropped before they can pollute the brief.
  const relevant = pool.filter((s) => s.rel >= 0.45);
  for (const s of pool.filter((x) => x.rel < 0.45)) dropped.push({ source: s.source, title: s.title, url: s.url, reason: `topic se related nahi (relevance ${Math.round(s.rel * 100)}%)` });
  for (const s of foreign) dropped.push({ source: s.source, title: s.title, url: s.url, reason: `doosri bhasha (${s.lang}), post ${preferred} me hai` });
  if (!mixed) for (const s of fallback) dropped.push({ source: s.source, title: s.title, url: s.url, reason: `fallback bhasha (${s.lang}) ki zaroorat nahi padi, post ${preferred} me hai` });

  const notes = relevant.map((s) => s.text || s.snippet).join('\n\n');
  const factsOut = extractFacts(relevant, { lang: preferred, max: 8 });
  const fullText = relevant.filter((s) => s.full).length;
  const chars = relevant.reduce((a, s) => a + s.chars, 0);
  const dates = relevant.map((s) => s.date).filter((d) => Number.isFinite(d) && d > 0);
  const newest = dates.length ? Math.max(...dates) : 0;
  const newestAgeSec = newest ? Math.min(1e9, Math.max(0, nowSec - newest)) : null;
  const newestAgeDays = newestAgeSec == null ? null : round(newestAgeSec / DAY, 1);

  const allowedNumbers = [...new Set(numbersIn(notes))].slice(0, 40);
  const dateList = [...new Set([...dates.map(isoDate).filter(Boolean), ...splitSentences(notes).flatMap((x) => (x.match(/\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/gi) || []))])].slice(0, 12);
  const names = namesIn(notes);

  const gaps = [];
  if (!dates.length) gaps.push('sources me tareekh nahi mili');
  else if (newestAgeSec != null && newestAgeSec > maxAgeDays * DAY) gaps.push(`sabse nayi source ${newestAgeDays} din purani hai`);
  if (!allowedNumbers.length) gaps.push('sources me koi sankhya/aankda nahi');
  if (!names.length && preferred === 'en') gaps.push('sources me koi naam nahi mila');
  if (/\b(score|result|standings|points table)\b/i.test(query) && !/\b\d+\s*[-–:]\s*\d+\b/.test(notes)) gaps.push('score/result sources me nahi hai');

  // Source trust is computed here so every caller (writer, deepen, admin) sees the same ranking.
  const briefSources = sortByTrust(relevant.map((s) => ({
    source: s.source, title: s.title, url: s.url, snippet: s.snippet,
    text: (s.text || s.snippet).slice(0, 2500), date: s.date,
    lang: s.lang, relevance: s.rel, full: s.full
  })));
  const trust = trustSummary(briefSources);

  const stats = {
    total: raw.length,
    usable: relevant.length,
    fullText,
    outlets: new Set(relevant.map((s) => hostOf(s.url)).filter(Boolean)).size,
    chars,
    facts: factsOut.facts.length,
    agreed: factsOut.agreed,
    newestAt: newest || null,
    newestAgeHours: newestAgeDays == null ? null : round(newestAgeDays * 24, 1),
    trustScore: trust.score,
    trustLevel: trust.level,
    independentSources: trust.independent,
  };

  let reason = '';
  if (!raw.length) reason = 'Koi source nahi mila';
  else if (!relevant.length) reason = `Koi kaam ka source nahi mila (${dropped.length} hate, ${foreign.length} doosri bhasha)`;
  else if (relevant.length < minSources) reason = `${label || 'Post'}: sirf ${relevant.length} kaam ke source mile, ${minSources} chahiye (foreign/irrelevant sources hate)`;
  else if (fullText < minFull) reason = `Sirf ${fullText} source ka poora article text mila, ${minFull} chahiye`;
  else if (chars < minChars) reason = `Sources ka text bahut kam hai (${chars} akshar, ${minChars} chahiye)`;
  else if (factsOut.facts.length < 2) reason = `Sources se sirf ${factsOut.facts.length} fact nikle, kam se kam 2 chahiye`;
  else if (opts.needDates && !dates.length) reason = `${label || 'Post'}: sources ki tareekh nahi mili, taaza hone ka saboot nahi`;
  else if (newestAgeSec != null && newestAgeSec > maxAgeDays * DAY) reason = `${label || 'Post'}: sabse nayi source ${newestAgeDays} din purani hai (limit ${maxAgeDays} din)`;

  const ok = !reason;
  let quality = 0;
  quality += Math.min(30, relevant.length * 6);
  quality += Math.min(25, fullText * 10);
  quality += Math.min(20, factsOut.facts.length * 4);
  quality += Math.min(15, Math.round(chars / 300));
  quality += newestAgeSec != null && newestAgeSec <= 2 * DAY ? 10 : 0;
  quality = Math.max(0, Math.min(100, quality));

  const brief = {
    version: 1,
    ok,
    retry: true,
    reason: ok ? '' : reason,
    query,
    lang: preferred,
    mixed,
    quality,
    stats,
    facts: factsOut.facts,
    allowedNumbers,
    dates: dateList,
    names,
    gaps,
    trust,
    sources: briefSources,
    dropped,
    briefText: ''
  };
  brief.briefText = briefText(brief);
  return brief;
}
