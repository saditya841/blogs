// voice.js — ZERO-token site-voice matcher.
//
// Problem: style.js only catches generic AI habits. It cannot tell whether an article sounds
// like THIS site. A blog feels human when its approved articles share a rhythm, paragraph size
// and a natural Hindi-English mix.
//
// This module learns a small profile from the last approved posts and penalises a new draft
// that drifts far away from it. No AI call, no extra token.

import { splitSentences } from './style.js';

const DEV = /[\u0900-\u097F]/;
const LATIN = /[a-z]/i;

const TRANSITIONS = new Set((
  'lekin par magar aur ya phir isliye kyunki jabki halanki fir bhi tab bhi saath hi ' +
  'but however although because while therefore meanwhile still also and or so yet'
).split(' ').filter(Boolean));

const wordsOf = (s) => String(s || '').split(/\s+/).filter(Boolean);

export function scriptRatio(text) {
  let dev = 0, latin = 0;
  for (const w of wordsOf(text)) {
    if (DEV.test(w)) dev++;
    else if (LATIN.test(w) && !/^\d+$/.test(w)) latin++;
  }
  const total = dev + latin;
  return { dev, latin, total, latinRatio: total ? Math.round((latin / total) * 1000) / 1000 : 0 };
}

export function paragraphsOf(text) {
  return String(text || '')
    .replace(/^##.*$/gm, ' ')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stddev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length);
};

function metricsOf(texts) {
  const sentences = [];
  const paraLens = [];
  let transitionHits = 0;
  let allWords = 0;
  let latin = 0, dev = 0;

  for (const t of texts) {
    for (const s of splitSentences(t)) sentences.push(wordsOf(s).length);
    for (const p of paragraphsOf(t)) {
      const n = splitSentences(p).length;
      if (n) paraLens.push(n);
    }
    for (const w of wordsOf(t)) {
      allWords++;
      if (TRANSITIONS.has(w.toLowerCase())) transitionHits++;
      if (DEV.test(w)) dev++;
      else if (LATIN.test(w) && !/^\d+$/.test(w)) latin++;
    }
  }

  const lens = sentences.filter((n) => n > 0);
  return {
    sentences: lens.length,
    avgSentence: Math.round(mean(lens) * 10) / 10,
    sentenceSd: Math.round(stddev(lens) * 10) / 10,
    shortRatio: lens.length ? Math.round((lens.filter((n) => n < 9).length / lens.length) * 1000) / 1000 : 0,
    avgParagraph: Math.round(mean(paraLens) * 10) / 10,
    transitionDensity: allWords ? Math.round((transitionHits / allWords) * 1000) / 1000 : 0,
    latinRatio: dev + latin ? Math.round((latin / (dev + latin)) * 1000) / 1000 : 0
  };
}

// posts = [{ title, body }] — normally the last 10 approved posts.
export function buildVoiceProfile(posts, opts = {}) {
  const list = (posts || []).filter((p) => p && p.body).slice(0, Math.max(1, Number(opts.max ?? 10)));
  const m = metricsOf(list.map((p) => p.body));
  return { version: 1, posts: list.length, ...m };
}

const pctDiff = (a, b) => {
  const base = Math.max(1, Math.abs(b));
  return Math.abs(a - b) / base;
};

// score 0..100, penalty 0..10. Fewer than 3 approved posts => no opinion (0 penalty).
export function voiceCheck(text, profile) {
  const neutral = { score: 100, penalty: 0, notes: [], compared: false };
  if (!profile || Number(profile.posts) < 3) return neutral;

  const cur = metricsOf([text]);
  if (cur.sentences < 3) return neutral;

  let penalty = 0;
  const notes = [];

  if (pctDiff(cur.avgSentence, profile.avgSentence) > 0.4) {
    penalty += 4;
    notes.push(`Sentence length site ke style se alag (${cur.avgSentence} vs ${profile.avgSentence})`);
  }
  if (profile.sentenceSd >= 3 && cur.sentenceSd < profile.sentenceSd * 0.55) {
    penalty += 3;
    notes.push('Rhythm site ke approved posts se zyada flat hai');
  }
  if (profile.avgParagraph >= 1 && pctDiff(cur.avgParagraph, profile.avgParagraph) > 0.55) {
    penalty += 2;
    notes.push(`Paragraph size style se alag (${cur.avgParagraph} vs ${profile.avgParagraph} sentences)`);
  }
  if (Math.abs(cur.shortRatio - profile.shortRatio) > 0.25) {
    penalty += 2;
    notes.push('Chhote-lambe vakya ka mix site ke style se alag');
  }
  // Only compare language mix on a genuinely mixed-language site.
  if (profile.latinRatio > 0.08 && profile.latinRatio < 0.92 && Math.abs(cur.latinRatio - profile.latinRatio) > 0.3) {
    penalty += 3;
    notes.push(`Hindi-English mix style se alag (${Math.round(cur.latinRatio * 100)}% vs ${Math.round(profile.latinRatio * 100)}% English)`);
  }

  penalty = Math.max(0, Math.min(10, penalty));
  return { score: 100 - penalty, penalty, notes, compared: true, current: cur, profile };
}

export function voiceMeta(v) {
  if (!v) return null;
  return {
    score: v.score,
    penalty: v.penalty,
    compared: !!v.compared,
    notes: (v.notes || []).slice(0, 4),
    avgSentence: v.current ? v.current.avgSentence : null,
    latinRatio: v.current ? v.current.latinRatio : null
  };
}

// Reads the last approved posts once per write. Any failure = no profile (never blocks a draft).
export async function loadVoiceProfile(env, limit = 10) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT title,body FROM posts WHERE status='approved' ORDER BY id DESC LIMIT ?"
    ).bind(Math.max(3, Math.min(20, Number(limit) || 10))).all();
    const profile = buildVoiceProfile(results || []);
    return profile.posts >= 3 ? profile : null;
  } catch {
    return null;
  }
}
