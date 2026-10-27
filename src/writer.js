// Step 3: ready topic -> AI draft -> grounded fact-check -> copy check -> saved as DRAFT (or rejected with reason). No API keys.
import { runAI, modelList } from './ai.js';
import { JUNK } from './trends.js';
import { addMedia } from './media.js';
import { groundedCheck as strictGroundedCheck, numbersNotIn, latinNotIn, expectedClaims } from './verify.js';
import { preflight } from './playbook.js';
import { extractFacts } from './facts.js';
import { parkTopic } from './card.js';
const now = () => Math.floor(Date.now() / 1000);
const CATS = ['India', 'Odisha', 'Business', 'Technology', 'Sports', 'Entertainment', 'Education', 'Jobs', 'Politics', 'World'];

const tok = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
const K = 6;
const shingles = (t, k = K) => { const s = new Set(); for (let i = 0; i + k <= t.length; i++) s.add(t.slice(i, i + k).join(' ')); return s; };
const devDigits = (s) => String(s || '').replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));

// copy check: share of article 6-word shingles found in sources + longest copied run (words)
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

const jaccard = (x, y) => { const A = new Set(tok(x)), B = new Set(tok(y)); let i = 0; for (const w of A) if (B.has(w)) i++; return A.size + B.size ? i / (A.size + B.size - i) : 0; };

function notes(research) {
  return (research.sources || []).map((s, i) => `[${i + 1}] ${s.source} - ${s.title}\n${s.snippet || ''}\n${(s.text || '').slice(0, 1800)}`).join('\n\n');
}
// how many characters of real material the writer actually sees (same truncation as notes())
const noteChars = (research) => (research.sources || []).reduce((a, s) => a + (s.snippet || '').length + Math.min((s.text || '').length, 1800), 0);

// enough real article text to write from? (snippets alone are not enough)
const richEnough = (rs) => {
  const s = rs.sources || [];
  const full = s.filter((x) => (x.text || '').length > 300).length;
  const chars = s.reduce((a, x) => a + (x.text || x.snippet || '').length, 0);
  return s.length >= 3 && full >= 2 && chars >= 1500;
};

