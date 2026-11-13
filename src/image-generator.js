// Image Generator v3 — featured image for every article.
// Order: 1) Pexels stock photo (free key, relevance-checked)  2) Workers AI illustration stored in D1 (stable URL)
//        3) DEFAULT_IMAGE_URL.
// v3: the Pollinations hotlink is no longer used by default (it broke when their service was slow/rate-limited);
//     the AI illustration now comes from the same code as media.js, so one article never gets two image systems.

import { aiThumbnail, findPexels, topicAmbiguous } from './media.js';

const STYLES = {
  Politics: 'professional news photo, parliament, serious tone',
  Sports: 'action sports photography, stadium, dynamic',
  Entertainment: 'cinema style, colorful, glamorous',
  Business: 'corporate office, modern, clean',
  Technology: 'futuristic tech, modern gadgets',
  India: 'Indian landmarks, diverse culture',
  World: 'international news, global perspective',
  Education: 'students, books, classroom, inspirational',
  Jobs: 'office workspace, professional, opportunity',
  Odisha: 'Odisha culture, Jagannath temple, traditional'
};

export const isEnglish = (env) => /^en/i.test(String((env && env.POST_LANG) || ''));

export class ImageGenerator {
  constructor(env) {
    this.env = env || {};
  }

  // Prompt for AI image (never asks for text inside the picture)
  generateImagePrompt(title, category) {
    const lang = isEnglish(this.env) ? 'english' : 'hindi';
    const styleGuide = STYLES[category] || 'Indian news context, professional journalism photo';
    const cleanTitle = String(title || '').replace(/["“”'‘’]/g, '').replace(/[।|]/g, ',').slice(0, 200);
    return `Professional news photograph for ${lang} article: "${cleanTitle}". Style: ${styleGuide}. High quality, photorealistic, suitable for news website banner. 16:9 aspect ratio. No text overlay.`;
  }

  // 1) Stock photo from Pexels — one shared, relevance-checked implementation (media.js)
  async generateWithPexels(title, category) {
    if (!this.env.PEXELS_API_KEY) return { success: false, error: 'PEXELS_API_KEY not set', provider: 'pexels' };
    try {
      const r = await findPexels(this.env, title, category);
      if (!r) throw new Error('koi relevant photo nahi mili');
      return { success: true, imageUrl: r.url, provider: 'pexels', credit: r.credit };
    } catch (e) {
      return { success: false, error: e.message, provider: 'pexels' };
    }
  }

  // Main: returns { success, featuredImage, thumbnailImage, provider, credit, prompt, errors }
  async generateFeaturedImage(title, category, postId) {
    const errors = [];
    const prompt = this.generateImagePrompt(title, category);
    // Short/ambiguous titles ("DAC", a Hindi-only query) have no usable stock-search keywords.
    // Searching a photo library for the category image gives a generic, misleading photo, so draw
    // the AI illustration FIRST and only fall back to stock when the title is specific enough.
    const ambiguous = topicAmbiguous(title, category);
    const canAI = this.env.ENABLE_AI_IMAGES !== 'false' && this.env.AI;

    const tryPexels = async () => {
      const pexels = await this.generateWithPexels(title, category);
      if (pexels.success) return { success: true, featuredImage: pexels.imageUrl, thumbnailImage: pexels.imageUrl, provider: 'pexels', credit: pexels.credit, prompt, errors };
      if (this.env.PEXELS_API_KEY) errors.push(`Pexels: ${pexels.error}`);
      return null;
    };
    const tryAI = async () => {
      if (!canAI) return null;
      const ai = await aiThumbnail(this.env, { query: title, category }).catch((e) => { errors.push(`Workers AI: ${String(e.message).slice(0, 80)}`); return null; });
      return ai && ai.url ? { success: true, featuredImage: ai.url, thumbnailImage: ai.url, provider: 'workers-ai', credit: ai.credit, prompt, errors } : null;
    };

    if (!ambiguous) {
      const p = await tryPexels();
      if (p) return p;
    }
    const ai = await tryAI();
    if (ai) return ai;
    if (ambiguous) {
      const p = await tryPexels();
      if (p) return p;
    }

    if (this.env.DEFAULT_IMAGE_URL) {
      return { success: true, featuredImage: this.env.DEFAULT_IMAGE_URL, thumbnailImage: this.env.DEFAULT_IMAGE_URL, provider: 'default', credit: '', fallback: true, prompt, errors };
    }
    return { success: false, errors };
  }

  // Social preview image: the featured photo itself (or the default image)
  generateOGImageUrl() {
    return this.env.DEFAULT_IMAGE_URL || '';
  }
}

// Helper for writer.js style usage
export async function addFeaturedImage(env, post) {
  const generator = new ImageGenerator(env);
  const result = await generator.generateFeaturedImage(post.title, post.category, post.id);
  if (result.success) {
    post.featured_image = result.featuredImage;
    post.thumbnail_image = result.thumbnailImage;
    post.og_image = result.featuredImage;
    if (result.credit) post.image_credit = result.credit;
  }
  return post;
}

// Kept for compatibility: text overlay is done by viral-thumbnail-generator.js
export async function generateTextOverlayThumbnail(env, headline, backgroundImageUrl) {
  return backgroundImageUrl;
}
