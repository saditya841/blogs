// deepen.js — "existing draft ko detailed banao" (manual admin action, not auto-publish).
//
// Why: a first draft can be correct but thin. Readers arriving from a news headline need context,
// one worked example and one result/outcome, not another headline summary. This module:
//   1. runs a ZERO-token gap report on an existing Business draft,
//   2. fetches fresh sources (same providers as research),
//   3. asks the business writer to expand the SAME story (not invent a new one),
//   4. re-runs the AI editor/fact-check so old claims are not silently trusted,
//   5. saves the expanded body only if the depth gate and copy checks pass.
// It never touches a live/approved post. Human approval still decides publish.

import { runAI } from './ai.js';
import { factCheck } from './editor.js';
import { collectSources } from './trends.js';
import { businessGate, businessMeta, businessMessages, derivedNumbers } from './business.js';
import { copyCheck, parseDraft, ungroundedNumbers } from './writer.js';
import { saveFingerprint } from './similarity.js';
import { trustMeta, trustSummary } from './sourcetrust.js';

const now = () => Math.floor(Date.now() / 1000);
const countWords = (s) => String(s || '').split(/\s+/).filter(Boolean).length;
const headingsOf = (s) => [...String(s || '').matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());

export function gapReport(post = {}) {
  const body = String(post.body || '');
  const words = countWords(body);
  const headings = headingsOf(body);
  let cj = {};
  try { cj = JSON.parse(post.check_json || '{}'); } catch { cj = {}; }
  const b = cj.business || {};
  const gaps = [];
  const add = (code, msg) => gaps.push({ code, msg });
  if (words < 1200) add('words', `${words} shabd — detailed article ke liye 1200+ chahiye`);
  if (headings.length < 8) add('sections', `${headings.length} sections — 10 chahiye`);
  if (!b.framework) add('framework', 'Named framework nahi mila');
  if (!b.example) add('example', 'Worked example nahi mila — numbers ke saath ek case chahiye');
  if (!b.result) add('result', 'Result/outcome section nahi mila');
  if (!b.counterpoint) add('counterpoint', 'Strong counterpoint nahi mila');
  if (!b.playbook) add('playbook', 'Operator playbook nahi mila');
  if (!b.risks) add('risks', 'Risks / early warning section nahi mila');
  if (!b.honesty) add('honesty', '"What is not confirmed" / estimate label nahi mila');
  if (!b.india) add('india', 'India context nahi dikha');
  return {
    postId: post.id,
    title: String(post.title || ''),
    status: String(post.status || ''),
    words,
    headings: headings.length,
    score: Number(post.score) || 0,
    gaps,
    needed: gaps.length > 0
  };
}