function parseDraft(text) {
  const g = (k) => ((text.match(new RegExp('^\\s*' + k + ':\\s*(.*)$', 'mi')) || [])[1] || '').replace(/[*#]/g, '').trim();
  const bi = text.search(/^\s*BODY:\s*/mi);
  let body = bi >= 0 ? text.slice(bi).replace(/^\s*BODY:\s*/i, '') : '';
  body = body.replace(/\*\*/g, '').replace(/^[ \t]*#{1,6}[ \t]*/gm, '## ').replace(/^[ \t]*[-*•][ \t]+/gm, '')
    .replace(/[“”„«»"]/g, '') // no direct quotes at all: report in own words
    .replace(/[ \t]*\n*(## [^\n]+)\n*/g, '\n\n$1\n\n') // every heading alone, with a blank line before and after
    .replace(/\n{3,}/g, '\n\n').trim();
  return { title: g('TITLE').replace(/["“”]/g, ''), summary: g('SUMMARY').replace(/["“”]/g, ''), category: g('CATEGORY'), tags: g('TAGS'), body };
}

async function reject(env, topic, research, reason) {
  research.reject_reason = reason;
  await env.DB.prepare("UPDATE topics SET status='rejected',research=?,updated_at=? WHERE id=?").bind(JSON.stringify(research), now(), topic.id).run();
  return { ok: false, reason };
}
// technical failure (AI/format): keep topic 'ready' for one more try, reject after 2 failures
async function retryLater(env, topic, research, reason) {
  research.writeFails = (research.writeFails || 0) + 1;
  if (research.writeFails >= 2) return reject(env, topic, research, reason);
  research.last_error = reason;
  await env.DB.prepare('UPDATE topics SET research=?,updated_at=? WHERE id=?').bind(JSON.stringify(research), now(), topic.id).run();
  return { ok: false, reason: reason + ' (topic bacha hai, dobara try karo)' };
}
const trafficNum = (t) => Number(String(t || '').replace(/[^0-9]/g, '')) || 0;

// (vetTopic hata diya gaya: topic ki jaanch ab bina AI ke hoti hai: playbook.preflight + facts.extractFacts)

// ---- grounded fact-check: ONE strict implementation lives in verify.js (numbers must sit inside the evidence line itself) ----
export const groundedCheck = strictGroundedCheck;

export async function writeOne(env, opts = {}) {
  const limit = Number(env.DAILY_POST_LIMIT || 4);
  const made = (await env.DB.prepare('SELECT COUNT(*) c FROM posts WHERE created_at>?').bind(now() - 86400).first()).c;
  if (made >= limit) return { ok: false, reason: `Aaj ki limit (${limit}) poori` };

  // pick the best topic: skip junk / thin material (bina AI ke: playbook + facts)
  // opts.topicId = admin ne card dekhkar is topic ko chuna: sirf wahi likha jayega
  const cands = (opts.topicId
    ? (await env.DB.prepare('SELECT * FROM topics WHERE id=?').bind(opts.topicId).all()).results.filter((t) => ['ready', 'carded', 'card_live'].includes(t.status))
    : (await env.DB.prepare("SELECT * FROM topics WHERE status='ready' ORDER BY id LIMIT 8").all()).results)
    .sort((a, b) => trafficNum(b.traffic) - trafficNum(a.traffic));
  const lang0 = env.POST_LANG === 'en' ? 'en' : 'hi';
  let topic = null, research = {}, angle = '', rules = [], skipped = [];
  for (const c of cands) {
    let rs = {}; try { rs = JSON.parse(c.research || '{}'); } catch {}
    if (JUNK.test(c.query) || !richEnough(rs)) { await reject(env, c, rs, 'Kaam ka topic nahi (live/rate type ya sources mein article text kam)'); skipped.push(c.query); continue; }
    // bina AI ki jaanch: topic ka type, taazgi, sources ki ginti, aur kya 2 outlet ek hi khabar bata rahe hain
    const pf = preflight(c, rs);
    if (!pf.ok) { await parkTopic(env, c, rs, pf.reason, pf.retry); skipped.push(`${c.query} (${pf.reason.slice(0, 70)})`); continue; }
    const fx = extractFacts(rs.sources || [], { lang: lang0 });
    if (fx.agreed < 2) { await parkTopic(env, c, rs, `Sources ek khabar par sehmat nahi (2 outlet ke sanjhe facts: ${fx.agreed})`, true); skipped.push(`${c.query} (sources bikhre hue)`); continue; }
    topic = c; research = rs; rules = pf.rules || []; break;
  }
  if (!topic) return { ok: false, reason: 'Koi kaam ka topic nahi mila' + (skipped.length ? ` (hataye gaye: ${skipped.join(', ')})` : '') };
  const srcs = research.sources || [];

  const lang = env.POST_LANG === 'en' ? 'English' : 'Hindi (Devanagari script)';
  const models = modelList(env);
  const notesText = notes(research);

  // article length follows the amount of real material: never pad a thin story
  const target = Math.max(200, Math.min(600, Math.round((Math.min(noteChars(research), 9000) / 6) * 0.45)));
  const sections = target < 350 ? '2-3' : '4-5';

  // ---- 1) draft ----
  const draftPrompt = `You are a careful news editor. Write ONE original explainer article in ${lang} about the topic "${topic.query}".${angle ? `\nFocus: ${angle}` : ''}${rules.length ? `\nExtra rules for this kind of topic:\n- ${rules.join('\n- ')}` : ''}
Use ONLY facts that appear in the SOURCE NOTES below. If a detail is not in the notes, leave it out. Do not invent numbers, quotes, dates, names, reactions or opinions.
Do not describe photos or videos, public or online reaction, background history, or future plans unless the notes explicitly say so. Do not say a person "said" or "posted" something unless the notes say so.
Never use quotation marks or direct quotes: report what people said in your own words.
Write everything in your own words; never copy sentences. Do not mention "source notes" or "[1]". No lists, no bullet points, no markdown except lines starting with "## " for section headings. Put every "## " heading alone on its own line, with a blank line before and after it.
Length: about ${target} words. Never pad: if the notes do not contain enough facts, write fewer words (minimum 150). Use ${sections} sections with "## " headings and short paragraphs separated by blank lines.
Start with what happened and why people are searching for it. Do not add predictions, a "what to watch next" part, or any conclusion that is not in the notes.
Reply EXACTLY in this format:
TITLE: <clear headline, under 90 characters, no clickbait>
SUMMARY: <one sentence, under 150 characters>
CATEGORY: <one of: ${CATS.join(', ')}>
TAGS: <3 to 5 comma-separated keywords>
BODY:
<article>

SOURCE NOTES:
${notesText}`;
  const d = await runAI(env, [{ role: 'user', content: draftPrompt }], { max_tokens: 3200, temperature: 0.3 });
  if (!d.text) return retryLater(env, topic, research, 'AI draft nahi bana: ' + d.errors.join(' | ').slice(0, 700));
  const art = parseDraft(d.text);
  const wc = art.body.trim().split(/\s+/).filter(Boolean).length;
  if (!art.title || !art.body || wc < 150) return retryLater(env, topic, research, `Draft adhoora (${wc} shabd)`);

  // ---- 2) grounded fact-check by a second pass (prefers a different model) ----
  const checkEnv = { ...env, AI_MODEL: models.find((m) => m !== d.model) };
  const checkPrompt = `You are a strict fact-checker. Below are SOURCE NOTES and an ARTICLE.
List every factual claim in the ARTICLE (names, numbers, dates, events, what someone said or did, descriptions of photos, reactions). Maximum 15 claims.
Write ONE line per claim in exactly this format:
CLAIM: <the claim, short, in English> || EVIDENCE: <an exact copy of 6-20 consecutive words from the SOURCE NOTES that support this claim, or NONE if the notes do not support it>
Copy the evidence letter by letter from the notes. Do not paraphrase it. If you cannot find support, write NONE. Output only these lines.

SOURCE NOTES:
${notesText}

ARTICLE:
${art.title}\n${art.body}`;
  const c = await runAI(checkEnv, [{ role: 'user', content: checkPrompt }], { max_tokens: 4000, temperature: 0 });
  const claims = groundedCheck(c.text, notesText);
  if (claims.length < 3) return retryLater(env, topic, research, 'Fact-check ka result samajh nahi aaya: ' + (c.text ? c.text.slice(0, 200) : c.errors.join(' | ').slice(0, 700)));
  const okCount = claims.filter((x) => x.ok).length;
  const unsupported = claims.filter((x) => !x.ok);
  const bad = unsupported.length;
  const groundedScore = Math.round((100 * okCount) / claims.length);

  // ---- 3) copy + duplicate + number checks (no AI) ----
  const srcTexts = srcs.flatMap((s) => [s.text, s.snippet, s.title]);
  const cc = copyCheck(art.title + '\n' + art.body, srcTexts);
  const titles = (await env.DB.prepare('SELECT title FROM posts ORDER BY id DESC LIMIT 100').all()).results;
  const dup = titles.find((t) => jaccard(t.title, art.title) > 0.7);
  const nt = devDigits(notesText);
  const missingNums = (devDigits(art.body).match(/\d{2,}/g) || []).filter((n) => !nt.includes(n));
  let score = groundedScore - Math.round(cc.overlap * 200) - Math.min(15, missingNums.length * 5);
  score = Math.max(0, Math.min(100, score));

  const why = [];
  if (dup) why.push('Mila-julta title pehle se hai: ' + dup.title);
  if (cc.overlap > 0.12) why.push(`Copy overlap ${(cc.overlap * 100).toFixed(0)}% zyada`);
  if (cc.longest >= 14) why.push(`${cc.longest} shabd ki line sources se mil rahi`);
  if (bad >= 3) why.push(`${bad} claims ka sabut sources mein nahi: ` + unsupported.map((x) => x.claim).join(' ; ').slice(0, 300));
  if (score < 70) why.push(`Score ${score} kam`);
  if (why.length) {
    // har fail ka poora sabut save: kaun sa claim, evidence kya thi, kitna overlap (admin topic page par dikhta hai)
    research.diag = { at: now(), overlap: cc.overlap, longest: cc.longest, groundedScore, score, bad,
      claimList: claims.map((x) => ({ ok: x.ok, c: x.claim, e: String(x.evidence || '').slice(0, 160), why: x.why })) };
    return retryLater(env, topic, research, why.join('; '));
  }

  const postLang = env.POST_LANG === 'en' ? 'en' : 'hi';
  const fullText = art.title + '\n' + art.summary + '\n' + art.body;
  const checkJson = JSON.stringify({
    verified: bad === 0, unsupportedCount: bad, coverageLow: claims.length < expectedClaims(art.body),
    newest_source: Math.max(0, ...srcs.map((x) => x.date || 0)),
    claims: claims.length, supported: okCount, fixRounds: 0, overlap: cc.overlap, longest: cc.longest, score,
    numbersNotInSources: numbersNotIn(fullText, notesText), latinNotInSources: latinNotIn(fullText, notesText, postLang),
    claimList: claims.map((x) => ({ ok: x.ok, c: x.claim, e: String(x.evidence || x.why || '').slice(0, 200) })),
  });
  const category = CATS.find((x) => x.toLowerCase() === art.category.toLowerCase()) || 'India';
  const slug = (art.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'post') + '-' + Math.random().toString(36).slice(2, 7);
  const sources = JSON.stringify(srcs.map((s) => ({ title: `${s.source}: ${s.title}`.slice(0, 120), url: s.url })));
  const t = now();
  let pid = 0;
  try {
    const ins = await env.DB.prepare('INSERT INTO posts(slug,title,summary,body,category,tags,lang,sources,score,word_count,status,created_at,updated_at,check_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(slug, art.title.slice(0, 120), art.summary.slice(0, 200), art.body, category, art.tags, postLang, sources, score, wc, 'draft', t, t, checkJson).run();
    pid = (ins.meta && ins.meta.last_row_id) || 0;
  } catch (e) { return reject(env, topic, research, 'Save error: ' + e.message); }
  // image + video (never fails the draft)
  const media = pid ? await addMedia(env, pid, { query: topic.query, title: art.title, category, tags: String(art.tags || '').split(',').map((x) => x.trim()).filter(Boolean) }).catch(() => ({})) : {};
  research.check = {
    media: JSON.stringify(media), writer: d.model, checker: c.model, claims: claims.length, supported: okCount, groundedScore, overlap: cc.overlap, longest: cc.longest, angle, target,
    unsupported: unsupported.map((x) => x.claim).join(' ; ').slice(0, 600), numbersNotInSources: missingNums.slice(0, 8).join(','),
  };
  await env.DB.prepare("UPDATE topics SET status='used',research=?,updated_at=? WHERE id=?").bind(JSON.stringify(research), t, topic.id).run();
  return { ok: true, title: art.title, score, words: wc };
}
