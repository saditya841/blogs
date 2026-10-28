// SEO & Traffic Optimization Module
// Maximize reach on Google Discover, News, and Social Media

export class SEOOptimizer {
  constructor(env) {
    this.env = env;
  }

  // Generate SEO-optimized metadata
  generateSEOMetadata(post) {
    return {
      // Primary SEO
      title: this.optimizeTitle(post.title),
      metaDescription: this.generateMetaDescription(post),
      keywords: this.extractKeywords(post),

      // Open Graph (Facebook, LinkedIn)
      ogTitle: this.optimizeOGTitle(post.title),
      ogDescription: this.generateOGDescription(post),
      ogImage: post.thumbnail_image || post.featured_image,
      ogType: 'article',
      ogUrl: `${this.env.SITE_URL}/post/${post.slug}`,

      // Twitter Card
      twitterCard: 'summary_large_image',
      twitterTitle: this.optimizeTitle(post.title),
      twitterDescription: this.generateMetaDescription(post),
      twitterImage: post.thumbnail_image || post.featured_image,

      // Schema.org (Google Rich Snippets)
      schema: this.generateArticleSchema(post),

      // Additional SEO
      canonicalUrl: `${this.env.SITE_URL}/post/${post.slug}`,
      robots: 'index, follow',
      author: this.env.AUTHOR_NAME || 'Virall Desk',
      publishDate: new Date(post.created_at * 1000).toISOString(),
      modifiedDate: new Date(post.updated_at * 1000).toISOString()
    };
  }

  // Optimize title for SEO (60 chars max for Google)
  optimizeTitle(title) {
    if (title.length <= 60) return title;

    // Trim to 57 chars and add ellipsis
    return title.slice(0, 57) + '...';
  }

  // Optimize for Open Graph (longer allowed)
  optimizeOGTitle(title) {
    if (title.length <= 90) return title;
    return title.slice(0, 87) + '...';
  }