export async function deepenOne(env, postId, opts = {}) {
  const post = await env.DB.prepare('SELECT * FROM posts WHERE id=?').bind(Number(postId)).first();
  if (!post) return { ok: false, spent: false, reason: 'Post nahi mila' };
  if (String(post.category) !== 'Business') return { ok: false, spent: false, reason: 'Sirf Business post deepen hoti hai' };
  if (!opts.force && String(post.status) !== 'draft') {
    return { ok: false, spent: false, reason: `Status "${post.status}" — sirf draft deepen hota hai. Live post ko pehle draft me le jao.` };
  }

  const gap = gapReport(post);
  const lang = String(post.lang).toLowerCase() === 'hi' ? 'hi' : 'en';
  const opened = await collectSources(post.title, { env, businessMode: true, lang });
  if (!opened.brief || !opened.brief.ok) {
    return { ok: false, spent: false, reason: 'Fresh sources nahi mile: ' + String((opened.brief && opened.brief.reason) || 'research fail') };
  }
  const sources = opened.sources || [];
  const sourceTexts = sources.map((s) => String(s.text || '')).filter(Boolean);
  if (sourceTexts.join('').length < 400) return { ok: false, spent: false, reason: 'Fresh sources me article text bahut kam hai' };

  const minWords = Math.max(600, Number(env.BUSINESS_MIN_WORDS || 1200));
  const prompt = (feedback = '') => businessMessages(env, {
    topic: { query: post.title },
    sources,
    brief: opened.brief,
    lang,
    research: { mode: 'business' },
    existingBody: post.body,
    feedback
  });

  const attempt = async (feedback) => {
    const ai = await runAI(env, prompt(feedback), { max_tokens: 9000, temperature: 0.5 });
    if (!ai.text) return { ai, draft: null, gate: null };
    const draft = parseDraft(ai.text);
    const gate = businessGate(draft, { minWords });
    return { ai, draft, gate };
  };

  let best = await attempt('');
  if (!best.ai.text) return { ok: false, spent: true, reason: 'AI ne jawab nahi diya: ' + String((best.ai.errors || []).join(' | ')).slice(0, 250) };
  if (!best.draft || !best.gate || !best.gate.ok) {
    const why = best.gate ? `Deep depth gate fail (${best.gate.score}/100): ${(best.gate.warnings || []).slice(0, 5).map((x) => x.msg).join('; ')}` : 'Draft parse nahi hua';
    const second = await attempt(`Pichhla detailed draft gate pass nahi hua. ${why}. Same story rakho, sirf source-backed detail, ek worked example aur ek result section add karo.`);
    if (second.draft && second.gate && second.gate.ok && (!best.gate || second.gate.score > best.gate.score)) best = second;
  }
  if (!best.draft || !best.gate || !best.gate.ok) {
    return {
      ok: false, spent: true,
      reason: 'Deepen draft quality gate pass nahi hua: ' + String((best.gate ? best.gate.warnings : []).map((x) => x.msg).slice(0, 5).join('; ') || 'unknown').slice(0, 300)
    };
  }

  const draft = best.draft;
  const preCc = copyCheck(draft.body, sourceTexts);
  if (preCc.overlap > Number(env.COPY_MAX_OVERLAP || 0.3) || preCc.longest >= Number(env.COPY_MAX_RUN || 35)) {
    return { ok: false, spent: true, reason: `Copy check fail: ${Math.round(preCc.overlap * 100)}% overlap, ${preCc.longest} shabd ki line` };
  }

  const newestSource = Math.max(0, ...sources.map((s) => Number(s.date) || 0));
  const editorOff = ['false', '0', 'off', 'no'].includes(String(env.ENABLE_AI_EDITOR ?? '').trim().toLowerCase());
  let fc = null;
  if (!editorOff) {
    fc = await factCheck(env, draft, sources, {
      lang, business: true, maxRounds: 1, newestSource, overlap: preCc.overlap
    });
  }
  if (fc && fc.body) draft.body = fc.body;

  const finalCc = copyCheck(draft.body, sourceTexts);
  if (finalCc.overlap > Number(env.COPY_MAX_OVERLAP || 0.3) || finalCc.longest >= Number(env.COPY_MAX_RUN || 35)) {
    return { ok: false, spent: true, reason: `Editor ke baad copy check fail: ${Math.round(finalCc.overlap * 100)}% overlap` };
  }

  const words = countWords(draft.body);
  const gate = businessGate({ title: draft.title, summary: draft.summary, body: draft.body }, { minWords });
  if (!gate.ok) {
    return { ok: false, spent: true, reason: `Final gate fail (${gate.score}/100): ${(gate.warnings || []).slice(0, 4).map((x) => x.msg).join('; ')}` };
  }

  const thisYear = String(new Date().getFullYear());
  const allow = derivedNumbers(draft.body, sourceTexts.join('\n'));
  const nums = ungroundedNumbers(`${draft.title} ${draft.summary} ${draft.body}`, sourceTexts, [...new Set([thisYear, ...allow])]);
  if (nums.length >= 3) {
    return { ok: false, spent: true, reason: `${nums.length} aankde sources me nahi mile (${nums.slice(0, 5).join(', ')}) — publish nahi kiya` };
  }

  let check = {};
  try { check = JSON.parse(post.check_json || '{}') || {}; } catch { check = {}; }
  const fcMeta = { ...(fc || {}) };
  delete fcMeta.body;
  const merged = {
    ...check,
    ...fcMeta,
    overlap: finalCc.overlap,
    lang,
    business: businessMeta(gate),
    sourceTrust: trustMeta(trustSummary(sources)),
    deepen: {
      at: now(),
      from_words: countWords(post.body),
      to_words: words,
      gaps: gap.gaps.map((g) => g.code),
      gate: gate.score
    }
  };

  let title = String(draft.title || post.title || '').trim() || post.title;
  if (title.toLowerCase() !== String(post.title).toLowerCase()) {
    const clash = await env.DB.prepare('SELECT id FROM posts WHERE title=? COLLATE NOCASE AND id!=?').bind(title, post.id).first();
    if (clash) title = post.title;
  }

  const score = Math.min(Number(env.SCORE_MAX || 94), gate.score);
  await env.DB.prepare(
    'UPDATE posts SET title=?,summary=?,body=?,word_count=?,score=?,check_json=?,updated_at=?,human_edited_at=NULL,human_edit_note=NULL WHERE id=?'
  ).bind(title, String(draft.summary || post.summary || ''), draft.body, words, score, JSON.stringify(merged), now(), post.id).run();
  await saveFingerprint(env, post.id, `${title} ${draft.summary || ''}`, draft.body);

  return {
    ok: true,
    postId: post.id,
    title,
    score,
    words,
    fromWords: countWords(post.body),
    gapsFixed: gap.gaps.map((g) => g.code),
    gate: businessMeta(gate),
    verified: !!(fc && fc.verified),
    provider: best.ai.provider,
    model: best.ai.model,
    spent: true
  };
}
