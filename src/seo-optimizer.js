// SEO & Traffic Optimization Module  (FIXED v2)
// Fixes: "ERROR: Invalid time value", crash on missing tags/body, broken HTML attributes,
//        </script> injection in JSON-LD, "undefined" in canonical URL.
// Public API is unchanged: SEOOptimizer, generateSocialShareLinks, submitToIndexNow.

// ---------- safe helpers ----------

// HTML-escape for text and attribute values
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// JSON for use inside <script type="application/ld+json"> (cannot close the script tag)
const safeJson = (obj) =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

// Any timestamp -> valid ISO string. Never throws.
// Accepts: seconds, milliseconds, numeric string, ISO string, Date. null/undefined/garbage -> fallback.
function toISO(value, fallback) {
  const fb = fallback instanceof Date && !Number.isNaN(fallback.getTime()) ? fallback : new Date();
  let d = null;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'number' || (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value))) {
    const n = Number(value);
    d = new Date(n < 1e12 ? n * 1000 : n); // < 1e12 => seconds, else milliseconds
  } else if (typeof value === 'string' && value.trim()) {
    d = new Date(value);
  }
  if (!d || Number.isNaN(d.getTime())) d = fb;
  return d.toISOString();
}

const toStr = (v) => (v === null || v === undefined ? '' : String(v));
const tagList = (tags) =>
  toStr(Array.isArray(tags) ? tags.join(',') : tags).split(',').map((t) => t.trim()).filter(Boolean);

export class SEOOptimizer {
  constructor(env) {
    this.env = env || {};
  }

  // post path: slug first, then id. Never prints "undefined".
  postUrl(post) {
    const site = toStr(this.env.SITE_URL).replace(/\/+$/, '');
    const key = post.slug || (post.id !== undefined && post.id !== null ? String(post.id) : '');
    return key ? `${site}/post/${encodeURIComponent(key)}` : site;
  }

  // Generate SEO-optimized metadata
  generateSEOMetadata(post) {
    const publishDate = toISO(post.created_at);
    const modifiedDate = toISO(post.updated_at, new Date(publishDate)); // NULL updated_at => same as publish date
    const url = this.postUrl(post);
    const image = post.thumbnail_image || post.featured_image;

    return {
      // Primary SEO
      title: this.optimizeTitle(post.title),
      metaDescription: this.generateMetaDescription(post),
      keywords: this.extractKeywords(post),

      // Open Graph (Facebook, LinkedIn)
      ogTitle: this.optimizeOGTitle(post.title),
      ogDescription: this.generateOGDescription(post),
      ogImage: image,
      ogType: 'article',
      ogUrl: url,

      // Twitter Card
      twitterCard: 'summary_large_image',
      twitterTitle: this.optimizeTitle(post.title),
      twitterDescription: this.generateMetaDescription(post),
      twitterImage: image,

      // Schema.org (Google Rich Snippets)
      schema: this.generateArticleSchema(post),

      // Additional SEO
      canonicalUrl: url,
      robots: 'index, follow',
      author: this.env.AUTHOR_NAME || 'Virall Desk',
      publishDate,
      modifiedDate
    };
  }

  // Optimize title for SEO (60 chars max for Google)
  optimizeTitle(title) {
    const t = toStr(title);
    if (t.length <= 60) return t;
    return t.slice(0, 57) + '...';
  }

  // Optimize for Open Graph (longer allowed)
  optimizeOGTitle(title) {
    const t = toStr(title);
    if (t.length <= 90) return t;
    return t.slice(0, 87) + '...';
  }

  firstParagraph(post) {
    return toStr(post.body).split('\n\n')[0].replace(/##/g, '').trim();
  }

  // Generate compelling meta description (155-160 chars)
  generateMetaDescription(post) {
    const summary = toStr(post.summary);
    if (summary.length >= 100 && summary.length <= 160) return summary;

    const firstPara = this.firstParagraph(post);
    if (firstPara.length <= 160) return firstPara;
    return firstPara.slice(0, 157) + '...';
  }

  // Generate OG description (longer allowed, 200 chars)
  generateOGDescription(post) {
    if (post.summary) return toStr(post.summary);
    const firstPara = this.firstParagraph(post);
    if (firstPara.length <= 200) return firstPara;
    return firstPara.slice(0, 197) + '...';
  }

  // Extract keywords from content
  extractKeywords(post) {
    const text = `${toStr(post.title)} ${toStr(post.body)}`.toLowerCase();

    // Common Hindi/English stop words to ignore
    const stopWords = new Set([
      'और', 'का', 'की', 'को', 'में', 'से', 'है', 'हैं', 'था', 'थे', 'ने', 'पर', 'यह', 'वह',
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'
    ]);

    // Extract words (3+ chars)
    const words = text.match(/[a-zA-Zऀ-ॿ]{3,}/g) || [];

    const freq = {};
    words.forEach((word) => {
      if (!stopWords.has(word)) freq[word] = (freq[word] || 0) + 1;
    });

    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    const keywords = [post.category, ...tagList(post.tags), ...sorted].filter(Boolean);
    return [...new Set(keywords)].join(', ');
  }

  // Generate Article Schema (Google Rich Snippets) — returns a JSON string safe for <script>
  generateArticleSchema(post) {
    const publishDate = toISO(post.created_at);
    const modifiedDate = toISO(post.updated_at, new Date(publishDate));
    const site = toStr(this.env.SITE_URL);

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      'headline': toStr(post.title),
      'description': this.generateMetaDescription(post),
      'image': [post.featured_image, post.thumbnail_image].filter(Boolean),
      'datePublished': publishDate,
      'dateModified': modifiedDate,
      'author': {
        '@type': 'Organization',
        'name': this.env.AUTHOR_NAME || 'Virall Desk',
        'url': site
      },
      'publisher': {
        '@type': 'Organization',
        'name': this.env.SITE_NAME || 'Virall',
        'logo': { '@type': 'ImageObject', 'url': `${site}/logo.png` }
      },
      'mainEntityOfPage': { '@type': 'WebPage', '@id': this.postUrl(post) }
    };

    return safeJson(schema);
  }

