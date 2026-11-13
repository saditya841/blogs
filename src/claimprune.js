// 0-token publishing repair.
//
// Almost every business draft was blocking on the same two things:
//   1. the editor's fact-check could not ground 1-2 claim lines, and `validatePost` refuses to
//      approve a post while `unsupportedCount > 0`;
//   2. the summary was 160+ characters, so Google cut it in search results.
//
// Both can be repaired deterministically, without another AI call:
//   * an unverifiable factual sentence must not stay in the article as a fact -> remove exactly
//     the sentence that carries that claim (headings and other sentences stay untouched);
//   * a long summary can be trimmed at a sentence or word boundary.
//
// Nothing here invents text. If a claim cannot be matched to a sentence, it is reported back as
// unmatched so a human still has to look at it.

const wordsOf = (s) => String(s || '')
  .toLowerCase()
  .split(/[^\p{L}\p{M}\p{N}]+/u)
  .filter((w) => w.length > 2);

// Keep sentence punctuation, including Hindi danda.
const sentencesOf = (p) => String(p || '').match(/[^.!?।]+[.!?।]+[”"']?|[^.!?।]+$/g) || [];

function splitBody(body) {
  return String(body || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
      const head = lines.filter((l) => /^##\s/.test(l));
      const rest = lines.filter((l) => !/^##\s/.test(l)).join(' ');
      return { head, sentences: sentencesOf(rest).map((s) => s.trim()).filter(Boolean) };
    })
    .filter((g) => g.head.length || g.sentences.length);
}

// claimList entries come from the editor as { c, ok, why }.
const isUnsupported = (c) => !!c && (c.ok === false || c.ok === 0) && !!String(c.c || c.claim || '').trim();

export function pruneUnsupportedClaims(body, claimList = []) {
  const groups = splitBody(body);
  const sentences = [];
  groups.forEach((g, gi) => g.sentences.forEach((text, si) => sentences.push({ gi, si, text, toks: wordsOf(text) })));

  const unsupported = (Array.isArray(claimList) ? claimList : []).filter(isUnsupported);
  const drop = new Set();
  const removed = [];
  const unmatched = [];

  for (const c of unsupported) {
    const claim = String(c.c || c.claim || '').trim();
    const ct = wordsOf(claim);
    if (!ct.length) { unmatched.push(claim); continue; }
    const have = new Set(ct);
    let best = null, bestScore = 0;
    for (const s of sentences) {
      const key = `${s.gi}:${s.si}`;
      if (drop.has(key)) continue;
      const shared = s.toks.filter((w) => have.has(w)).length;
      const recall = shared / ct.length;
      // Conservative: most of the claim's content words must appear in this one sentence.
      if (shared < 4 || recall < 0.6) continue;
      const score = recall + Math.min(1, shared / 10) * 0.2;
      if (score > bestScore) { best = s; bestScore = score; }
    }
    if (best) {
      drop.add(`${best.gi}:${best.si}`);
      removed.push({ claim, sentence: best.text });
    } else unmatched.push(claim);
  }

  if (!removed.length) return { body: String(body || ''), removed, unmatched, changed: false };

  const rebuilt = groups
    .map((g, gi) => {
      const kept = g.sentences.filter((_, si) => !drop.has(`${gi}:${si}`));
      return [...g.head, kept.join(' ')].filter((x) => x && x.trim()).join('\n');
    })
    .filter((p) => p.trim())
    .join('\n\n');

  return { body: rebuilt, removed, unmatched, changed: true };
}

// Google shows ~155-160 characters. Cut at a sentence end when possible, otherwise at a word.
export function fitSummary(summary, max = 158) {
  const flat = String(summary || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const window = flat.slice(0, max + 1);
  const ends = ['. ', '। ', '! ', '? '].map((d) => window.lastIndexOf(d)).filter((i) => i >= 80);
  if (ends.length) return window.slice(0, Math.max(...ends) + 1).trim();
  const space = window.lastIndexOf(' ');
  const base = (space > 60 ? window.slice(0, space) : flat.slice(0, max - 1)).replace(/[,;:.\s]+$/, '');
  return base + '…';
}

// Shared by the writer, deepen and the admin "quick fix" button. Mutates the draft and returns
// what changed, so the admin sees exactly which lines were removed and why.
export function repairAfterFactCheck(fc, draft) {
  const out = { removed: [], unmatched: [], summaryTrimmed: false };
  if (!draft) return out;
  if (fc && Array.isArray(fc.claimList)) {
    const pr = pruneUnsupportedClaims(draft.body, fc.claimList);
    if (pr.changed) {
      draft.body = pr.body;
      fc.prunedClaims = [...(fc.prunedClaims || []), ...pr.removed].slice(-20);
      out.removed = pr.removed;
      out.unmatched = pr.unmatched;
      const keptSupported = fc.claimList.filter((c) => !isUnsupported(c)).length;
      fc.claimList = fc.claimList.filter((c) => !isUnsupported(c));
      fc.unsupportedCount = pr.unmatched.length;
      fc.supported = keptSupported;
      fc.claims = Math.max(Number(fc.claims) || 0, keptSupported + pr.unmatched.length);
      fc.verified = false; // still needs a human; numbers/names may be open
      if (fc.body) fc.body = pr.body;
    } else {
      out.unmatched = pr.unmatched;
    }
  }
  const trimmed = fitSummary(draft.summary || '');
  if (trimmed !== String(draft.summary || '')) {
    draft.summary = trimmed;
    out.summaryTrimmed = true;
  }
  return out;
}
