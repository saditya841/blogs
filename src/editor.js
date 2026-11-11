// AI editor + fact-check pass.
//
// Why this file exists:
//   A first AI draft can be accurate, but it can also invent a number, a name or a claim that is not in the
//   collected sources. AdSense also wants visible original value, not a rewritten press release.
//
// What this pass does:
//   1. One AI call rewrites the draft and adds an original "Vishleshan / Analysis" section.
//   2. The same call must list every factual claim with the exact source line that proves it.
//   3. Plain JavaScript decides whether that evidence really exists in the sources (groundedCheck).
//   4. Numbers/names that are not in the sources are caught by code too.
//   5. If anything fails, the AI gets one more chance with a precise list of problems.
//   6. The final result is saved as check_json, so the admin review page and auto-publish gate can use it.
//
// The AI never decides "verified". Only code does that.

import { runAI } from './ai.js';
import { groundedCheck, numbersNotIn, latinNotIn } from './verify.js';
import { derivedNumbers } from './business.js';

const countWords = (s) => String(s || '').split(/\s+/).filter(Boolean).length;

// Hindi heading is Devanagari on purpose: Latin heading words would otherwise look like invented names.
// Business mode uses its own section names; all of them count as "original value" sections.
const ANALYSIS_RE = /^##\s*(?:विश्लेषण|analysis|vishleshan|virall take|iska matlab|isaka matlab|why it matters|bottom line|निचोड़|framework|what is not confirmed|what could go wrong|operator playbook|the money engine)\s*$/im;

export const hasAnalysisSection = (body) => ANALYSIS_RE.test(String(body || ''));

// Remove only the analysis heading before name/number checks. The analysis prose itself is still checked.
export const stripAnalysisHeading = (body) => String(body || '').replace(ANALYSIS_RE, '');

