// Step 3 (v2): ready topic -> ZERO-token pre-read (language, relevance, facts, allowed numbers) -> AI draft
// (written ONLY from the reading brief + topic's sources) -> copy check (+1 rewrite retry)
// -> AI editor + fact-check pass (adds Vishleshan/Analysis + claim evidence, code verifies it) -> real score
// -> image + thumbnail + SEO -> saved as DRAFT, topic marked 'drafted'.
//
// Fixes vs the deployed version:
//  * score was hard-coded 90 -> now computed from copy overlap, longest copied run, unsourced numbers, length, structure
//  * the prompt had NO sources (AI wrote from memory) -> sources are inside the prompt, with "do not invent" rules
//  * copy check result was ignored -> now: 1 rewrite retry, then reject if still copied
//  * topic stayed 'ready' after drafting (same topic drafted again and again) -> marked 'drafted' atomically with the insert
//  * "undefined shabd" -> words / wordCount returned
//  * slug was generated twice (SEO and DB had different slugs) -> generated once
//  * daily limit counted a rolling 24h window -> now counts the IST calendar day (resets at 12:00 AM IST)
//  * thumbnail / featured image / SEO meta columns were never saved -> saved; image_url + image_credit filled too
//  * POST_LANG "eng" is understood as English
//  * editor.js now saves check_json, so the review page shows claim-by-claim evidence and auto-publish has a real gate

import { runAI } from './ai.js';
import { CATS } from './validate.js';
import { preflight } from './playbook.js';
import { ImageGenerator } from './image-generator.js';
import { ViralThumbnailGenerator } from './viral-thumbnail-generator.js';
import { SEOOptimizer } from './seo-optimizer.js';
import { factCheck, hasAnalysisSection } from './editor.js';
import { buildBrief } from './preread.js';
import { researchTopic } from './trends.js';
import { brandedImage } from './media.js';
import { runDebate, debateBrief, debateMeta, ledgerTextFromMeta } from './debate.js';
import { fingerprint, findDuplicate, loadExistingFingerprints, saveFingerprint } from './similarity.js';
import { styleCheck, styleMeta } from './style.js';

const now = () => Math.floor(Date.now() / 1000);
export { CATS }; // single source of truth (validate.js)

// ---------- small helpers (exported so they can be unit-tested) ----------
export const langOf = (env) => (/^en/i.test(String((env && env.POST_LANG) || '')) ? 'en' : 'hi');

const IST = 19800;
export const dayStartIST = (ts = now()) => Math.floor((ts + IST) / 86400) * 86400 - IST;

const tok = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
const K = 6;
const shingles = (t, k = K) => { const s = new Set(); for (let i = 0; i + k <= t.length; i++) s.add(t.slice(i, i + k).join(' ')); return s; };

export function copyCheck(articleText, sourceTexts) {
  const a = tok(articleText), src = new Set();
  for (const t of sourceTexts) for (const s of shingles(tok(t))) src.add(s);
  if (a.length < K) return { overlap: 0, longest: 0 };
  let hit = 0, run = 0, best = 0, total = a.length - K + 1;
  for (let i = 0; i < total; i++) {
    if (src.has(a.slice(i, i + K).join(' '))) { hit++; run++; best = Math.max(best, run); } else run = 0;
  }
  return { overlap: hit / total, longest: best ? best + K - 1 : 0 };
}

