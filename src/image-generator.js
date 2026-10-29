// Image Generator v2 — featured image for every article.
// Order: 1) Pexels stock photo (needs free PEXELS_API_KEY)  2) Pollinations AI (free, validated)  3) DEFAULT_IMAGE_URL.
// Fixes vs v1: removed the retired Unsplash Source fallback, Pollinations result is verified (real image, timeout),
// POST_LANG "eng"/"en" understood, R2 public URL fixed, no dependency on og-image.vercel.app.

const STOCK_KEYWORDS = {
  Politics: 'parliament government india',
  Sports: 'stadium sports india',
  Entertainment: 'cinema film camera',
  Business: 'business office india',
  Technology: 'technology computer',
  India: 'india city street',
  World: 'world globe city',
  Education: 'students classroom books',
  Jobs: 'office workspace career',
  Odisha: 'odisha temple india'
};

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

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

export class ImageGenerator {
  constructor(env) {
    this.env = env || {};
    this.timeoutMs = Number(this.env.IMAGE_TIMEOUT_MS) || 25000;
  }

  async _fetch(url, init = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Prompt for AI image (never asks for text inside the picture)
  generateImagePrompt(title, category) {
    const lang = isEnglish(this.env) ? 'english' : 'hindi';
    const styleGuide = STYLES[category] || 'Indian news context, professional journalism photo';
    const cleanTitle = String(title || '').replace(/["“”'‘’]/g, '').replace(/[।|]/g, ',').slice(0, 200);
    return `Professional news photograph for ${lang} article: "${cleanTitle}". Style: ${styleGuide}. High quality, photorealistic, suitable for news website banner. 16:9 aspect ratio. No text overlay.`;
  }

  // 1) Stock photo from Pexels
  async generateWithPexels(title, category) {
    const key = this.env.PEXELS_API_KEY;
    if (!key) return { success: false, error: 'PEXELS_API_KEY not set', provider: 'pexels' };
    try {
      const latin = (String(title || '').match(/[A-Za-z]{4,}/g) || []).slice(0, 3).join(' ');
      const query = latin.split(' ').length >= 2 ? latin : STOCK_KEYWORDS[category] || 'india news';
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`;
      const res = await this._fetch(url, { headers: { Authorization: key } });
      if (!res.ok) throw new Error(`Pexels API error: ${res.status}`);
      const data = await res.json();
      const photos = Array.isArray(data.photos) ? data.photos : [];
      if (!photos.length) throw new Error('no photos found');
      const photo = photos[hash(String(title || '')) % photos.length];
      const src = photo.src?.large2x || photo.src?.large || photo.src?.original;
      if (!src) throw new Error('photo has no src');
      return {
        success: true,
        imageUrl: src,
        provider: 'pexels',
        credit: `Photo: ${photo.photographer || 'Pexels'} / Pexels`
      };
    } catch (e) {
      return { success: false, error: e.message, provider: 'pexels' };
    }
  }

  // 2) AI image from Pollinations (free). The image is really fetched once, so a broken link is never saved.
  async generateWithPollinations(prompt, options = {}, postId = 'x') {
    const width = options.width || 1200;
    const height = options.height || 630;
    const params = new URLSearchParams({
      width: String(width),
      height: String(height),
      seed: String(options.seed ?? Math.floor(Math.random() * 1000000)),
      model: 'flux',
      nologo: 'true'
    });
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
    try {
      const response = await this._fetch(imageUrl);
      if (!response.ok) throw new Error(`Pollinations API error: ${response.status}`);
      const type = (response.headers && response.headers.get && response.headers.get('content-type')) || '';
      if (!/^image\//i.test(type)) throw new Error(`not an image (${type || 'no content-type'})`);

      let finalUrl = imageUrl;
      if (this.env.R2_BUCKET && this.env.R2_PUBLIC_BASE) {
        const stored = await this.storeImage(await response.blob(), postId);
        if (stored) finalUrl = stored;
      }
      return { success: true, imageUrl: finalUrl, provider: 'pollinations' };
    } catch (e) {
      return { success: false, error: e.message, provider: 'pollinations' };
    }
  }

  // Optional: keep a copy in R2 (needs R2_BUCKET binding + public bucket URL in R2_PUBLIC_BASE)
  async storeImage(imageBlob, postId) {
    if (!(this.env.R2_BUCKET && this.env.R2_PUBLIC_BASE)) return null;
    try {
      const key = `images/${postId}/${Date.now()}.jpg`;
      await this.env.R2_BUCKET.put(key, imageBlob, { httpMetadata: { contentType: imageBlob.type || 'image/jpeg' } });
      return `${String(this.env.R2_PUBLIC_BASE).replace(/\/+$/, '')}/${key}`;
    } catch {
      return null;
    }
  }

  // Main: returns { success, featuredImage, thumbnailImage, provider, credit, prompt, errors }
  async generateFeaturedImage(title, category, postId) {
    const errors = [];
    const prompt = this.generateImagePrompt(title, category);

    const pexels = await this.generateWithPexels(title, category);
    if (pexels.success) {
      return { success: true, featuredImage: pexels.imageUrl, thumbnailImage: pexels.imageUrl, provider: 'pexels', credit: pexels.credit, prompt, errors };
    }
    if (this.env.PEXELS_API_KEY) errors.push(`Pexels: ${pexels.error}`);

    if (this.env.ENABLE_AI_IMAGES !== 'false') {
      const poll = await this.generateWithPollinations(prompt, { width: 1200, height: 630 }, postId);
      if (poll.success) {
        return { success: true, featuredImage: poll.imageUrl, thumbnailImage: poll.imageUrl, provider: 'pollinations', credit: '', prompt, errors };
      }
      errors.push(`Pollinations: ${poll.error}`);
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