  // Generate complete HTML meta tags (all values HTML-escaped)
  generateMetaTags(post) {
    const meta = this.generateSEOMetadata(post);
    const siteName = esc(this.env.SITE_NAME || 'Virall');
    const tags = esc(tagList(post.tags).join(', '));
    const img = (name, val) => (val ? `\n    <meta ${name} content="${esc(val)}">` : '');

    return `
    <!-- Primary Meta Tags -->
    <title>${esc(meta.title)}</title>
    <meta name="title" content="${esc(meta.title)}">
    <meta name="description" content="${esc(meta.metaDescription)}">
    <meta name="keywords" content="${esc(meta.keywords)}">
    <meta name="author" content="${esc(meta.author)}">
    <meta name="robots" content="${esc(meta.robots)}">
    <link rel="canonical" href="${esc(meta.canonicalUrl)}">

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="${esc(meta.ogType)}">
    <meta property="og:url" content="${esc(meta.ogUrl)}">
    <meta property="og:title" content="${esc(meta.ogTitle)}">
    <meta property="og:description" content="${esc(meta.ogDescription)}">${img('property="og:image"', meta.ogImage)}
    <meta property="og:site_name" content="${siteName}">
    <meta property="article:published_time" content="${esc(meta.publishDate)}">
    <meta property="article:modified_time" content="${esc(meta.modifiedDate)}">
    <meta property="article:author" content="${esc(meta.author)}">
    <meta property="article:section" content="${esc(post.category)}">
    <meta property="article:tag" content="${tags}">

    <!-- Twitter -->
    <meta property="twitter:card" content="${esc(meta.twitterCard)}">
    <meta property="twitter:url" content="${esc(meta.ogUrl)}">
    <meta property="twitter:title" content="${esc(meta.twitterTitle)}">
    <meta property="twitter:description" content="${esc(meta.twitterDescription)}">${img('property="twitter:image"', meta.twitterImage)}

    <!-- Google News -->
    <meta name="news_keywords" content="${esc(meta.keywords)}">

    <!-- Schema.org JSON-LD -->
    <script type="application/ld+json">
    ${meta.schema}
    </script>
    `.trim();
  }

  // Content optimization suggestions
  analyzeContent(post) {
    const issues = [];
    const suggestions = [];
    const title = toStr(post.title);
    const body = toStr(post.body);

    if (title.length < 30) {
      issues.push('Title too short (< 30 chars)');
      suggestions.push('Add more descriptive words to title');
    }
    if (title.length > 70) {
      issues.push('Title too long (> 70 chars) - will be truncated in search');
    }

    const metaDesc = this.generateMetaDescription(post);
    if (metaDesc.length < 120) {
      issues.push('Meta description too short');
    }

    if (!post.featured_image) {
      issues.push('No featured image - reduces social media engagement');
      suggestions.push('Add a featured image for better visibility');
    }

    const wordCount = body.split(/\s+/).filter(Boolean).length;
    if (wordCount < 300) {
      issues.push(`Content too short (${wordCount} words) - aim for 500+`);
      suggestions.push('Add more details, examples, or context');
    }

    const headings = (body.match(/^##\s/gm) || []).length;
    if (headings < 2) {
      suggestions.push('Add more headings (##) to improve readability');
    }

    const titleWords = new Set(title.toLowerCase().split(/\s+/).filter(Boolean));
    const bodyWords = new Set(body.toLowerCase().split(/\s+/).filter(Boolean));
    const overlap = [...titleWords].filter((w) => bodyWords.has(w)).length;
    if (titleWords.size > 0 && overlap / titleWords.size < 0.5) {
      suggestions.push('Use more title keywords in the content');
    }

    return {
      score: Math.max(0, 100 - issues.length * 15 - suggestions.length * 5),
      issues,
      suggestions,
      stats: {
        titleLength: title.length,
        metaDescLength: metaDesc.length,
        wordCount,
        headingCount: headings,
        hasImage: !!post.featured_image
      }
    };
  }
}

// Traffic optimization helpers
export function generateSocialShareLinks(post, siteUrl) {
  const key = post.slug || post.id || '';
  const url = encodeURIComponent(`${siteUrl}/post/${key}`);
  const title = encodeURIComponent(toStr(post.title));

  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    twitter: `https://twitter.com/intent/tweet?url=${url}&text=${title}`,
    whatsapp: `https://wa.me/?text=${title}%20${url}`,
    telegram: `https://t.me/share/url?url=${url}&text=${title}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`
  };
}

// IndexNow: Instant indexing (Bing, Yandex). Call only AFTER a post is published.
export async function submitToIndexNow(env, url) {
  if (!env.INDEXNOW_KEY) return { success: false, reason: 'No IndexNow key' };

  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: new URL(env.SITE_URL).hostname,
        key: env.INDEXNOW_KEY,
        urlList: [url]
      })
    });
    return { success: response.ok, status: response.status };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