// The editor may put CLAIMS before or after BODY. Both are handled.
export function parseEditor(text) {
  const raw = String(text || '').replace(/\r/g, '');
  const claimText = raw
    .split('\n')
    .filter((l) => /^\s*CLAIM\s*:/i.test(l))
    .join('\n');
  const bi = raw.search(/^\s*BODY:\s*/mi);
  let body = bi >= 0 ? raw.slice(bi).replace(/^\s*BODY:\s*/i, '') : raw;
  body = body
    .replace(/^\s*```[a-z]*\s*$/gim, '')
    .replace(/`/g, '')
    .replace(/^\s*CLAIMS?\s*:\s*$/gim, '')
    .replace(/^\s*(TITLE|SUMMARY|CATEGORY|TAGS|CLAIM|EVIDENCE)\s*:.*$/gim, '')
    .replace(/\*\*/g, '')
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, '## ')
    .replace(/^[ \t]*[-*•][ \t]+/gm, '')
    .replace(/[“”„«»"]/g, '')
    .replace(/[ \t]*\n*(## [^\n]+)\n*/g, '\n\n$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { body, claimText };
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function editorMessages(env, article, sources, feedback = '', opts = {}) {
  if (opts.business) return businessEditorMessages(env, article, sources, feedback, opts);
  const lang = /^en/i.test(String((env && env.POST_LANG) || '')) ? 'en' : 'hi';
  const langName = lang === 'en' ? 'English' : 'Hindi (Devanagari script)';
  const analysisHeading = lang === 'en' ? '## Analysis' : '## विश्लेषण';
  const srcBlock = sources
    .slice(0, 6)
    .map((s, i) => `[${i + 1}] ${s.title || hostOf(s.url) || 'source'}${hostOf(s.url) ? ' (' + hostOf(s.url) + ')' : ''}${s.date ? ' - ' + new Date(s.date * 1000).toISOString().slice(0, 10) : ''}\n${String(s.text || '').slice(0, 1900)}`)
    .join('\n\n');

  const system =
    'You are a strict news editor and fact-checker for an Indian news website. ' +
    'You may only use facts that appear in the SOURCES. Never add a name, number, date, quote, place, result or claim ' +
    'that is not in the sources. Never copy 6 or more words in a row from a source. ' +
    'Your analysis may explain and connect facts, but it must not present opinions or predictions as facts.';

  const user =
    `TITLE: ${article.title || ''}\nSUMMARY: ${article.summary || ''}\n\nDRAFT BODY:\n${article.body || ''}\n\n` +
    `SOURCES:\n${srcBlock}\n\n` +
    'Task 1 - EDIT the draft:\n' +
    `- Keep it ${langName}, 500 to 750 words, 3 to 5 sub-headings written as lines starting with ##\n` +
    `- One sub-heading must be exactly "${analysisHeading}". Its 2 to 3 short paragraphs must explain: what this news means, why it matters, and what to watch next. Use only facts from the sources; do not add new facts.\n` +
    '- Remove anything the sources do not support. Do not guess or fill gaps.\n' +
    '- No bullet points, no markdown bold, no quotation marks.\n\n' +
    'Task 2 - LIST THE FACTS:\n' +
    '- Write one line for every factual claim in the final article:\n' +
    '  CLAIM: <short claim from the article> || EVIDENCE: <exact words copied from a source that prove it>\n' +
    '- List 6 to 10 claims. If a sentence has no exact evidence, remove that sentence from the article instead of listing it.\n' +
    '- The EVIDENCE must be an exact phrase from the SOURCES (not your paraphrase).\n\n' +
    'Return EXACTLY this format:\n' +
    'CLAIMS:\n' +
    'CLAIM: ... || EVIDENCE: ...\n' +
    'CLAIM: ... || EVIDENCE: ...\n' +
    'BODY:\n' +
    '(the final edited article)' +
    (feedback ? `\n\nFIX THESE PROBLEMS FROM THE LAST ATTEMPT:\n${feedback}` : '');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// Business editor: same code-verified claim discipline, but allows a longer, framework-driven
// structure and treats arithmetic as a calculation (not a factual claim) when inputs are sourced.
export function businessEditorMessages(env, article, sources, feedback = '', opts = {}) {
  const lang = opts.lang === 'hi' ? 'hi' : 'en';
  const langName = lang === 'en' ? 'English' : 'Hindi (Devanagari script)';
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const srcBlock = sources
    .slice(0, 6)
    .map((s, i) => `[${i + 1}] ${s.title || hostOf(s.url) || 'source'}${hostOf(s.url) ? ' (' + hostOf(s.url) + ')' : ''}${s.date ? ' - ' + new Date(s.date * 1000).toISOString().slice(0, 10) : ''}\n${String(s.text || '').slice(0, 2000)}`)
    .join('\n\n');

  const system =
    'You are a strict business editor and fact-checker for an Indian business publication. ' +
    'You may only use facts that appear in the SOURCES. Never add a name, number, date, quote, place, result or claim ' +
    'that is not in the sources. Never copy 6 or more words in a row from a source. ' +
    'A calculation is allowed only when it is written as `A / B = C` or `A - B = C`, A and B appear in the sources, ' +
    'and the arithmetic is correct. Label every estimate with the word estimate and show its sourced inputs. ' +
    'Never write guarantees, get-rich promises, stock tips, buy/sell advice or target prices. ' +
    'Your analysis may connect facts and apply a framework, but it must not present opinions or predictions as facts.';

  const user =
    `TITLE: ${article.title || ''}\nSUMMARY: ${article.summary || ''}\n\nDRAFT BODY:\n${article.body || ''}\n\n` +
    `SOURCES:\n${srcBlock}\n\n` +
    'Task 1 - EDIT the draft:\n' +
    `- Keep it ${langName}, 900 to 1300 words, 6 to 8 sub-headings written as lines starting with ##\n` +
    '- The article must keep these sections: a specific setup, the money engine, a named framework applied to the case, ' +
    'the strongest counterpoint, an operator playbook, what could go wrong, what is not confirmed, and a final ## Analysis section.\n' +
    '- Remove anything the sources do not support. Do not guess or fill gaps. If a detail is missing, say it is not confirmed.\n' +
    '- Keep every sourced number. If a number is an estimate, write "estimate" next to it and show the sourced inputs.\n' +
    '- No markdown bold, no bullet lists in the body, no quotation marks. Headings only as lines starting with ##.\n' +
    '- No generic opening and no motivational language.\n\n' +
    'Task 2 - LIST THE FACTS:\n' +
    '- Write one line for every factual claim in the final article:\n' +
    '  CLAIM: <short claim from the article> || EVIDENCE: <exact words copied from a source that prove it>\n' +
    '- List 8 to 12 claims. If a sentence has no exact evidence, remove that sentence from the article instead of listing it.\n' +
    '- Do NOT list a calculation as a claim. List the sourced inputs used in the calculation instead.\n' +
    '- The EVIDENCE must be an exact phrase from the SOURCES (not your paraphrase).\n\n' +
    'Return EXACTLY this format:\n' +
    'CLAIMS:\n' +
    'CLAIM: ... || EVIDENCE: ...\n' +
    'BODY:\n' +
    '(the final edited article)' +
    (feedback ? `\n\nFIX THESE PROBLEMS FROM THE LAST ATTEMPT:\n${feedback}` : '');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function sentenceCount(text) {
  return String(text || '').split(/[।.!?\n]+/).filter((s) => s.trim().length >= 8).length;
}

function expectedClaimCount(article) {
  const n = sentenceCount(`${article.title || ''}\n${article.summary || ''}\n${article.body || ''}`);
  return Math.max(3, Math.min(8, Math.floor(n / 6)));
}

const toAdminClaim = (c) => ({ c: String(c.claim || '').slice(0, 200), e: String(c.evidence || '').slice(0, 300), ok: c.ok, why: c.why });

// Pure part: takes the editor AI's raw text and decides (with code) whether the result is trustworthy.
// Exported so tests can check it without network or a real AI call.
export function evaluateEditorOutput(text, article, sources, opts = {}) {
  const sourceTexts = (sources || []).map((s) => String(s.text || '')).filter(Boolean);
  const notes = sourceTexts.join('\n\n');
  const lang = opts.lang || 'hi';
  const parsed = parseEditor(text);
  const body = parsed.body && countWords(parsed.body) >= 150 ? parsed.body : String(article.body || '');
  const current = { title: article.title || '', summary: article.summary || '', body };

  const claims = groundedCheck(parsed.claimText, notes);
  const checkText = stripAnalysisHeading(`${current.title}\n${current.summary}\n${current.body}`);
  const allow = opts.business ? derivedNumbers(current.body, notes) : [];
  const nums = numbersNotIn(checkText, notes, allow);
  const names = latinNotIn(checkText, notes, lang);
  const expected = opts.business
    ? Math.max(6, Math.min(12, Math.floor(sentenceCount(`${current.title}\n${current.summary}\n${current.body}`) / 5)))
    : expectedClaimCount(current);
  const unsupported = claims.filter((c) => !c.ok);
  const coverageLow = claims.length < expected;
  const hasAnalysis = hasAnalysisSection(current.body);
  // A missing analysis section means the post has no original value - so it cannot be "verified" either.
  const verified =
    claims.length > 0 && unsupported.length === 0 && nums.length === 0 && names.length === 0 && !coverageLow && hasAnalysis;

  return {
    verified,
    coverageLow,
    unsupportedCount: unsupported.length,
    claims: claims.length,
    supported: claims.length - unsupported.length,
    expected,
    fixRounds: Number(opts.round) || 0,
    overlap: Number(opts.overlap) || 0,
    newest_source: Number(opts.newestSource) || 0,
    claimList: claims.map(toAdminClaim),
    numbersNotInSources: nums,
    latinNotInSources: names,
    hasAnalysis,
    provider: opts.provider || null,
    model: opts.model || null,
    body: current.body
  };
}

export async function factCheck(env, article, sources, opts = {}) {
  const lang = opts.lang || (/^en/i.test(String((env && env.POST_LANG) || '')) ? 'en' : 'hi');
  const askedRounds = Number(opts.maxRounds ?? 2);
  const maxRounds = Number.isFinite(askedRounds) ? Math.max(0, askedRounds) : 2;
  const sourceDates = (sources || []).map((s) => Number(s.date) || 0).filter(Boolean);
  const newestSource = opts.newestSource || (sourceDates.length ? Math.max(...sourceDates) : 0);
  let current = { title: article.title || '', summary: article.summary || '', body: article.body || '' };
  let feedback = '';
  let last = null;

  for (let round = 0; round <= maxRounds; round++) {
    let ai;
    try {
      ai = await runAI(env, editorMessages(env, current, sources, feedback, { business: !!opts.business, lang }), { max_tokens: opts.business ? 8000 : 6000, temperature: 0.2 });
    } catch (e) {
      return {
        verified: false, coverageLow: true, unsupportedCount: 1, claims: 0, supported: 0,
        fixRounds: round, overlap: Number(opts.overlap) || 0, newest_source: newestSource,
        claimList: [], numbersNotInSources: [], latinNotInSources: [],
        error: `editor AI fail: ${String(e && e.message).slice(0, 200)}`, body: current.body
      };
    }

    if (!ai || !ai.text) {
      return {
        verified: false, coverageLow: true, unsupportedCount: 1, claims: 0, supported: 0,
        fixRounds: round, overlap: Number(opts.overlap) || 0, newest_source: newestSource,
        claimList: [], numbersNotInSources: [], latinNotInSources: [],
        error: `editor AI ne jawab nahi diya: ${((ai && ai.errors) || []).join(' | ').slice(0, 250)}`, body: current.body
      };
    }

    last = evaluateEditorOutput(ai.text, current, sources, {
      ...opts, lang, newestSource, round, provider: ai.provider, model: ai.model
    });
    current.body = last.body;

    if (last.verified || round === maxRounds) return last;

    const lines = [];
    if (last.claimList.some((c) => !c.ok)) {
      lines.push(`In claims ka sabut sources me nahi mila (hata do ya exact source line do):\n${last.claimList.filter((c) => !c.ok).map((c) => `- ${c.c} (${c.why || 'no evidence'})`).join('\n')}`);
    }
    if (last.numbersNotInSources.length) lines.push(`Ye numbers sources me nahi hain (hata do): ${last.numbersNotInSources.join(', ')}`);
    if (last.latinNotInSources.length) lines.push(`Ye names/words sources me nahi hain (hata do): ${last.latinNotInSources.join(', ')}`);
    if (last.coverageLow) lines.push(`Sirf ${last.claims} claims diye, kam se kam ${last.expected} chahiye.`);
    if (!last.hasAnalysis) lines.push(`"${lang === 'en' ? '## Analysis' : '## विश्लेषण'}" section add karo.`);
    feedback = lines.join('\n');
  }

  return last;
}
