// Topic playbook: ZERO-token "keyword bot". It decides, with plain rules, what kind of topic this is,
// whether it is worth spending AI tokens on, and what the writer must (not) do. No AI is called here.
import { numbersNotIn, latinNotIn } from './verify.js';

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

// Business analysis is evergreen: sources may be older, and two good sources are enough.
// A hard "stock tip / buy-sell" query is still blocked, because that is advice, not analysis.
export const YMYL_STRICT = /\b(stock tips?|share tips?|buy or sell|target price|multibagger|crypto tips?|home remedies?|symptoms?|medicine|dosage|diagnos\w*|lakshan|ilaaj|ilaj|dawa|dawai|bimari|beemari)\b|निवेश सलाह|शेयर टिप|दवा|इलाज|बीमारी के लक्षण/i;

export const BUSINESS_TYPE = {
  type: 'business', label: 'Business analysis', allow: true, minSources: 2, maxAgeDays: 3650, needDates: false,
  rules: [
    'Sirf sources ke numbers/naam likho; estimate ko "estimate" likho aur formula dikhao',
    'Stock tip, buy/sell, target price ya guaranteed return mat likho',
    'Counterpoint, risk aur "kya confirm nahi hai" section zaroori hai',
    'Framework apply karo, generic advice nahi'
  ]
};

// order matters: first match wins. maxAgeDays = newest source must be this fresh. needDates = no source date -> skip.
export const TYPES = [
  { type: 'ymyl', label: 'Paisa / sehat ki salah', allow: false,
    why: 'Paisa ya sehat ki salah wala topic: galti ka nuksan bada hai, sirf insaan likhe',
    re: /\b(stock tips?|share tips?|investment tips?|buy or sell|target price|crypto|bitcoin|mutual fund|ipo gmp|gmp today|loan|insurance|home remedy|home remedies|symptoms?|medicine|dosage|diagnos\w*|lakshan|ilaaj|ilaj|dawa|dawai|bimari|beemari)\b|निवेश सलाह|शेयर टिप|दवा|इलाज|बीमारी के लक्षण/i },
  { type: 'politics', label: 'Rajniti', allow: true, minSources: 4, maxAgeDays: 2, needDates: true,
    re: /\b(modi|rahul gandhi|bjp|congress|aap party|election|chief minister|parliament|lok sabha|rajya sabha|opposition|kejriwal|nitish|yogi|assembly|vidhan sabha|govt|government)\b|चुनाव|सरकार|मंत्री|भाजपा|कांग्रेस|नरेंद्र|नरेन्द्र|मोदी|विधानसभा|लोकसभा/i,
    rules: ['Kisi neta ya party ke baare mein apni raay, tareef ya aalochna mat likho', 'Jo bhi kaha gaya woh "ne kaha" ke saath likho, notes ke hisaab se', 'Aarop ko sach ki tarah mat likho'] },
  { type: 'sports', label: 'Khel', allow: true, minSources: 4, maxAgeDays: 2, needDates: true,
    re: /\b(vs|match|ipl|odi|t20|test series|innings|wicket|century|cricket|fifa|football|kabaddi|tennis|olympics?|asia cup|world cup|toss|playing xi|man of the match|score)\b|क्रिकेट|मैच|आईपीएल|विकेट|शतक/i,
    rules: ['Runs, balls, overs, partnership, record jaise aankde sirf tab likho jab notes mein likhe hon', 'Purane match ya purane season ki baat mat milao', 'Khilaadi ki tulna, bhavishyavaani ya apni raay mat likho'] },
  { type: 'entertainment', label: 'Manoranjan', allow: true, minSources: 3, maxAgeDays: 3, needDates: true,
    re: /\b(box office|collection|movie|film|trailer|teaser|ott|release date|review|bigg boss|web series|song|cast)\b|फिल्म|कलेक्शन|बॉक्स ऑफिस|ट्रेलर|सीरीज/i,
    rules: ['Collection ya kamai ke aankde "reports ke mutabik" likho, aur sirf wahi jo notes mein hon', 'Apni review ya rating mat do', 'Kisi ki nijee zindagi ya gossip mat likho'] },
  { type: 'general', label: 'Aam khabar', allow: true, minSources: 3, maxAgeDays: 7, needDates: false,
    rules: ['Sirf notes ke facts likho, apni purani jaankari ya background mat jodo'] },
];
// a topic that is only a person's name (1-2 words, no digits): the AI loves to write a biography from memory.
// (3-word queries are usually events/topics like "Odisha train accident", so they must NOT be treated as names.)
const NAME_ONLY = { type: 'name_only', label: 'Sirf naam', allow: true, minSources: 4, maxAgeDays: 2, needDates: true,
  rules: ['Sirf wahi taaza ghatna likho jo notes ka sabse naya hissa hai', 'Career, purani uplabdhiyan ya biography mat likho'] };

