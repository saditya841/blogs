// Updated writer.js with Image Generation & SEO Optimization
// Integrates: Multi-API AI + Image Generator + Viral Thumbnails + SEO

import { runAI, modelList } from './ai.js';
import { JUNK } from './trends.js';
import { addMedia } from './media.js';
import { groundedCheck as strictGroundedCheck, numbersNotIn, latinNotIn, expectedClaims } from './verify.js';
import { preflight } from './playbook.js';
import { extractFacts } from './facts.js';
import { parkTopic } from './card.js';

// NEW: Import image and SEO modules
import { ImageGenerator, addFeaturedImage } from './image-generator.js';
import { ViralThumbnailGenerator, generateSVGThumbnail } from './viral-thumbnail-generator.js';
import { SEOOptimizer, submitToIndexNow } from './seo-optimizer.js';

const now = () => Math.floor(Date.now() / 1000);
const CATS = ['India', 'Odisha', 'Business', 'Technology', 'Sports', 'Entertainment', 'Education', 'Jobs', 'Politics', 'World'];

// ... [Keep all existing helper functions: tok, shingles, devDigits, copyCheck, jaccard, notes, etc.] ...

// MODIFIED: writeOne function with image & SEO integration
export async function writeOne(env, opts = {}) {
  const limit = Number(env.DAILY_POST_LIMIT || 4);
  const made = (await env.DB.prepare('SELECT COUNT(*) c FROM posts WHERE created_at>?').bind(now() - 86400).first()).c;
  if (made >= limit) return { ok: false, reason: `Aaj ki limit (${limit}) poori` };

  // ... [Keep existing topic selection logic] ...

  // After topic is selected and before AI generation:
  const topic = /* ... topic selection code ... */;

  // ... [Keep existing AI draft generation code until draft is created] ...

  // After successful draft creation:
  const draft = /* ... existing draft parsing ... */;

  // NEW: Generate images (parallel processing)
  const imagePromises = [];

  // 1. Featured Image (professional)
  if (env.ENABLE_FEATURED_IMAGES !== 'false') {
    imagePromises.push(
      (async () => {
        const imageGen = new ImageGenerator(env);
        const imgResult = await imageGen.generateFeaturedImage(
          draft.title,
          draft.category,
          topic.id
        );
        if (imgResult.success) {
          draft.featured_image = imgResult.featuredImage;
          draft.og_image = imgResult.featuredImage;
        }
      })()
    );
  }

  // 2. Viral Thumbnail (text overlay)
  if (env.ENABLE_VIRAL_THUMBNAILS !== 'false') {
    imagePromises.push(
      (async () => {
        const thumbnailGen = new ViralThumbnailGenerator(env);
        const thumbResult = await thumbnailGen.generateViralThumbnail(
          draft.title,
          draft.category
        );
        if (thumbResult.success) {
          draft.thumbnail_image = thumbResult.imageUrl || thumbResult.imageData;
        } else {
          // Fallback: Generate SVG thumbnail
          const svg = generateSVGThumbnail(draft.title, draft.category, env.SITE_URL);
          // Convert SVG to data URL
          draft.thumbnail_image = `data:image/svg+xml;base64,${btoa(svg)}`;
        }
      })()
    );
  }

  // Wait for all image generation to complete
  await Promise.allSettled(imagePromises);

  // NEW: Generate SEO metadata
  const seoOptimizer = new SEOOptimizer(env);
  const seoMeta = seoOptimizer.generateSEOMetadata({
    ...draft,
    slug: topic.slug || slugify(draft.title),
    created_at: now(),
    updated_at: now(),
    tags: draft.tags || topic.query
  });

  // NEW: Analyze content quality
  const contentAnalysis = seoOptimizer.analyzeContent({
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    category: draft.category,
    tags: draft.tags,
    featured_image: draft.featured_image
  });

  // Add SEO score to draft
  draft.seo_score = contentAnalysis.score;

  // ... [Keep existing copy check and scoring logic] ...

  // Save to database with new fields
  const insertPost = `INSERT INTO posts (
    topic_id, title, summary, category, tags, body, sources,
    score, copy_overlap, copy_longest, seo_score,
    featured_image, thumbnail_image, og_image,
    meta_description, meta_keywords, schema_json,
    created_at, updated_at, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`;

  const result = await env.DB.prepare(insertPost).bind(
    topic.id,
    draft.title,
    draft.summary,
    draft.category,
    draft.tags,
    draft.body,
    JSON.stringify(research.sources || []),
    finalScore,
    overlap,
    longest,
    draft.seo_score || 0,
    draft.featured_image || null,
    draft.thumbnail_image || null,
    draft.og_image || null,
    seoMeta.metaDescription,
    seoMeta.keywords,
    seoMeta.schema,
    now(),
    now()
  ).run();

  const postId = result.meta.last_row_id;

  // NEW: Submit to IndexNow for instant indexing (when published)
  if (finalScore >= autoApprove && env.INDEXNOW_KEY) {
    const postUrl = `${env.SITE_URL}/post/${topic.slug || postId}`;
    await submitToIndexNow(env, postUrl);
  }

  // Mark topic as drafted
  await env.DB.prepare("UPDATE topics SET status='drafted',updated_at=? WHERE id=?")
    .bind(now(), topic.id).run();

  return {
    ok: true,
    postId,
    title: draft.title,
    score: finalScore,
    seoScore: draft.seo_score,
    copyOverlap: Math.round(overlap * 100),
    hasImages: {
      featured: !!draft.featured_image,
      thumbnail: !!draft.thumbnail_image
    },
    contentAnalysis: contentAnalysis.suggestions
  };
}

// Helper: Slugify title for URL
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// Keep all other existing functions...
