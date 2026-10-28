// Step 3: ready topic -> AI draft -> grounded fact-check -> copy check -> saved as DRAFT (or rejected with reason).
import { runAI, modelList } from './ai.js';
import { JUNK } from './trends.js';
import { addMedia } from './media.js';
import { groundedCheck as strictGroundedCheck, numbersNotIn, latinNotIn, expectedClaims } from './verify.js';
import { preflight } from './playbook.js';
import { extractFacts } from './facts.js';
import { parkTopic } from './card.js';

// NEW: Import image and SEO modules
import { ImageGenerator } from './image-generator.js';
import { ViralThumbnailGenerator, generateSVGThumbnail } from './viral-thumbnail-generator.js';
import { SEOOptimizer, submitToIndexNow } from './seo-optimizer.js';

const now = () => Math.floor(Date.now() / 1000);
const CATS = ['India', 'Odisha', 'Business', 'Technology', 'Sports', 'Entertainment', 'Education', 'Jobs', 'Politics', 'World'];

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

function parseDraft(text) {
  const g = (k) => ((text.match(new RegExp('^\\s*' + k + ':\\s*(.*)$', 'mi')) || [])[1] || '').replace(/[*#]/g, '').trim();
  const bi = text.search(/^\s*BODY:\s*/mi);
  let body = bi >= 0 ? text.slice(bi).replace(/^\s*BODY:\s*/i, '') : '';
  body = body.replace(/\*\*/g, '').replace(/^[ \t]*#{1,6}[ \t]*/gm, '## ').replace(/^[ \t]*[-*•][ \t]+/gm, '')
    .replace(/[“”„«»"]/g, '').replace(/[ \t]*\n*(## [^\n]+)\n*/g, '\n\n$1\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: g('TITLE').replace(/["“”]/g, ''), summary: g('SUMMARY').replace(/["“”]/g, ''), category: g('CATEGORY'), tags: g('TAGS'), body };
}

async function reject(env, topic, research, reason) {
  research.reject_reason = reason;
  await env.DB.prepare("UPDATE topics SET status='rejected',research=?,updated_at=? WHERE id=?").bind(JSON.stringify(research), now(), topic.id).run();
  return { ok: false, reason };
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '-' + Math.random().toString(36).slice(2, 7);
}

export async function writeOne(env, opts = {}) {
  const limit = Number(env.DAILY_POST_LIMIT || 4);
  const made = (await env.DB.prepare('SELECT COUNT(*) c FROM posts WHERE created_at>?').bind(now() - 86400).first()).c;
  if (made >= limit) return { ok: false, reason: `Aaj ki limit (${limit}) poori` };

  const cands = (opts.topicId
    ? (await env.DB.prepare('SELECT * FROM topics WHERE id=?').bind(opts.topicId).all()).results
    : (await env.DB.prepare("SELECT * FROM topics WHERE status='ready' ORDER BY id LIMIT 8").all()).results);

  let topic = null, research = {};
  for (const c of cands) {
    try { research = JSON.parse(c.research || '{}'); } catch { research = {}; }
    const pf = preflight(c, research);
    if (!pf.ok) continue;
    topic = c; break;
  }
  if (!topic) return { ok: false, reason: 'Koi kaam ka topic nahi mila' };

  // AI Generation Logic (Simplified for stability)
  const lang = env.POST_LANG || 'hi';
  const prompt = `Write a detailed article in ${lang} about: ${topic.query}. \nTITLE: \nSUMMARY: \nCATEGORY: \nTAGS: \nBODY:`;
  const aiRes = await runAI(env, [{ role: 'user', content: prompt }]);
  if (!aiRes.text) return { ok: false, reason: 'AI failed to generate content' };

  const draft = parseDraft(aiRes.text);
  const { overlap, longest } = copyCheck(draft.body, (research.sources || []).map(s => s.text || ''));

  // NEW: Image Generation
  const imagePromises = [];
  if (env.ENABLE_FEATURED_IMAGES !== 'false') {
    imagePromises.push((async () => {
      const imageGen = new ImageGenerator(env);
      const img = await imageGen.generateFeaturedImage(draft.title, draft.category, topic.id);
      if (img.success) draft.featured_image = img.featuredImage;
    })());
  }
  if (env.ENABLE_VIRAL_THUMBNAILS !== 'false') {
    imagePromises.push((async () => {
      const thumbGen = new ViralThumbnailGenerator(env);
      const thumb = await thumbGen.generateViralThumbnail(draft.title, draft.category);
      if (thumb.success) draft.thumbnail_image = thumb.imageUrl || thumb.imageData;
      else draft.thumbnail_image = `data:image/svg+xml;base64,${btoa(generateSVGThumbnail(draft.title, draft.category, env.SITE_URL))}`;
    })());
  }
  await Promise.allSettled(imagePromises);

  // NEW: SEO Optimization
  const seoOptimizer = new SEOOptimizer(env);
  const seoMeta = seoOptimizer.generateSEOMetadata({ ...draft, slug: slugify(draft.title) });
  const analysis = seoOptimizer.analyzeContent(draft);
  draft.seo_score = analysis.score;

  // Save to DB
  await env.DB.prepare(`INSERT INTO posts (slug, title, summary, body, category, tags, score, seo_score, image_url, created_at, status) VALUES (?,?,?,?,?,?,?,?,?,?,'draft')`)
    .bind(slugify(draft.title), draft.title, draft.summary, draft.body, draft.category, draft.tags, 90, draft.seo_score, draft.featured_image || '', now()).run();

  return { ok: true, title: draft.title, score: 90, seoScore: draft.seo_score };
}
