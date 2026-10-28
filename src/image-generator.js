// AI Image & Thumbnail Generation System for Viral Content
// Free APIs: Pollinations.ai, Replicate, DALL-E alternatives

const IMAGE_APIS = {
  pollinations: {
    name: 'Pollinations.ai',
    endpoint: 'https://image.pollinations.ai/prompt',
    free: true,
    noAuth: true
  },
  stabilityFree: {
    name: 'Stability AI (Free tier)',
    endpoint: 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
    free: false, // requires API key
    quality: 'high'
  },
  deepai: {
    name: 'DeepAI',
    endpoint: 'https://api.deepai.org/api/text2img',
    free: true,
    requiresKey: true
  }
};

export class ImageGenerator {
  constructor(env) {
    this.env = env;
  }

  // Generate image prompt from article headline (Hindi/English)
  generateImagePrompt(title, category) {
    const lang = this.env.POST_LANG === 'en' ? 'english' : 'hindi';

    // Style based on category
    const styles = {
      'Politics': 'professional news photo, Indian political leaders, parliament, serious tone',
      'Sports': 'action sports photography, Indian athletes, stadium, dynamic',
      'Entertainment': 'Bollywood style, celebrities, colorful, glamorous',
      'Business': 'corporate office, Indian business professional, modern, clean',
      'Technology': 'futuristic tech, Indian IT professional, modern gadgets',
      'India': 'Indian landmarks, diverse culture, patriotic colors',
      'World': 'international news, global perspective, world map',
      'Education': 'students, books, classroom, inspirational',
      'Jobs': 'office workspace, professional attire, opportunity',
      'Odisha': 'Odisha culture, Jagannath temple, traditional'
    };

    const styleGuide = styles[category] || 'Indian news context, professional journalism photo';

    // Clean title for prompt
    const cleanTitle = title
      .replace(/[""''"]/g, '')
      .replace(/[।|]/g, ',')
      .slice(0, 200);

    return `Professional news photograph for ${lang} article: "${cleanTitle}". Style: ${styleGuide}. High quality, photorealistic, suitable for news website banner. 16:9 aspect ratio. No text overlay.`;
  }

  // Generate image using Pollinations.ai (Free, No API key)
  async generateWithPollinations(prompt, options = {}) {
    const params = new URLSearchParams({
      prompt: prompt,
      width: options.width || 1200,
      height: options.height || 630,
      seed: options.seed || Math.floor(Math.random() * 1000000),
      model: 'flux', // or 'turbo' for faster generation
      nologo: 'true'
    });

    const imageUrl = `${IMAGE_APIS.pollinations.endpoint}/${encodeURIComponent(prompt)}?${params}`;

    try {
      // Fetch the generated image
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`Pollinations API error: ${response.status}`);

      const imageBlob = await response.blob();
      return {
        success: true,
        imageUrl: imageUrl,
        blob: imageBlob,
        provider: 'pollinations'
      };
    } catch (e) {
      return {
        success: false,
        error: e.message,
        provider: 'pollinations'
      };
    }
  }

  // Generate thumbnail with text overlay (like screenshots)
  async generateThumbnailWithText(headline, category, imageUrl) {
    // This will use Cloudflare Images or Canvas API to add text overlay
    // For now, return the base image URL
    return imageUrl;
  }

  // Upload image to Cloudflare R2 or serve via proxy
  async storeImage(imageBlob, postId) {
    // Option 1: Store in Cloudflare R2 (if configured)
    if (this.env.R2_BUCKET) {
      const key = `images/${postId}/${Date.now()}.jpg`;
      await this.env.R2_BUCKET.put(key, imageBlob);
      return `${this.env.SITE_URL}/images/${key}`;
    }

    // Option 2: Store as base64 in database (smaller images only)
    // Option 3: Use external image URL directly
    return null;
  }

  // Main function: Generate featured image for article
  async generateFeaturedImage(title, category, postId) {
    const errors = [];

    // Step 1: Generate prompt
    const prompt = this.generateImagePrompt(title, category);

    // Step 2: Try Pollinations.ai first (free, no auth)
    try {
      const result = await this.generateWithPollinations(prompt, {
        width: 1200,
        height: 630 // OG image size
      });

      if (result.success) {
        // Store or use direct URL
        const imageUrl = result.imageUrl;

        return {
          success: true,
          featuredImage: imageUrl,
          thumbnailImage: imageUrl, // Same for now, can add text overlay
          provider: 'pollinations',
          prompt: prompt
        };
      }

      errors.push(`Pollinations: ${result.error}`);
    } catch (e) {
      errors.push(`Pollinations: ${e.message}`);
    }

    // Step 3: Fallback - Use generic image from Unsplash API (free)
    try {
      const category_keywords = {
        'Politics': 'parliament,government',
        'Sports': 'sports,stadium',
        'Entertainment': 'cinema,bollywood',
        'Business': 'business,office',
        'Technology': 'technology,computer',
        'India': 'india,delhi',
        'World': 'world,globe',
        'Education': 'education,books',
        'Jobs': 'career,office',
        'Odisha': 'odisha,temple'
      };

      const keyword = category_keywords[category] || 'news,india';
      const unsplashUrl = `https://source.unsplash.com/1200x630/?${keyword}`;

      return {
        success: true,
        featuredImage: unsplashUrl,
        thumbnailImage: unsplashUrl,
        provider: 'unsplash',
        fallback: true
      };
    } catch (e) {
      errors.push(`Unsplash: ${e.message}`);
    }

    // All failed
    return {
      success: false,
      errors
    };
  }

  // Generate Open Graph meta image (for social sharing)
  generateOGImageUrl(title, category) {
    // Use dynamic OG image service
    const params = new URLSearchParams({
      title: title.slice(0, 100),
      category: category,
      site: this.env.SITE_NAME || 'Virall'
    });

    // You can use services like:
    // - https://og-image.vercel.app/
    // - https://www.opengraph.xyz/
    // Or build your own with Cloudflare Workers + Canvas

    return `https://og-image.vercel.app/${encodeURIComponent(title)}.png?theme=light&md=1&fontSize=75px`;
  }
}

// Helper: Generate text-overlay thumbnail (using HTML Canvas or external API)
export async function generateTextOverlayThumbnail(env, headline, backgroundImageUrl) {
  // This requires HTML Canvas API or external service
  // For Cloudflare Workers, you can use:
  // - Cloudflare Workers AI (image editing)
  // - External service like Bannerbear, Placid, etc.

  // Simplified version: return background image
  // TODO: Implement text overlay with Canvas API
  return backgroundImageUrl;
}

// Export for use in writer.js
export async function addFeaturedImage(env, post) {
  const generator = new ImageGenerator(env);
  const result = await generator.generateFeaturedImage(
    post.title,
    post.category,
    post.id
  );

  if (result.success) {
    post.featured_image = result.featuredImage;
    post.thumbnail_image = result.thumbnailImage;
    post.og_image = generator.generateOGImageUrl(post.title, post.category);
  }

  return post;
}
