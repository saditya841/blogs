// Pure fact-check helpers (no network, no DB). Used by writer.js and by the tests.
// Idea: the AI may only ADD evidence; plain code decides whether that evidence really exists in the source notes.

export const tok = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);

export const shingles = (t, k = 6) => {
  const s = new Set();
  for (let i = 0; i + k <= t.length; i++) s.add(t.slice(i, i + k).join(' '));
  return s;
};

export const devDigits = (s) => String(s || '').replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));
// "12,000" and "१२,०००" both become "12000" so numbers compare equal
export const normNums = (s) => devDigits(s).replace(/(\d),(?=\d)/g, '$1');
export const numbersIn = (s) => normNums(s).match(/\d+(?:\.\d+)?/g) || [];

// ---- 1) claim + evidence lines -> verified by code ----
// A claim is "ok" only if: evidence is real text from the notes (3-word runs), and its numbers are backed by the evidence.
export function groundedCheck(raw, notesText) {
  const src = shingles(tok(notesText), 3);
  const noteNums = new Set(numbersIn(notesText));
  const claims = [];
  for (const line of String(raw || '').split('\n')) {
    const m = line.match(/CLAIM\s*:\s*(.*?)\s*\|\|\s*EVIDENCE\s*:\s*(.*)$/i);
    if (!m) continue;
    const claim = m[1].slice(0, 160);
    const ev = m[2].replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '');
    let ok = false, why = '';
    if (!ev || /^NONE\b/i.test(ev)) why = 'sources mein sabut nahi';
    else {
      const et = tok(ev);
      if (et.length < 3) why = 'evidence bahut chhota';
      else {
        const t3 = shingles(et, 3); let hit = 0;
        for (const x of t3) if (src.has(x)) hit++;
        if (!(t3.size > 0 && hit / t3.size >= 0.6)) why = 'evidence notes mein nahi mila';
        else {
          ok = true;
          const evNums = new Set(numbersIn(ev));
          for (const n of new Set(numbersIn(claim))) {
            const year = /^(19|20)\d\d$/.test(n), single = n.length === 1;
            // years and single digits only need to exist somewhere in the notes; every other number must sit inside the evidence itself
            if (!((year || single) ? noteNums.has(n) : evNums.has(n))) { ok = false; why = `sankhya ${n} evidence mein nahi`; break; }
          }
        }
      }
    }
    claims.push({ claim, ok, why, evidence: ev });
  }
  return claims;
}

// ---- 2) second opinion: does the evidence really say what the claim says? (simple YES/NO, separate AI call) ----
export function entailPrompt(claims) {
  return `You are a strict fact-checker. For each numbered item, decide whether the EVIDENCE text directly states or clearly implies the CLAIM.
Answer NO if the claim says more than the evidence (extra names, numbers, places, results, reasons, or a bigger or different event) or says something different.
Reply with exactly one line per item: "<number>: YES" or "<number>: NO". No other text.

${claims.map((c, i) => `${i + 1}. CLAIM: ${c.claim}\n   EVIDENCE: ${c.evidence}`).join('\n')}`;
}
// -> array of true/false/null (null = the AI did not answer that item)
export function parseEntail(raw, n) {
  const out = new Array(n).fill(null);
  for (const m of String(raw || '').matchAll(/^\s*(\d+)\s*[:.)-]\s*(YES|NO)\b/gim)) {
    const i = Number(m[1]) - 1;
    if (i >= 0 && i < n) out[i] = m[2].toUpperCase() === 'YES';
  }
  return out;
}

// ---- 3) code-only guards on the whole article (title + summary + body) ----
// numbers with 2+ digits (or decimals) that never occur in the notes: invented figures / dates
export function numbersNotIn(text, notesText) {
  const have = new Set(numbersIn(notesText));
  return [...new Set(numbersIn(text))].filter((n) => (n.length >= 2 || n.includes('.')) && !have.has(n)).slice(0, 10);
}
// Capitalised Latin-script words (names, brands, acronyms) that never occur in the notes. English posts skip a lone capitalised word that starts a sentence.
export function latinNotIn(text, notesText, lang = 'hi') {
  const have = new Set(String(notesText || '').toLowerCase().match(/[a-z]+/g) || []);
  const t = String(text || ''), out = new Set();
  for (const m of t.matchAll(/\b[A-Z][A-Za-z]{2,}\b/g)) {
    if (lang === 'en') {
      const before = t.slice(0, m.index).replace(/[ \t]+$/, '');
      if (!before || /[.!?\n]$/.test(before)) continue;
    }
    if (!have.has(m[0].toLowerCase())) out.add(m[0]);
  }
  return [...out].slice(0, 10);
}

// ---- 4) split an article into pieces so every piece gets its own claim list (an AI cannot skip a bad paragraph) ----
export function chunkArticle(title, summary, body, maxChars = 1000, maxChunks = 5) {
  const blocks = []; let head = '';
  for (const b of String(body || '').replace(/\r/g, '').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    if (/^##\s/.test(b)) { head = head ? head + '\n' + b : b; continue; } // a heading travels with the paragraph after it
    blocks.push(head ? head + '\n' + b : b); head = '';
  }
  if (head) blocks.push(head);
  const first = `${title || ''}\n${summary || ''}`.trim(); // headline + meta description are published too, so they are checked too
  const total = first.length + blocks.reduce((a, b) => a + b.length, 0);
  const limit = Math.max(maxChars, Math.ceil(total / maxChunks));
  const chunks = []; let cur = first ? [first] : [], len = first.length;
  for (const b of blocks) {
    if (cur.length && len + b.length > limit) { chunks.push(cur.join('\n\n')); cur = []; len = 0; }
    cur.push(b); len += b.length;
  }
  if (cur.length) chunks.push(cur.join('\n\n'));
  return chunks;
}
// the checker should list about one claim per four sentences (max 6 per part), otherwise it probably skipped things
export function expectedClaims(chunk) {
  const sentences = String(chunk || '').split(/[।.!?\n]+/).filter((s) => s.trim().length >= 8).length;
  return Math.max(1, Math.min(6, Math.floor(sentences / 4)));
}

// ---- 5) readable URL slug (Hindi titles used to become just "post-xxxxx") ----
export function cleanSlug(raw) {
  let s = String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-[^-]*$/, '');
  return s.length >= 4 ? s : '';
}
export const slugFrom = (art) => cleanSlug(art.slug) || cleanSlug(art.title) || cleanSlug(art.tags) || 'news';
