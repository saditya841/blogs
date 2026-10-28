// Viral Thumbnail Generator - Creates text-overlay style images like screenshots
// Uses HTML Canvas API via Cloudflare Workers or external services

export class ViralThumbnailGenerator {
  constructor(env) {
    this.env = env;
  }

  // Generate viral-style thumbnail with text overlay
  async generateViralThumbnail(headline, category, options = {}) {
    // Option 1: Use Cloudflare Workers AI for image generation
    if (this.env.AI && this.env.USE_VIRAL_THUMBNAILS === 'true') {
      return await this.generateWithWorkersAI(headline, category, options);
    }

    // Option 2: Use external thumbnail API (Bannerbear, Placid, etc.)
    if (this.env.BANNERBEAR_API_KEY) {
      return await this.generateWithBannerbear(headline, category);
    }

    // Option 3: Use OG Image service with custom template
    return await this.generateWithOGImage(headline, category);
  }

  // Method 1: Cloudflare Workers AI (text-to-image)
  async generateWithWorkersAI(headline, category, options) {
    try {
      const prompt = this.createViralPrompt(headline, category);

      const response = await this.env.AI.run(
        '@cf/stabilityai/stable-diffusion-xl-base-1.0',
        {
          prompt: prompt,
          num_steps: 20
        }
      );

      // Workers AI returns image as base64
      return {
        success: true,
        imageData: response,
        type: 'base64',
        provider: 'workers-ai'
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Method 2: External service (Bannerbear, Placid, etc.)
  async generateWithBannerbear(headline, category) {
    // Bannerbear API integration
    // Requires: env.BANNERBEAR_API_KEY
    const templateId = this.env.BANNERBEAR_TEMPLATE_ID || 'default';

    try {
      const response = await fetch('https://api.bannerbear.com/v2/images', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.BANNERBEAR_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          template: templateId,
          modifications: [
            {
              name: 'headline',
              text: headline
            },
            {
              name: 'category',
              text: category
            }
          ]
        })
      });

      const data = await response.json();
      return {
        success: true,
        imageUrl: data.image_url,
        provider: 'bannerbear'
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Method 3: Free OG Image service (Vercel style)
  async generateWithOGImage(headline, category) {
    // Use free OG image generator with custom styling
    const styles = {
      backgroundColor: this.getCategoryColor(category),
      textColor: '#FFFFFF',
      fontSize: '60px',
      fontWeight: 'bold'
    };

    // Split headline into multiple lines (max 3 lines)
    const lines = this.splitHeadline(headline, 40);

    // Generate image URL with text
    const params = new URLSearchParams({
      title: lines.join('\n'),
      category: category,
      bg: styles.backgroundColor.replace('#', ''),
      fontSize: '70px',
      theme: 'dark'
    });

    const imageUrl = `https://og-image.vercel.app/${encodeURIComponent(lines[0])}.png?${params}`;

    return {
      success: true,
      imageUrl: imageUrl,
      provider: 'og-image'
    };
  }

  // Helper: Create viral-style prompt for AI
  createViralPrompt(headline, category) {
    return `Create a viral news thumbnail image with:
- Bold colorful background (gradient: yellow to red for breaking news, blue for general)
- Large Hindi/English text: "${headline}"
- News channel style design
- Professional yet eye-catching
- Similar to Indian news channels graphics
- 16:9 aspect ratio
- High contrast text
- No faces, just typography and graphics`;
  }

  // Helper: Get category-based color scheme
  getCategoryColor(category) {
    const colors = {
      'Politics': '#FF0000',     // Red
      'Sports': '#00FF00',       // Green
      'Entertainment': '#FF1493', // Pink
      'Business': '#0066CC',     // Blue
      'Technology': '#9966FF',   // Purple
      'India': '#FF9933',        // Saffron
      'World': '#000080',        // Navy
      'Education': '#4169E1',    // Royal Blue
      'Jobs': '#228B22',         // Forest Green
      'Odisha': '#FF6600'        // Orange
    };
    return colors[category] || '#1E40AF';
  }

  // Helper: Split long headlines into multiple lines
  splitHeadline(headline, maxCharsPerLine) {
    const words = headline.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + word).length > maxCharsPerLine && currentLine) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine += word + ' ';
      }
      if (lines.length >= 2) break; // Max 3 lines
    }
    if (currentLine) lines.push(currentLine.trim());

    return lines;
  }

  // Generate multiple thumbnail variants
  async generateThumbnailVariants(headline, category) {
    const variants = [];

    // Variant 1: Square (1:1) - Instagram
    variants.push({
      type: 'square',
      size: '1080x1080',
      ...(await this.generateViralThumbnail(headline, category, { ratio: '1:1' }))
    });

    // Variant 2: Landscape (16:9) - Facebook/Twitter
    variants.push({
      type: 'landscape',
      size: '1200x630',
      ...(await this.generateViralThumbnail(headline, category, { ratio: '16:9' }))
    });

    // Variant 3: Story (9:16) - Instagram Stories
    variants.push({
      type: 'story',
      size: '1080x1920',
      ...(await this.generateViralThumbnail(headline, category, { ratio: '9:16' }))
    });

    return variants;
  }
}

// SVG-based thumbnail generator (works without external APIs)
export function generateSVGThumbnail(headline, category, siteUrl) {
  const bgColor = getCategoryColor(category);
  const lines = splitHeadline(headline, 40);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bgColor};stop-opacity:1" />
      <stop offset="100%" style="stop-color:#000000;stop-opacity:0.8" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#grad1)"/>

  <!-- Category Tag -->
  <rect x="50" y="50" width="200" height="60" fill="#FFEB3B" rx="10"/>
  <text x="150" y="88" font-family="Arial, sans-serif" font-size="28" font-weight="bold"
        fill="#000000" text-anchor="middle">${category.toUpperCase()}</text>

  <!-- Headline Text -->
  ${lines.map((line, i) => `
    <text x="600" y="${230 + (i * 80)}" font-family="Arial, sans-serif" font-size="60"
          font-weight="bold" fill="#FFFFFF" text-anchor="middle"
          stroke="#000000" stroke-width="2">${escapeXML(line)}</text>
  `).join('')}

  <!-- Site Name -->
  <text x="600" y="580" font-family="Arial, sans-serif" font-size="32"
        fill="#FFFFFF" text-anchor="middle" opacity="0.9">${siteUrl}</text>
</svg>`;

  return svg;
}

function escapeXML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getCategoryColor(category) {
  const colors = {
    'Politics': '#DC2626',
    'Sports': '#16A34A',
    'Entertainment': '#EC4899',
    'Business': '#2563EB',
    'Technology': '#8B5CF6',
    'India': '#F97316',
    'World': '#0C4A6E',
    'Education': '#3B82F6',
    'Jobs': '#059669',
    'Odisha': '#EA580C'
  };
  return colors[category] || '#1E40AF';
}

function splitHeadline(headline, maxCharsPerLine) {
  const words = headline.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + word).length > maxCharsPerLine && currentLine) {
      lines.push(currentLine.trim());
      currentLine = word + ' ';
    } else {
      currentLine += word + ' ';
    }
    if (lines.length >= 2) break;
  }
  if (currentLine) lines.push(currentLine.trim());

  return lines;
}