export function classify(query, businessMode = false) {
  const q = String(query || '').trim();
  if (businessMode && !YMYL_STRICT.test(q)) return BUSINESS_TYPE;
  for (const t of TYPES) if (t.re && t.re.test(q)) return t;
  const w = q.split(/\s+/).filter(Boolean);
  if (w.length >= 1 && w.length <= 2 && !/\d/.test(q)) return NAME_ONLY;
  return TYPES.find((t) => t.type === 'general');
}

const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length > 2);

// BEFORE any AI call. topic = topics row, rs = parsed research JSON. Returns { ok, retry, type, label, rules, reason }
// retry:true = baad mein (naye/taaza sources aane par) dobara ho sakta hai -> topic 'thin' banta hai, reject nahi. retry nahi = hamesha ke liye.
export function preflight(topic, rs, nowSec = now(), businessMode = false) {
  const p = classify(topic.query, businessMode);
  const base = {
    type: p.type, label: p.label, rules: p.rules || [],
    minSources: p.minSources || 3, maxAgeDays: p.maxAgeDays || 7, needDates: !!p.needDates
  };
  if (!p.allow) return { ok: false, ...base, reason: p.why };
  // The zero-token pre-read runs after research. If it says the source set is not usable,
  // do not spend a single AI token on this topic.
  if (rs && rs.brief && rs.brief.version && rs.brief.ok !== true) {
    return { ok: false, retry: true, ...base, reason: rs.brief.reason || 'Pre-read fail hua: sources kaafi nahi hain' };
  }
  const src = (rs && rs.sources) || [];
  if (src.length < p.minSources) return { ok: false, retry: true, ...base, reason: `${p.label}: sirf ${src.length} source hain, ${p.minSources} chahiye` };
  // Wikipedia is background only. A business article needs at least one real news/report source,
  // otherwise the whole piece would be built on an encyclopedia summary.
  if (p.type === 'business') {
    const nonWiki = src.filter((s) => !/wikipedia\.org/i.test(String(s.url || '')));
    if (!nonWiki.length) return { ok: false, retry: true, ...base, reason: 'Business: sirf Wikipedia mila, kam se kam ek news/report source chahiye' };
  }
  // the topic's own words must really appear in at least 2 sources (stops "unrelated sources" drafts)
  const qw = words(topic.query);
  if (qw.length) {
    const texts = src.map((s) => `${s.title || ''} ${s.snippet || ''} ${s.text || ''}`.toLowerCase());
    const found = qw.filter((w) => texts.filter((t) => t.includes(w)).length >= 2).length;
    const need = p.type === 'business' ? 0.4 : 0.6;
    if (found / qw.length < need) return { ok: false, retry: true, ...base, reason: 'Topic ke shabd 2 sources mein bhi nahi milte, sources alag cheez ki baat kar rahe hain' };
  }
  const dates = src.map((s) => s.date || 0).filter(Boolean);
  const newest = dates.length ? Math.max(...dates) : 0;
  if (!newest && p.needDates) return { ok: false, retry: true, ...base, reason: `${p.label}: sources ki tareekh nahi mili, taaza hone ka saboot nahi` };
  if (newest && nowSec - newest > p.maxAgeDays * DAY) return { ok: false, retry: true, ...base, reason: `${p.label}: sabse nayi source ${Math.round((nowSec - newest) / DAY)} din purani hai (limit ${p.maxAgeDays} din)` };
  return { ok: true, ...base };
}

// AFTER the draft, BEFORE the (expensive) AI fact-checker: invented numbers / names are caught by plain code.
export function postflight(art, notesText, lang = 'hi') {
  const full = `${art.title}\n${art.summary}\n${art.body}`;
  const nums = numbersNotIn(full, notesText);
  if (nums.length >= 3) return { ok: false, reason: `${nums.length} sankhya notes mein nahi hain (${nums.slice(0, 5).join(', ')})` };
  const names = latinNotIn(full, notesText, lang);
  if (names.length >= 4) return { ok: false, reason: `${names.length} naam ya shabd notes mein nahi hain (${names.slice(0, 5).join(', ')})` };
  return { ok: true };
}
