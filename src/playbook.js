// Topic playbook: ZERO-token "keyword bot". It decides, with plain rules, what kind of topic this is,
// whether it is worth spending AI tokens on, and what the writer must (not) do. No AI is called here.
import { numbersNotIn, latinNotIn } from './verify.js';

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

// order matters: first match wins. maxAgeDays = newest source must be this fresh. needDates = no source date -> skip.
export const TYPES = [
  { type: 'ymyl', label: 'Paisa / sehat ki salah', allow: false,
    why: 'Paisa ya sehat ki salah wala topic: galti ka nuksan bada hai, sirf insaan likhe',
    re: /\b(stock tips?|share tips?|investment tips?|buy or sell|target price|crypto|bitcoin|mutual fund|ipo gmp|gmp today|loan|insurance|home remedy|home remedies|symptoms?|medicine|dosage|diagnos\w*)\b|निवेश सलाह|शेयर टिप|दवा|इलाज|बीमारी के लक्षण/i },
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
// a topic that is only a person's name (1-3 words, no digits): the AI loves to write a biography from memory
const NAME_ONLY = { type: 'name_only', label: 'Sirf naam', allow: true, minSources: 4, maxAgeDays: 2, needDates: true,
  rules: ['Sirf wahi taaza ghatna likho jo notes ka sabse naya hissa hai', 'Career, purani uplabdhiyan ya biography mat likho'] };

export function classify(query) {
  const q = String(query || '').trim();
  for (const t of TYPES) if (t.re && t.re.test(q)) return t;
  const w = q.split(/\s+/).filter(Boolean);
  if (w.length >= 1 && w.length <= 3 && !/\d/.test(q)) return NAME_ONLY;
  return TYPES.find((t) => t.type === 'general');
}

const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length > 2);

// BEFORE any AI call. topic = topics row, rs = parsed research JSON. Returns { ok, type, label, rules, reason }
export function preflight(topic, rs, nowSec = now()) {
  const p = classify(topic.query);
  const base = { type: p.type, label: p.label, rules: p.rules || [] };
  if (!p.allow) return { ok: false, ...base, reason: p.why };
  const src = (rs && rs.sources) || [];
  if (src.length < p.minSources) return { ok: false, ...base, reason: `${p.label}: sirf ${src.length} source hain, ${p.minSources} chahiye` };
  // the topic's own words must really appear in at least 2 sources (stops "unrelated sources" drafts)
  const qw = words(topic.query);
  if (qw.length) {
    const texts = src.map((s) => `${s.title || ''} ${s.snippet || ''} ${s.text || ''}`.toLowerCase());
    const found = qw.filter((w) => texts.filter((t) => t.includes(w)).length >= 2).length;
    if (found / qw.length < 0.6) return { ok: false, ...base, reason: 'Topic ke shabd 2 sources mein bhi nahi milte, sources alag cheez ki baat kar rahe hain' };
  }
  const dates = src.map((s) => s.date || 0).filter(Boolean);
  const newest = dates.length ? Math.max(...dates) : 0;
  if (!newest && p.needDates) return { ok: false, ...base, reason: `${p.label}: sources ki tareekh nahi mili, taaza hone ka saboot nahi` };
  if (newest && nowSec - newest > p.maxAgeDays * DAY) return { ok: false, ...base, reason: `${p.label}: sabse nayi source ${Math.round((nowSec - newest) / DAY)} din purani hai (limit ${p.maxAgeDays} din)` };
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
