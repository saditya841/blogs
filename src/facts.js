// facts.js — ZERO-token: sources ke sentences mein se wo facts chunta hai jo kam se kam 2 alag outlet mein milte hain.
// Idea: do alag outlet ek hi baat likhein (same tareekh/sankhya + milte-julte shabd) to wo fact bharose layak hai.
// Koi AI nahi, koi internet nahi. Pure function.
import { tok, numbersIn, devDigits, looksInjected } from './verify.js';

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  'जनवरी': 1, 'फरवरी': 2, 'मार्च': 3, 'अप्रैल': 4, 'मई': 5, 'जून': 6, 'जुलाई': 7, 'अगस्त': 8,
  'सितंबर': 9, 'सितम्बर': 9, 'अक्टूबर': 10, 'अक्तूबर': 10, 'नवंबर': 11, 'नवम्बर': 11, 'दिसंबर': 12, 'दिसम्बर': 12,
};
const STOP = new Set((
  'के की का में से ने को है हैं था थे थी और पर कि यह वह एक भी तो ही कर हो गया गई गए जो इस उस तक लिए साथ बाद पहले करने किया किए दी दिया ' +
  'वे यहां वहां कुछ सभी अपने अपनी रहा रही रहे जा जाने नहीं या अब जब तब कहा बताया हुई हुआ हुए होगा होगी होंगे सकता सकती द्वारा दौरान बीच ' +
  'the a an of in on at to for and or is are was were be been by with from that this it its as has have had also after before over'
).split(' '));
const BOILER = /पढ़ें|क्लिक|विज्ञापन|सब्सक्राइब|फॉलो करें|also read|read more|click here|subscribe|advertisement|follow us|whatsapp/i;
const DEV = /[\u0900-\u097F]/g;

export function splitSentences(text) {
  return String(text || '').split(/(?<=[।!?.])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// "16 नवंबर", "November 16", "१६ नवंबर" -> '11-16'
export function dateKeys(text) {
  const t = devDigits(String(text || '')).toLowerCase();
  const out = new Set();
  for (const m of t.matchAll(/(\d{1,2})\s*([\p{L}\p{M}]+)/gu)) { const mo = MONTHS[m[2]]; const d = +m[1]; if (mo && d >= 1 && d <= 31) out.add(`${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`); }
  for (const m of t.matchAll(/([\p{L}\p{M}]+)\s*(\d{1,2})(?!\d)/gu)) { const mo = MONTHS[m[1]]; const d = +m[2]; if (mo && d >= 1 && d <= 31) out.add(`${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`); }
  return [...out].sort();
}

function analyze(text) {
  const dates = dateKeys(text);
  const keys = new Set([...numbersIn(text).map((n) => '#' + n), ...dates.map((d) => 'D' + d)]);
  const words = new Set(tok(text).filter((w) => w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w) && !MONTHS[w]));
  return { keys, words };
}
const shared = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
const devShare = (s) => ((s.match(DEV) || []).length) / Math.max(1, (s.match(/\p{L}/gu) || []).length);

// do sentences (alag outlet) ek hi fact hain?
const sameFact = (a, b) => { const k = shared(a.keys, b.keys), w = shared(a.words, b.words); return (k >= 1 && w >= 2) || w >= 4; };

export function extractFacts(sources, opts = {}) {
  const lang = opts.lang || 'hi', max = opts.max || 5;
  const cands = [];
  (Array.isArray(sources) ? sources : []).forEach((s, si) => {
    const name = String((s && (s.source || s.title)) || 'source' + si);
    const sents = splitSentences(`${(s && s.snippet) || ''}\n${(s && s.text) || ''}`);
    sents.forEach((text, pos) => {
      if (text.length < 25 || text.length > 320 || BOILER.test(text) || looksInjected(text)) return;
      const a = analyze(text);
      if (a.words.size < 3) return;
      cands.push({ text, outlet: name, url: (s && s.url) || '', pos, ...a });
    });
  });
  if (!cands.length) return { facts: [], agreed: 0, total: 0 };

  // union-find: alag outlet ke milte-julte sentences ek cluster
  const par = cands.map((_, i) => i);
  const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
    if (cands[i].outlet !== cands[j].outlet && sameFact(cands[i], cands[j])) par[find(j)] = find(i);
  }
  const groups = new Map();
  cands.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });

  const clusters = [...groups.values()].map((g) => {
    const outlets = [...new Set(g.map((x) => x.outlet))];
    const rep = [...g].sort((x, y) => (y.keys.size - x.keys.size) || (x.pos - y.pos))[0];
    let score = outlets.length * 10 + Math.min(3, rep.keys.size) * 1.5 + (rep.pos < 3 ? 2 : 0);
    const dv = devShare(rep.text);
    if (lang === 'hi' && dv < 0.3) score -= 8;
    if (lang === 'en' && dv > 0.5) score -= 8;
    return { text: rep.text, outlets, agree: outlets.length, keys: [...rep.keys], urls: [...new Set(g.map((x) => x.url).filter(Boolean))], words: rep.words, score };
  }).sort((x, y) => y.score - x.score);

  const agreed = clusters.filter((c) => c.agree >= 2).length;
  const picked = [];
  for (const c of clusters) {
    if (picked.length >= max) break;
    if (picked.some((p) => shared(p.words, c.words) / Math.max(1, Math.min(p.words.size, c.words.size)) >= 0.6)) continue; // ek jaisa fact dobara nahi
    picked.push(c);
  }
  return { facts: picked.map(({ words, score, ...f }) => f), agreed, total: clusters.length };
}