  // Generate compelling meta description (155-160 chars)
  generateMetaDescription(post) {
    // Use summary if available
    if (post.summary && post.summary.length >= 100 && post.summary.length <= 160) {
      return post.summary;
    }

    // Extract first paragraph from body
    const firstPara = post.body.split('\n\n')[0].replace(/##/g, '').trim();

    if (firstPara.length <= 160) return firstPara;

    // Trim to 157 chars and add ellipsis
    return firstPara.slice(0, 157) + '...';
  }

  // Generate OG description (longer allowed, 200 chars)
  generateOGDescription(post) {
    if (post.summary) return post.summary;

    const firstPara = post.body.split('\n\n')[0].replace(/##/g, '').trim();
    if (firstPara.length <= 200) return firstPara;
    return firstPara.slice(0, 197) + '...';
  }

  // Extract keywords from content
  extractKeywords(post) {
    const title = post.title.toLowerCase();
    const body = post.body.toLowerCase();
    const text = `${title} ${body}`;

    // Common Hindi/English stop words to ignore
    const stopWords = new Set([
      'और', 'का', 'की', 'को', 'में', 'से', 'है', 'हैं', 'था', 'थे', 'ने', 'पर', 'यह', 'वह',
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'
    ]);

    // Extract words (3+ chars)
    const words = text.match(/[a-zA-Zऀ-ॿ]{3,}/g) || [];

    // Count frequency
    const freq = {};
    words.forEach(word => {
      if (!stopWords.has(word)) {
        freq[word] = (freq[word] || 0) + 1;
      }
    });

    // Get top 10 keywords
    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    // Add category and tags
    const keywords = [post.category, ...post.tags.split(','), ...sorted];

    return [...new Set(keywords)].join(', ');
  }

  // Generate Article Schema (Google Rich Snippets)
  generateArticleSchema(post) {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      'headline': post.title,
      'description': this.generateMetaDescription(post),
      'image': [
        post.featured_image,
        post.thumbnail_image
      ].filter(Boolean),
      'datePublished': new Date(post.created_at * 1000).toISOString(),
      'dateModified': new Date(post.updated_at * 1000).toISOString(),
      'author': {
        '@type': 'Organization',
        'name': this.env.AUTHOR_NAME || 'Virall Desk',
        'url': this.env.SITE_URL
      },
      'publisher': {
        '@type': 'Organization',
        'name': this.env.SITE_NAME || 'Virall',
        'logo': {
          '@type': 'ImageObject',
          'url': `${this.env.SITE_URL}/logo.png`
        }
      },
      'mainEntityOfPage': {
        '@type': 'WebPage',
        '@id': `${this.env.SITE_URL}/post/${post.slug}`
      }
    };

    return JSON.stringify(schema);
  }

  // Generate complete HTML meta tags
  generateMetaTags(post) {
    const meta = this.generateSEOMetadata(post);

    return `
    <!-- Primary Meta Tags -->
    <title>${meta.title}</title>
    <meta name="title" content="${meta.title}">
    <meta name="description" content="${meta.metaDescription}">
    <meta name="keywords" content="${meta.keywords}">
    <meta name="author" content="${meta.author}">
    <meta name="robots" content="${meta.robots}">
    <link rel="canonical" href="${meta.canonicalUrl}">

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="${meta.ogType}">
    <meta property="og:url" content="${meta.ogUrl}">
    <meta property="og:title" content="${meta.ogTitle}">
    <meta property="og:description" content="${meta.ogDescription}">
    <meta property="og:image" content="${meta.ogImage}">
    <meta property="og:site_name" content="${this.env.SITE_NAME || 'Virall'}">
    <meta property="article:published_time" content="${meta.publishDate}">
    <meta property="article:modified_time" content="${meta.modifiedDate}">
    <meta property="article:author" content="${meta.author}">
    <meta property="article:section" content="${post.category}">
    <meta property="article:tag" content="${post.tags}">

    <!-- Twitter -->
    <meta property="twitter:card" content="${meta.twitterCard}">
    <meta property="twitter:url" content="${meta.ogUrl}">
    <meta property="twitter:title" content="${meta.twitterTitle}">
    <meta property="twitter:description" content="${meta.twitterDescription}">
    <meta property="twitter:image" content="${meta.twitterImage}">

    <!-- Google News -->
    <meta name="news_keywords" content="${meta.keywords}">

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

    // Title length check
    if (post.title.length < 30) {
      issues.push('Title too short (< 30 chars)');
      suggestions.push('Add more descriptive words to title');
    }
    if (post.title.length > 70) {
      issues.push('Title too long (> 70 chars) - will be truncated in search');
    }

    // Meta description check
    const metaDesc = this.generateMetaDescription(post);
    if (metaDesc.length < 120) {
      issues.push('Meta description too short');
    }

    // Image check
    if (!post.featured_image) {
      issues.push('No featured image - reduces social media engagement');
      suggestions.push('Add a featured image for better visibility');
    }

    // Content length check
    const wordCount = post.body.split(/\s+/).length;
    if (wordCount < 300) {
      issues.push(`Content too short (${wordCount} words) - aim for 500+`);
      suggestions.push('Add more details, examples, or context');
    }

    // Heading structure check
    const headings = (post.body.match(/^##\s/gm) || []).length;
    if (headings < 2) {
      suggestions.push('Add more headings (##) to improve readability');
    }

    // Keywords in title
    const titleWords = new Set(post.title.toLowerCase().split(/\s+/));
    const bodyWords = new Set(post.body.toLowerCase().split(/\s+/));
    const overlap = [...titleWords].filter(w => bodyWords.has(w)).length;

    if (overlap / titleWords.size < 0.5) {
      suggestions.push('Use more title keywords in the content');
    }

    return {
      score: Math.max(0, 100 - (issues.length * 15) - (suggestions.length * 5)),
      issues,
      suggestions,
      stats: {
        titleLength: post.title.length,
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
  const url = encodeURIComponent(`${siteUrl}/post/${post.slug}`);
  const title = encodeURIComponent(post.title);

  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    twitter: `https://twitter.com/intent/tweet?url=${url}&text=${title}`,
    whatsapp: `https://wa.me/?text=${title}%20${url}`,
    telegram: `https://t.me/share/url?url=${url}&text=${title}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`
  };
}

// IndexNow: Instant indexing (Bing, Yandex)
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

    return {
      success: response.ok,
      status: response.status
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
