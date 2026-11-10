// style.js — ZERO-token "human-like writing" guard.
//
// It does not try to beat AI detectors (those are unreliable). It catches the obvious things that
// make an article read like machine output and that Google/readers dislike:
//   * stock AI phrases ("furthermore", "in conclusion", "it is important to note")
//   * every sentence the same length / no rhythm
//   * the same opening words again and again
//   * the same 4-word phrase repeated in several paragraphs
//   * no short sentence and no long sentence anywhere
//
// The result is a penalty (max 15 points) applied to the writer score and saved in check_json.
// No extra AI call is made.

export const BANNED_PHRASES = [
  'furthermore', 'moreover', 'in conclusion', 'it is important to note', 'it is worth noting',
  'delve into', 'in today\'s fast-paced world', 'in the ever-evolving', 'ever-evolving landscape',
  'testament to', 'unlock the potential', 'navigate the complexities', 'in the realm of',
  'a game changer', 'game-changer', 'revolutionize', 'revolutionizing', 'seamlessly', 'cutting-edge',
  'tapestry of', 'embark on', 'pivotal role', 'crucial role', 'plays a vital role',
  'इस लेख में', 'यह ध्यान देने योग्य है', 'यह उल्लेखनीय है', 'निष्कर्ष के रूप में',
  'आज के तेज़ी से बदलती दुनिया', 'आज के दौर में', 'महत्वपूर्ण भूमिका निभाता है', 'महत्वपूर्ण भूमिका निभाती है'
];

const wordsOf = (s) => String(s || '').split(/\s+/).filter(Boolean);
const lower = (s) => String(s || '').toLowerCase();

export function splitSentences(text) {
  return String(text || '')
    .replace(/^##.*$/gm, ' ') // headings are not prose
    .split(/(?<=[।.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 8);
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stddev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length);
};

function repeatedOpenings(sentences) {
  const seen = new Map();
  for (const s of sentences) {
    const key = wordsOf(s).slice(0, 2).map(lower).join(' ');
    if (!key.trim()) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  let extra = 0;
  for (const n of seen.values()) if (n > 1) extra += n - 1;
  return extra;
}

function repeatedPhrases(sentences) {
  const counts = new Map();
  for (const s of sentences) {
    const w = wordsOf(lower(s));
    const local = new Set();
    for (let i = 0; i + 4 <= w.length; i++) local.add(w.slice(i, i + 4).join(' '));
    for (const g of local) counts.set(g, (counts.get(g) || 0) + 1);
  }
  let extra = 0;
  for (const n of counts.values()) if (n >= 3) extra += n - 2;
  return extra;
}

// score 0..100, penalty 0..15 (how much the writer score should lose)
export function styleCheck(text, opts = {}) {
  const sents = splitSentences(text);
  const lens = sents.map((s) => wordsOf(s).length);
  const notes = [];
  let penalty = 0;

  const banned = BANNED_PHRASES.filter((p) => lower(text).includes(p));
  if (banned.length) {
    penalty += Math.min(18, banned.length * 6);
    notes.push(`AI-jaisi stock phrases: ${banned.slice(0, 4).join(', ')}`);
  }

  if (sents.length < 6) {
    penalty += 10;
    notes.push(`Bahut kam vakya (${sents.length})`);
  } else {
    const avg = mean(lens);
    const sd = stddev(lens);
    const shortRatio = lens.filter((l) => l < 9).length / lens.length;
    const longRatio = lens.filter((l) => l > 30).length / lens.length;

    if (avg > 29 || avg < 9) { penalty += 8; notes.push(`Vakya lambai average ${Math.round(avg)} shabd (natural 12-26)`); }
    if (sd < 4) { penalty += 9; notes.push('Har vakya lagbhag same lambai ka hai (machine jaisa rhythm)'); }
    if (longRatio > 0.32) { penalty += 6; notes.push(`${Math.round(longRatio * 100)}% vakya bahut lambe hain`); }
    if (shortRatio === 0) { penalty += 3; notes.push('Koi chhota vakya nahi (rhythm flat)'); }

    const opens = repeatedOpenings(sents);
    if (opens > 0) { penalty += Math.min(10, opens * 3); notes.push(`${opens} baar same shuruaati shabd`); }

    const rep = repeatedPhrases(sents);
    if (rep > 0) { penalty += Math.min(8, rep * 2); notes.push(`${rep} baar same 4-shabd phrase`); }
  }

  penalty = Math.max(0, Math.min(15, Math.round(penalty)));
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const minScore = Number.isFinite(Number(opts.minScore)) ? Number(opts.minScore) : null;
  return {
    score,
    penalty,
    notes,
    banned,
    sentences: sents.length,
    avgSentence: Math.round(mean(lens) * 10) / 10,
    sentenceSd: Math.round(stddev(lens) * 10) / 10,
    belowMin: minScore != null && score < minScore
  };
}

// Compact shape for check_json.
export function styleMeta(s) {
  if (!s) return null;
  return {
    score: s.score,
    penalty: s.penalty,
    notes: (s.notes || []).slice(0, 6),
    banned: (s.banned || []).slice(0, 8),
    sentences: s.sentences,
    avgSentence: s.avgSentence,
    sentenceSd: s.sentenceSd
  };
}
