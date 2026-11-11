// claims.js — the claim ledger (ZERO-token verification).
//
// Multi-AI debate outputs claims. The AI is NEVER trusted to mark its own claim "verified".
// Plain code checks:
//   1. the EVIDENCE really exists in the collected sources (3-word shingle match),
//   2. numbers in the claim are backed by the evidence or the sources,
//   3. how many independent outlets carry that evidence.
//
// A claim is "verified" only when it is grounded AND appears in at least MIN_AGREE_SOURCES outlets.
// A grounded claim found in one outlet only is "single-source" (written as one report, not as fact).
// Everything else is "unsupported" and must not be used by the writer.

import { groundedCheck, tok, shingles } from './verify.js';
import { claimConflict, conflictSummary } from './conflicts.js';

const clean = (s) => String(s || '').replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '').replace(/\s+/g, ' ').trim();

// Lines look like:
//   CLAIM: the board approved the plan || EVIDENCE: exact words from a source || SUPPORT: reporter,analyst
export function parseClaimLines(raw) {
  const out = [];
  for (const line of String(raw || '').replace(/\r/g, '').split('\n')) {
    const m = line.match(/CLAIM\s*:\s*(.*?)\s*(?:\|\||\|)\s*EVIDENCE\s*:\s*(.*)$/i);
    if (!m) continue;
    let rest = m[2];
    let support = '';
    const sm = rest.match(/\s*(?:\|\||\|)\s*(?:SUPPORT|ROLES|AGREE(?:D)?)\s*:\s*(.*)$/i);
    if (sm) {
      support = sm[1];
      rest = rest.slice(0, sm.index);
    }
    const claim = clean(m[1]).slice(0, 220);
    const evidence = clean(rest).slice(0, 400);
    if (!claim) continue;
    out.push({
      claim,
      evidence,
      support: support.split(/[,;/|]+/).map((x) => clean(x).toLowerCase()).filter(Boolean).slice(0, 6)
    });
  }
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const outletName = (s, i) => String((s && (s.source || s.title)) || hostOf(s && s.url) || `source${i + 1}`);

// Which outlets contain this evidence (same 3-word runs)?
export function evidenceOutlets(evidence, sources) {
  const et = tok(evidence);
  const need = shingles(et, 3);
  if (!need.size) return [];
  const hits = [];
  for (const s of sources || []) {
    const have = shingles(tok(s && s.text), 3);
    let hit = 0;
    for (const x of need) if (have.has(x)) hit++;
    if (hit / need.size >= 0.6) hits.push(s);
  }
  return [...new Set(hits.map(outletName).filter(Boolean))];
}

const claimTokens = (s) => new Set(tok(s).filter((w) => w.length > 2));
function claimSimilarity(a, b) {
  const A = claimTokens(a), B = claimTokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

// Verify one claim against the sources.
export function verifyClaim(item, sources, notesText) {
  const notes = notesText ?? (sources || []).map((s) => String((s && s.text) || '')).join('\n\n');
  const raw = `CLAIM: ${item.claim} || EVIDENCE: ${item.evidence}`;
  const chk = groundedCheck(raw, notes)[0] || { ok: false, why: 'claim parse nahi hua' };
  const outlets = chk.ok ? evidenceOutlets(item.evidence, sources) : [];
  return {
    claim: item.claim,
    evidence: item.evidence,
    support: item.support || [],
    ok: !!chk.ok,
    why: chk.why || '',
    outlets
  };
}

// Merge duplicates, verify every line, and classify. Never throws.
export function buildLedger(items, sources, opts = {}) {
  const minAgree = Math.max(1, Number(opts.minAgree ?? 2));
  const notes = (sources || []).map((s) => String((s && s.text) || '')).join('\n\n');
  const merged = [];

  for (const raw of items || []) {
    if (!raw || !raw.claim) continue;
    const v = verifyClaim(raw, sources, notes);
    const same = merged.find((x) => claimSimilarity(x.claim, v.claim) >= 0.62);
    if (same) {
      same.ok = same.ok || v.ok;
      same.outlets = [...new Set([...same.outlets, ...v.outlets])];
      same.support = [...new Set([...same.support, ...v.support])];
      if (!same.evidence && v.evidence) same.evidence = v.evidence;
      continue;
    }
    merged.push({ ...v });
  }

  for (const it of merged) {
    it.outletCount = it.outlets.length;
    // Two outlets can carry the same claim with different numbers. Code catches that here.
    const cf = it.ok ? claimConflict(it.claim, sources) : { conflict: false, values: [] };
    it.conflict = !!cf.conflict;
    it.conflictValues = cf.values || [];
    it.conflictText = it.conflict ? conflictSummary(it.conflictValues) : '';
    it.agreed = it.ok && it.outletCount >= minAgree && !it.conflict;
    it.status = !it.ok ? 'unsupported' : (it.conflict ? 'conflict' : (it.agreed ? 'verified' : 'single-source'));
  }

  const verified = merged.filter((x) => x.status === 'verified');
  const singleSource = merged.filter((x) => x.status === 'single-source');
  const unsupported = merged.filter((x) => x.status === 'unsupported');
  const conflict = merged.filter((x) => x.status === 'conflict');

  return {
    version: 1,
    minAgree,
    items: merged,
    verified,
    singleSource,
    unsupported,
    conflict,
    stats: {
      total: merged.length,
      verified: verified.length,
      singleSource: singleSource.length,
      unsupported: unsupported.length,
      conflict: conflict.length
    }
  };
}

const compact = (x, n = 220) => ({
  c: String(x.claim || '').slice(0, n),
  e: String(x.evidence || '').slice(0, n + 80),
  outlets: (x.outlets || []).slice(0, 4),
  support: (x.support || []).slice(0, 4),
  conflictValues: (x.conflictValues || []).slice(0, 4)
});

// What the writer sees. Only verified + clearly-labelled single-source claims are allowed.
export function ledgerText(ledger, opts = {}) {
  if (!ledger || !Array.isArray(ledger.items)) return '';
  const max = Math.max(1, Number(opts.max ?? 10));
  const v = (ledger.verified || []).slice(0, max);
  const s = (ledger.singleSource || []).slice(0, Math.min(4, max));
  const u = (ledger.unsupported || []).slice(0, 4);
  const c = (ledger.conflict || []).slice(0, 4);
  const lines = [];
  if (v.length) {
    lines.push('VERIFIED CLAIMS (code-checked + 2 or more independent outlets). Use these as the main facts:');
    for (const x of v) lines.push(`- ${x.claim} [outlets: ${(x.outlets || []).join(', ')}]`);
  }
  if (c.length) {
    lines.push('CONFLICTS (sources give different values for the same fact). Either leave the number out or write clearly that reports differ. Never pick one value as the truth:');
    for (const x of c) lines.push(`- ${x.claim} [${x.conflictText || 'reports differ'}]`);
  }
  if (s.length) {
    lines.push('SINGLE-SOURCE CLAIMS (only one outlet says this). You may mention it only as "one report says", never as established fact:');
    for (const x of s) lines.push(`- ${x.claim} [outlet: ${(x.outlets || []).join(', ') || 'unknown'}]`);
  }
  if (u.length) {
    lines.push('NOT ALLOWED (evidence missing in sources). Never write these:');
    for (const x of u) lines.push(`- ${x.claim}`);
  }
  return lines.join('\n').slice(0, opts.maxChars || 4000);
}

// Rebuild the writer block from the compact ledger saved in topics.research (debate preview reuse).
export function ledgerTextFromMeta(meta, opts = {}) {
  if (!meta) return '';
  const map = (arr, label) => {
    const list = (arr || []).slice(0, Math.max(1, Number(opts.max ?? 10)));
    if (!list.length) return [];
    return [label, ...list.map((x) => `- ${x.c || x.claim || ''}${(x.outlets || []).length ? ` [outlets: ${x.outlets.join(', ')}]` : ''}`)];
  };
  const lines = [
    ...map(meta.verified, 'VERIFIED CLAIMS (code-checked + 2 or more independent outlets). Use these as the main facts:'),
    ...map(meta.conflict, 'CONFLICTS (sources give different values). Leave the number out or write that reports differ. Never pick one value as the truth:'),
    ...map(meta.singleSource, 'SINGLE-SOURCE CLAIMS (only one outlet says this). You may mention it only as "one report says", never as established fact:'),
    ...map(meta.unsupported, 'NOT ALLOWED (evidence missing in sources). Never write these:')
  ];
  return lines.join('\n').slice(0, opts.maxChars || 4000);
}

// Compact shape for check_json / topics.research (D1 stays small).
export function ledgerMeta(ledger, opts = {}) {
  if (!ledger || !Array.isArray(ledger.items)) return null;
  const cap = Math.max(1, Number(opts.max ?? 12));
  return {
    version: 1,
    minAgree: ledger.minAgree || 0,
    stats: ledger.stats || { total: 0, verified: 0, singleSource: 0, unsupported: 0, conflict: 0 },
    verified: (ledger.verified || []).slice(0, cap).map((x) => compact(x)),
    singleSource: (ledger.singleSource || []).slice(0, cap).map((x) => compact(x)),
    unsupported: (ledger.unsupported || []).slice(0, cap).map((x) => compact(x)),
    conflict: (ledger.conflict || []).slice(0, cap).map((x) => compact(x))
  };
}
