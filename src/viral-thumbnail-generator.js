// Viral Thumbnail Generator v2 — news-card style thumbnail with the headline written on it.
// Default = SVG generated right here (free, no API, Hindi-safe) and returned as a data URL, which any <img> can show.
// Optional premium: Bannerbear (set BANNERBEAR_API_KEY + BANNERBEAR_TEMPLATE_ID).
// Why Workers-AI text-to-image was removed: it cannot write Hindi text correctly and returned raw bytes, not a URL.

export const SIZES = {
  landscape: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 }
};

const COLORS = {
  Politics: '#DC2626', Sports: '#16A34A', Entertainment: '#EC4899', Business: '#2563EB', Technology: '#8B5CF6',
  India: '#F97316', World: '#0C4A6E', Education: '#3B82F6', Jobs: '#059669', Odisha: '#EA580C'
};

export const getCategoryColor = (category) => COLORS[category] || '#1E40AF';

export function escapeXML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Split into lines that fit; never more than maxLines (last line gets an ellipsis when text is cut)
export function splitHeadline(headline, maxChars = 26, maxLines = 4) {
  const words = String(headline || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    if (w.length > maxChars) w = w.slice(0, maxChars - 1) + '…';
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/…$/, '') + '…';
    return cut;
  }
  return lines;
}

// UTF-8 safe data URL (btoa() breaks on Hindi)
export const svgToDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function generateSVGThumbnail(headline, category, siteUrl, options = {}) {
  const size = SIZES[options.ratio] || SIZES.landscape;
  const { w, h } = size;
  const scale = w / 1200;
  const maxChars = Math.max(14, Math.round(26 * scale));
  const lines = splitHeadline(headline, maxChars, options.ratio === 'story' ? 7 : 4);
  const fontSize = Math.round((lines.length <= 2 ? 72 : lines.length === 3 ? 62 : 54) * scale);
  const lineH = Math.round(fontSize * 1.35);
  const blockH = lines.length * lineH;
  const startY = Math.round((h - blockH) / 2 + fontSize * 0.9);
  const bg = getCategoryColor(category);
  const host = String(siteUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const tag = escapeXML(String(category || 'News').toUpperCase());
  const tagW = Math.max(180, tag.length * 22 + 60);
  const font = "'Noto Sans Devanagari','Nirmala UI','Mangal','Segoe UI',Arial,sans-serif";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bg}" stop-opacity="1"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect x="${Math.round(50 * scale)}" y="${Math.round(50 * scale)}" width="${Math.round(tagW * scale)}" height="${Math.round(60 * scale)}" fill="#FFEB3B" rx="10"/>
  <text x="${Math.round((50 + tagW / 2) * scale)}" y="${Math.round(92 * scale)}" font-family="${font}" font-size="${Math.round(28 * scale)}" font-weight="bold" fill="#000000" text-anchor="middle">${tag}</text>
${lines.map((line, i) => `  <text x="${w / 2}" y="${startY + i * lineH}" font-family="${font}" font-size="${fontSize}" font-weight="bold" fill="#FFFFFF" text-anchor="middle" stroke="#000000" stroke-width="2" paint-order="stroke">${escapeXML(line)}</text>`).join('\n')}
  <text x="${w / 2}" y="${h - Math.round(40 * scale)}" font-family="${font}" font-size="${Math.round(30 * scale)}" fill="#FFFFFF" text-anchor="middle" opacity="0.9">${escapeXML(host)}</text>
</svg>`;
}

export class ViralThumbnailGenerator {
  constructor(env) {
    this.env = env || {};
  }

  // Always returns { success, imageUrl, provider, ... } — imageUrl is a string (https URL or data URL)
  async generateViralThumbnail(headline, category, options = {}) {
    if (this.env.BANNERBEAR_API_KEY) {
      const r = await this.generateWithBannerbear(headline, category);
      if (r.success) return r;
    }
    return this.generateWithSVG(headline, category, options);
  }

  generateWithSVG(headline, category, options = {}) {
    try {
      const size = SIZES[options.ratio] || SIZES.landscape;
      const svg = generateSVGThumbnail(headline, category, this.env.SITE_URL, options);
      return { success: true, imageUrl: svgToDataUrl(svg), type: 'svg-data-url', provider: 'svg', width: size.w, height: size.h };
    } catch (e) {
      return { success: false, error: e.message, provider: 'svg' };
    }
  }

  // Premium option (sync endpoint returns the finished image URL)
  async generateWithBannerbear(headline, category) {
    try {
      const response = await fetch('https://sync.api.bannerbear.com/v2/images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.env.BANNERBEAR_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: this.env.BANNERBEAR_TEMPLATE_ID || 'default',
          modifications: [{ name: 'headline', text: headline }, { name: 'category', text: category }]
        })
      });
      if (!response.ok) throw new Error(`Bannerbear API error: ${response.status}`);
      const data = await response.json();
      if (!data.image_url) throw new Error('no image_url in response');
      return { success: true, imageUrl: data.image_url, provider: 'bannerbear' };
    } catch (e) {
      return { success: false, error: e.message, provider: 'bannerbear' };
    }
  }

  getCategoryColor(category) { return getCategoryColor(category); }
  splitHeadline(headline, maxCharsPerLine = 26, maxLines = 4) { return splitHeadline(headline, maxCharsPerLine, maxLines); }

  // Square (Instagram), landscape (Facebook/Twitter), story (Instagram Stories) — really different sizes now
  async generateThumbnailVariants(headline, category) {
    const out = [];
    for (const [type, ratio, size] of [['square', 'square', '1080x1080'], ['landscape', 'landscape', '1200x630'], ['story', 'story', '1080x1920']]) {
      out.push({ type, size, ...this.generateWithSVG(headline, category, { ratio }) });
    }
    return out;
  }
}
