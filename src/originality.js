// originality.js — ZERO-token "is this actually new writing?" score.
//
// copyCheck in writer.js catches long copied runs. This module answers a different question:
// how much of the article is fresh writing at all? A press-release rewrite can pass copyCheck
// (no 10-word copy) yet still be 90% source sentences with synonyms swapped.
//
// It compares 6-word runs of every sentence with all source text. A sentence that shares a
// large share of its 6-word runs with the sources is marked as "not original".
//
// No AI, no network.

import { tok } from './verify.js';

const N = 6;

export function ngrams(text, n = N) {
  const t = tok(text);
  const set = new Set();
  for (let i = 0; i + n <= t.length; i++) set.add(t.slice(i, i + n).join(' '));
  return set;
}

const sentenceList = (text) => String(text || '')
  .replace(/^##.*$/gm, ' ')
  .split(/(?<=[।.!?])\s+|\n+/)
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter((s) => tok(s).length >= 8);

// score 0..1 (share of original sentences), penalty 0..10 for the writer score.
export function originality(text, sources, opts = {}) {
  const n = Math.max(3, Number(opts.n ?? N));
  const copiedAt = Math.min(0.9, Math.max(0.1, Number(opts.copiedAt ?? 0.3)));
  const target = Math.min(1, Math.max(0.5, Number(opts.target ?? 0.85)));

  const src = new Set();
  for (const s of sources || []) for (const g of ngrams(s && (s.text || s.content || s.snippet || s), n)) src.add(g);

  const sents = sentenceList(text);
  if (!sents.length) return { score: 0, copied: 0, total: 0, penalty: 10, notes: ['Text bahut kam hai'] };

  let copied = 0;
  for (const sent of sents) {
    const grams = [...ngrams(sent, n)];
    if (!grams.length) continue;
    let hit = 0;
    for (const g of grams) if (src.has(g)) hit++;
    if (hit / grams.length >= copiedAt) copied++;
  }

  const total = sents.length;
  const score = Math.round(((total - copied) / total) * 1000) / 1000;
  const penalty = score >= target ? 0 : Math.min(10, Math.ceil((target - score) * 40));
  const notes = [];
  if (copied) notes.push(`${copied}/${total} vakya sources se bahut milte hain`);
  if (penalty) notes.push(`Originality ${Math.round(score * 100)}% (target ${Math.round(target * 100)}%)`);

  return { score, copied, total, penalty, notes };
}