export function parseDraft(text) {
  const g = (k) => ((text.match(new RegExp('^\\s*' + k + ':\\s*(.*)$', 'mi')) || [])[1] || '').replace(/[*#]/g, '').trim();
  const bi = text.search(/^\s*BODY:\s*/mi);
  let body = bi >= 0 ? text.slice(bi).replace(/^\s*BODY:\s*/i, '') : '';
  body = body.replace(/\*\*/g, '').replace(/^[ \t]*#{1,6}[ \t]*/gm, '## ').replace(/^[ \t]*[-*•][ \t]+/gm, '')
    .replace(/[“”„«»"]/g, '').replace(/[ \t]*\n*(## [^\n]+)\n*/g, '\n\n$1\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: g('TITLE').replace(/["“”]/g, ''), summary: g('SUMMARY').replace(/["“”]/g, ''), category: g('CATEGORY'), tags: g('TAGS'), body };
}

const countWords = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

// Readable slug; Hindi (Devanagari) titles are kept instead of turning into "post-xxxxx". Random suffix keeps it unique.
export function slugify(text) {
  const base = String(text || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 70) || 'post';
  return base + '-' + Math.random().toString(36).slice(2, 7);
}

// Numbers in the draft that do not appear anywhere in the sources (Devanagari digits and 1,00,000 style handled)
const DEV = '०१२३४५६७८९';
const normNum = (s) => String(s || '').replace(/[०-९]/g, (d) => String(DEV.indexOf(d))).replace(/(\d),(?=\d{2,3}\b)/g, '$1');
const numsOf = (s) => normNum(s).match(/\d+(?:\.\d+)?/g) || [];
export function ungroundedNumbers(text, sourceTexts, ignore = []) {
  const have = new Set(numsOf(sourceTexts.join(' ')));
  const bad = new Set();
  for (const n of numsOf(text)) {
    if (n.length < 2 && !n.includes('.')) continue; // single digits are too common to judge
    if (have.has(n) || ignore.includes(n)) continue;
    bad.add(n);
  }
  return [...bad];
}

// Real quality score (0-100). 95+ is only possible for a clean, sourced, well-structured draft.
export function scoreDraft(m) {
  let s = 100;
  const notes = [];
  const pct = (m.overlap || 0) * 100;
  if (pct > 5) { s -= Math.min(40, Math.round((pct - 5) * 1.5)); notes.push(`Copy overlap ${Math.round(pct)}%`); }
  if ((m.longest || 0) >= 20) { s -= m.longest >= 30 ? 20 : 10; notes.push(`${m.longest} shabd ki line sources se milti hai`); }
  const ug = m.ungrounded || [];
  if (ug.length) { s -= Math.min(18, ug.length * 3); notes.push(`Sources me nahi mile numbers: ${ug.slice(0, 5).join(', ')}`); }
  if (m.words < 300) { s -= 20; notes.push(`Sirf ${m.words} shabd`); }
  else if (m.words < 400) { s -= 8; notes.push(`${m.words} shabd (400+ behtar)`); }
  else if (m.words > 1400) { s -= 5; notes.push('Bahut lamba'); }
  if (!m.hasSummary) { s -= 5; notes.push('Summary nahi'); }
  if ((m.headings || 0) < 2) { s -= 5; notes.push('Sub-headings kam'); }
  if (!m.categoryOk) { s -= 3; notes.push('Category galat thi'); }
  // Only penalise when the editor pass actually ran and told us something (undefined = old call/tests).
  if (m.hasAnalysis === false) { s -= 6; notes.push('Vishleshan/analysis section nahi hai'); }
  if (m.coverageLow === true) { s -= 6; notes.push('Fact-check ne kam claims diye'); }
  if (m.verified === false) { s -= 12; notes.push('AI fact-check pass nahi hua'); }
  if (m.stylePenalty) { s -= Math.min(15, Number(m.stylePenalty) || 0); notes.push(`Style guard: ${m.stylePenalty} points kate (machine jaisi bhasha/rhythm)`); }
  return { score: Math.max(0, Math.min(100, Math.round(s))), notes };
}

async function reject(env, topic, research, reason) {
  research.reject_reason = reason;
  await env.DB.prepare("UPDATE topics SET status='rejected',research=?,updated_at=? WHERE id=?").bind(JSON.stringify(research), now(), topic.id).run();
  return { ok: false, reason, spent: true };
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function buildMessages(env, topic, sources, feedback, brief, ledgerBlock = '') {
  const lang = langOf(env);
  const langName = lang === 'en' ? 'English' : 'Hindi (Devanagari script)';
  const analysisHeading = lang === 'en' ? '## Analysis' : '## विश्लेषण';
  const today = new Date(Date.now() + IST * 1000).toISOString().slice(0, 10);
  const system =
    'You are a careful news editor for an Indian news website. You write ONLY from the READING BRIEF and SOURCES you are given. ' +
    'Never invent facts, names, numbers, dates, quotes or claims that are not in them. ' +
    'Never copy sentences: rewrite everything in your own words and your own sentence structure. ' +
    'If a detail is listed as missing, leave it out instead of guessing.';

  const srcBlock = sources
    .slice(0, 6)
    .map((s, i) => `[${i + 1}] ${s.title || hostOf(s.url) || 'source'}${hostOf(s.url) ? ' (' + hostOf(s.url) + ')' : ''}\n${String(s.text || '').slice(0, 1800)}`)
    .join('\n\n');

  const briefBlock = brief && brief.briefText
    ? `READING BRIEF (already checked by code BEFORE writing - trust this):\n${brief.briefText}\n\n`
    : '';
  const ledgerOut = ledgerBlock
    ? `CROSS-CHECKED CLAIM LEDGER (3 AI roles + code verification). Use VERIFIED claims as your main facts:\n${ledgerBlock}\n\n`
    : '';

  const user =
    `Date: ${today}\nTopic: ${topic.query}\n\n${briefBlock}${ledgerOut}SOURCES:\n${srcBlock}\n\n` +
    `FIRST read the READING BRIEF, the CLAIM LEDGER and the SOURCES above carefully. Only after that, write a news article in ${langName} about this topic using only those facts.\n` +
    'Rules:\n' +
    '- 500 to 750 words, 3 to 5 sub-headings written as lines starting with ##\n' +
    `- One sub-heading must be exactly "${analysisHeading}". Its 2 to 3 paragraphs must explain what this news means, why it matters and what to watch next, using only facts from the sources\n` +
    '- Use ONLY the numbers listed under "NUMBERS ALLOWED". Never write another number, date, name or place\n' +
    '- Use VERIFIED claims normally. A SINGLE-SOURCE claim may only be written as "ek report ke mutabik" / "according to one report". Claims under NOT ALLOWED must never appear\n' +
    '- If something is listed under "MISSING / DO NOT INVENT", leave it out completely\n' +
    '- No bullet points, no quotation marks, no markdown bold\n' +
    '- Do not repeat 6 or more words in a row from any source\n' +
    '- If the sources do not give a detail, leave it out (do not guess)\n' +
    `- CATEGORY must be exactly one of: ${CATS.join(', ')}\n\n` +
    'Return EXACTLY this format and nothing else:\n' +
    'TITLE: (30 to 90 characters)\nSUMMARY: (110 to 150 characters)\nCATEGORY: \nTAGS: (5 comma separated tags)\nBODY:\n(article)' +
    (feedback ? `\n\nIMPORTANT: ${feedback}` : '');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export async function writeOne(env, opts = {}) {
  // ---- 1. daily limit: IST calendar day (resets 12:00 AM IST) ----
  const limit = Number(env.DAILY_POST_LIMIT || 4);
  const made = (await env.DB.prepare('SELECT COUNT(*) c FROM posts WHERE created_at>=?').bind(dayStartIST()).first()).c;
  if (made >= limit) return { ok: false, reason: `Aaj ki limit (${limit}) poori`, spent: false };

  // ---- 2. pick a ready topic that passes preflight and has real source text ----
  const cands = opts.topicId
    ? (await env.DB.prepare('SELECT * FROM topics WHERE id=?').bind(opts.topicId).all()).results
    : (await env.DB.prepare("SELECT * FROM topics WHERE status='ready' ORDER BY id LIMIT 8").all()).results;

  let topic = null, research = {}, sources = [], brief = null, why = '', refreshes = 0;
  for (const c of cands) {
    let r = {};
    try { r = JSON.parse(c.research || '{}'); } catch { r = {}; }
    const pf = preflight(c, r);
    if (!pf.ok) { why = pf.reason || why; continue; }
    let srcs = (r.sources || [])
      .map((s) => ({ ...s, text: String(s.text || s.content || s.snippet || s.summary || s.description || '').replace(/\s+/g, ' ').trim() }))
      .filter((s) => s.text);
    if (srcs.map((s) => s.text).join('').length < 400) { why = `${c.query}: sources me text bahut kam hai`; continue; } // not enough material: leave topic untouched

    // Step 2b: ZERO-token pre-read. If research already built a brief (new topics), trust it; old topics are
    // read here again. A weak, foreign or unrelated source set stops the topic BEFORE any AI token is spent.
    let b = (r.brief && r.brief.version === 1)
      ? r.brief
      : buildBrief(c.query, srcs, {
        lang: langOf(env), nowSec: now(),
        minSources: pf.minSources, maxAgeDays: pf.maxAgeDays, needDates: pf.needDates, label: pf.label
      });
    // A 'ready' topic researched days ago is NOT writable any more: its newest source may be stale.
    // Instead of throwing "source 10 din purani" at the admin, fetch fresh sources once here, before
    // spending any AI token. At most two refreshes per write click so one click never runs forever.
    const newestSec = Math.max(0, ...srcs.map((s) => Number(s.date) || 0));
    const ageHours = newestSec ? (now() - newestSec) / 3600 : Number((b.stats && b.stats.newestAgeHours) || 0);
    const stale = !b.ok || ageHours > Number(pf.maxAgeDays || 7) * 24;
    if (stale && !opts.noRefresh && refreshes < 2) {
      refreshes++;
      const rr = await researchTopic(env, c).catch((e) => ({ status: 'error', reason: String((e && e.message) || e) }));
      if (!rr || !rr.brief) { why = `${c.query}: ${(rr && rr.reason) || 'refresh fail'}`; continue; }
      b = rr.brief;
      srcs = (b.sources || [])
        .map((s) => ({ ...s, text: String(s.text || s.snippet || '').replace(/\s+/g, ' ').trim() }))
        .filter((s) => s.text);
      r = { ...r, brief: b, sources: b.sources || [], researched_at: now() };
    }
    if (!b.ok) { why = b.reason || `${c.query}: pre-read fail hua`; continue; }

    const goodSources = (Array.isArray(b.sources) && b.sources.length ? b.sources : srcs)
      .map((s) => ({ ...s, text: String(s.text || s.snippet || '').replace(/\s+/g, ' ').trim() }))
      .filter((s) => s.text);
    if (!goodSources.length) { why = `${c.query}: pre-read ke baad koi source nahi bacha`; continue; }

    topic = c; research = r; sources = goodSources; brief = b;
    break;
  }
  if (!topic) return { ok: false, reason: why || 'Koi kaam ka topic nahi mila', spent: false };

  // ---- 2c. duplicate check (ZERO token) ----
  // Same story / same headline pehle se site par hai? Topic ko 'duplicate' mark karo aur AI token
  // kharch mat karo. Purane posts ke fingerprints pehli baar posts table se bhi ban jate hain.
  let duplicateInfo = { checked: false, duplicate: false };
  const dupOff = ['false', '0', 'off', 'no'].includes(String(env.DUPLICATE_CHECK ?? 'true').trim().toLowerCase());
  if (!dupOff) {
    const existing = await loadExistingFingerprints(env, Number(env.DUP_CHECK_LIMIT || 400));
    const candFp = fingerprint(topic.query, (brief.facts || []).map((f) => f.text).join(' '));
    const dup = findDuplicate(candFp, existing, { block: Number(env.DUP_MAX_SIMILARITY || 0.82) });
    duplicateInfo = { checked: true, score: dup.score, exact: !!dup.exact, duplicate: !!dup.duplicate };
    if (dup.duplicate && !opts.ignoreDuplicate) {
      research.duplicate = {
        score: dup.score,
        exact: !!dup.exact,
        against: dup.against ? { id: dup.against.postId, title: dup.against.title } : null,
        at: now()
      };
      try {
        await env.DB.prepare("UPDATE topics SET status='duplicate',research=?,updated_at=? WHERE id=?").bind(JSON.stringify(research), now(), topic.id).run();
      } catch { /* topic status is best-effort; the write still stops */ }
      return {
        ok: false,
        spent: false,
        duplicate: research.duplicate,
        reason: `Duplicate: ${dup.reason || 'pehle se milta-julta post hai'}${dup.against && dup.against.title ? ' - ' + String(dup.against.title).slice(0, 90) : ''}`
      };
    }
  }

  // ---- 2d. multi-AI debate + cross-check (before the writer, so the writer starts from checked facts) ----
  // A debate preview run from the topic page is reused for 2 hours (no double token spend). Any source
  // refresh makes the old debate stale, so it runs again.
  const debateOff = ['false', '0', 'off', 'no'].includes(String(env.DEBATE_ENABLED ?? 'true').trim().toLowerCase());
  let debate = null, debateMetaObj = null, ledgerBlock = '';
  if (!debateOff) {
    const prev = research.debate;
    const prevAt = Number(prev && prev.at) || 0;
    const prevFresh = !!(prev && prev.ok && prev.ledger && prevAt && now() - prevAt < Number(env.DEBATE_REUSE_SECONDS || 7200) && prevAt >= Number(research.researched_at || 0));
    if (prevFresh && opts.reuseDebate !== false) {
      debate = prev;
      debateMetaObj = prev;
      ledgerBlock = ledgerTextFromMeta(prev.ledger);
    } else {
      debate = await runDebate(env, { topic, sources, brief, lang: langOf(env) });
      debateMetaObj = debate && debate.ledger ? debateMeta(debate) : null;
      if (debateMetaObj) {
        research.debate = debateMetaObj;
        try {
          await env.DB.prepare('UPDATE topics SET research=?,updated_at=? WHERE id=?').bind(JSON.stringify(research), now(), topic.id).run();
        } catch { /* preview save is best-effort */ }
      }
      ledgerBlock = debate && debate.ledger ? debateBrief(debate.ledger) : '';
    }
  }

  const sourceTexts = sources.map((s) => s.text);
  const MAX_OVERLAP = Number(env.COPY_MAX_OVERLAP || 0.3);
  const MAX_RUN = Number(env.COPY_MAX_RUN || 35);
  const RETRY_OVERLAP = Number(env.COPY_RETRY_OVERLAP || 0.15);
  const RETRY_RUN = Number(env.COPY_RETRY_RUN || 20);
  const thisYear = String(new Date().getFullYear());

  // ---- 3. AI draft (at most one rewrite retry) ----
  const attempt = async (feedback) => {
    const ai = await runAI(env, buildMessages(env, topic, sources, feedback, brief, ledgerBlock), { max_tokens: 6000, temperature: 0.6 });
    if (!ai.text) return { ai, draft: null };
    const draft = parseDraft(ai.text);
    const cc = copyCheck(draft.body, sourceTexts);
    const words = countWords(draft.body);
    const ungrounded = ungroundedNumbers(`${draft.title} ${draft.summary} ${draft.body}`, sourceTexts, [thisYear]);
    return { ai, draft, m: { ...cc, words, ungrounded } };
  };
  const usable = (a) => a.draft && a.draft.title && a.m.words >= 150;

  let best = await attempt('');
  if (!best.ai.text) {
    return { ok: false, reason: `AI draft nahi bana: ${(best.ai.errors || []).join(' | ').slice(0, 300) || 'koi jawab nahi'}`, spent: true };
  }
  const needsRetry = (a) => !usable(a) || a.m.overlap > RETRY_OVERLAP || a.m.longest >= RETRY_RUN;
  if (needsRetry(best)) {
    const why = !usable(best)
      ? 'Pichhla jawab adhura tha. Poora format follow karo: TITLE, SUMMARY, CATEGORY, TAGS, BODY (450+ shabd).'
      : `Pichhla draft sources se ${Math.round(best.m.overlap * 100)}% milta tha (sabse lambi copied line ${best.m.longest} shabd). Poora naye shabdon aur alag vakya-rachna me dobara likho, sirf tathya wahi rakho.`;
    const second = await attempt(why);
    if (second.ai.text && usable(second) && (!usable(best) || second.m.overlap < best.m.overlap)) best = second;
  }
  if (!usable(best)) {
    return { ok: false, reason: 'AI ka draft adhura aaya (title ya 150+ shabd nahi). Dobara try karo.', spent: true };
  }
  if (best.m.overlap > MAX_OVERLAP || best.m.longest >= MAX_RUN) {
    return reject(env, topic, research, `Copy overlap ${Math.round(best.m.overlap * 100)}% zyada; ${best.m.longest} shabd ki line sources se mil rahi`);
  }

  const { ai, draft, m } = best;

  // ---- 4. clean up fields ----
  const category = CATS.find((c) => c.toLowerCase() === draft.category.toLowerCase());
  draft.category = category || 'India';
  draft.tags = draft.tags.split(/[,،]/).map((t) => t.trim()).filter(Boolean).slice(0, 8).join(', ') || String(topic.query || '');
  if (!draft.summary) draft.summary = draft.body.replace(/##[^\n]*/g, '').trim().split(/(?<=[.!?।])\s/)[0].slice(0, 155);

  // ---- 4b. AI editor + fact-check (quality gate before saving) ----
  // The editor adds an original Vishleshan/Analysis section and lists every factual claim with its source line.
  // Plain code decides whether the evidence really exists. If it fails, the draft is saved for a human, never
  // silently published. Set ENABLE_AI_EDITOR=false only if you are debugging without AI.
  const srcDates = sources.map((s) => Number(s.date) || 0).filter(Boolean);
  const newestSource = srcDates.length ? Math.max(...srcDates) : 0;
  const editorOff = ['false', '0', 'off', 'no'].includes(String(env.ENABLE_AI_EDITOR ?? '').trim().toLowerCase());
  let fc;
  if (editorOff) {
    fc = {
      verified: false, coverageLow: true, unsupportedCount: 1, claims: 0, supported: 0, fixRounds: 0,
      overlap: m.overlap, newest_source: newestSource, claimList: [], numbersNotInSources: [],
      latinNotInSources: [], hasAnalysis: hasAnalysisSection(draft.body), error: 'ENABLE_AI_EDITOR=false'
    };
  } else {
    fc = await factCheck(env, draft, sources, {
      lang: langOf(env),
      maxRounds: Number(env.EDITOR_MAX_ROUNDS ?? 2),
      newestSource,
      overlap: m.overlap
    });
  }
  if (fc && fc.body) draft.body = fc.body;

  const finalCc = copyCheck(draft.body, sourceTexts);
  if (finalCc.overlap > MAX_OVERLAP || finalCc.longest >= MAX_RUN) {
    return reject(env, topic, research, `Editor ke baad copy overlap ${Math.round(finalCc.overlap * 100)}% zyada; ${finalCc.longest} shabd ki line sources se mil rahi`);
  }
  const words = countWords(draft.body);
  const finalUngrounded = ungroundedNumbers(`${draft.title} ${draft.summary} ${draft.body}`, sourceTexts, [thisYear]);
  const headings = (draft.body.match(/^## /gm) || []).length;
  const hasAnalysis = hasAnalysisSection(draft.body);
  // ZERO-token style guard: stock AI phrases, flat sentence rhythm, repeated openings/phrases.
  const style = styleCheck(draft.body, { lang: langOf(env), minScore: Number(env.STYLE_MIN_SCORE || 0) });

  const scored = scoreDraft({
    ...m,
    overlap: finalCc.overlap,
    longest: finalCc.longest,
    ungrounded: finalUngrounded,
    words,
    hasSummary: !!draft.summary,
    headings,
    categoryOk: !!category,
    hasAnalysis,
    verified: fc.verified,
    coverageLow: fc.coverageLow,
    stylePenalty: style.penalty
  });
  const notes = scored.notes;
  // Auto-publish is still capped at 94 by default, even when the fact-check passes. A human should approve the
  // first months of content; raise SCORE_MAX only after you trust the pipeline and have real traffic.
  const score = Math.min(scored.score, Number(env.SCORE_MAX || 94));
  const fcMeta = { ...(fc || {}) };
  delete fcMeta.body;
  const prereadMeta = brief ? {
    ok: !!brief.ok,
    quality: brief.quality || 0,
    lang: brief.lang || langOf(env),
    mixed: !!brief.mixed,
    usable: (brief.stats && brief.stats.usable) || 0,
    fullText: (brief.stats && brief.stats.fullText) || 0,
    facts: (brief.stats && brief.stats.facts) || 0,
    agreed: (brief.stats && brief.stats.agreed) || 0,
    newestAgeHours: brief.stats ? brief.stats.newestAgeHours : null,
    dropped: (brief.dropped || []).length,
    reason: brief.reason || ''
  } : null;

  // ---- 5. image + thumbnail (parallel, a failure never blocks the draft) ----
  const slug = slugify(draft.title);
  const imageGen = new ImageGenerator(env);
  const thumbGen = new ViralThumbnailGenerator(env);
  let img = null, thumb = null;
  await Promise.allSettled([
    env.ENABLE_FEATURED_IMAGES !== 'false'
      ? imageGen.generateFeaturedImage(draft.title, draft.category, topic.id).then((r) => { img = r; })
      : Promise.resolve(),
    env.ENABLE_VIRAL_THUMBNAILS !== 'false'
      ? thumbGen.generateViralThumbnail(draft.title, draft.category).then((r) => { thumb = r; })
      : Promise.resolve()
  ]);
  let featured = img && img.success ? img.featuredImage : '';
  const thumbnail = thumb && thumb.success ? thumb.imageUrl : '';
  // Last resort: a branded news-card image (0 token, no API key) so a draft NEVER reaches review with
  // no image at all. The AI/stock image is still preferred when available.
  if (!featured) {
    const branded = await brandedImage(env, draft.title, draft.category);
    if (branded) { featured = branded.url; img = { ...(img || {}), credit: branded.credit }; }
  }

  // ---- 6. SEO ----
  const ts = now();
  const seo = new SEOOptimizer(env);
  const seoMeta = seo.generateSEOMetadata({ ...draft, slug, created_at: ts, updated_at: ts, featured_image: featured, thumbnail_image: thumbnail });
  const analysis = seo.analyzeContent({ ...draft, featured_image: featured });

  const debatePostMeta = debateMetaObj
    ? {
      ...debateMetaObj,
      roles: (debateMetaObj.roles || []).map((r) => ({ id: r.id, name: r.name, ok: r.ok, provider: r.provider, model: r.model, claims: r.claims })),
      errors: (debateMetaObj.errors || []).slice(0, 2)
    }
    : null;

  // ---- 7. save draft + mark topic, in ONE atomic batch ----
  const row = {
    slug,
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    category: draft.category,
    tags: draft.tags,
    lang: langOf(env),
    image_url: featured,
    image_credit: (img && img.credit) || '',
    sources: JSON.stringify(sources.map(({ text, content, snippet, summary, description, ...rest }) => rest)),
    score,
    word_count: words,
    check_json: JSON.stringify({ ...fcMeta, overlap: finalCc.overlap, newest_source: newestSource, lang: langOf(env), preread: prereadMeta, style: styleMeta(style), duplicate: duplicateInfo, debate: debatePostMeta }),
    created_at: ts,
    updated_at: ts,
    featured_image: featured,
    thumbnail_image: thumbnail,
    og_image: featured,
    seo_score: analysis.score,
    meta_description: seoMeta.metaDescription,
    meta_keywords: seoMeta.keywords,
    schema_json: seoMeta.schema
  };
  const cols = Object.keys(row);
  let postId = null;
  try {
    const insert = env.DB.prepare(`INSERT INTO posts (${cols.join(',')},status) VALUES (${cols.map(() => '?').join(',')},'draft')`).bind(...cols.map((c) => row[c]));
    const topicResearch = { ...research, duplicate: duplicateInfo, debate: debateMetaObj || research.debate, written_at: ts };
    const mark = env.DB.prepare("UPDATE topics SET status='drafted',research=?,updated_at=? WHERE id=?").bind(JSON.stringify(topicResearch), ts, topic.id);
    const res = await env.DB.batch([insert, mark]);
    postId = (res && res[0] && res[0].meta && res[0].meta.last_row_id) || null;
  } catch (e) {
    console.error('writeOne DB save failed:', e && e.message);
    return { ok: false, reason: `Draft database me save nahi hua: ${String(e && e.message).slice(0, 200)}`, spent: true };
  }
  if (postId) await saveFingerprint(env, postId, `${draft.title} ${draft.summary || ''}`, draft.body);

  console.log(JSON.stringify({ writeOne: 'ok', postId, provider: ai.provider, model: ai.model, score, words, overlap: Math.round(finalCc.overlap * 100), verified: !!fc.verified, claims: fc.claims || 0 }));

  return {
    ok: true,
    postId,
    title: draft.title,
    score,
    seoScore: analysis.score,
    words,
    wordCount: words,
    copyOverlap: Math.round(finalCc.overlap * 100),
    longestRun: finalCc.longest,
    provider: ai.provider,
    model: ai.model,
    verified: !!fc.verified,
    claims: fc.claims || 0,
    supported: fc.supported || 0,
    hasImages: { featured: !!featured, thumbnail: !!thumbnail },
    imageProvider: (img && img.provider) || null,
    styleScore: style.score,
    stylePenalty: style.penalty,
    duplicateChecked: duplicateInfo.checked,
    debateVerified: (debateMetaObj && debateMetaObj.stats && debateMetaObj.stats.verified) || 0,
    warnings: notes
  };
}
