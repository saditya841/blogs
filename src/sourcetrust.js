// sourcetrust.js — "is this source worth trusting?" in plain code, ZERO token.
//
// Why: business articles rest on numbers and claims. A random blog, a press release and a
// regulator filing are not the same evidence. This module ranks domains so that:
//   1. official filings/regulators/exchanges are read first,
//   2. financial press comes next,
//   3. Wikipedia/aggregators are context only,
//   4. blogs/social posts are never treated as proof.
//
// It does not decide whether a sentence is true. It decides how much weight a source deserves,
// and it gives the writer/reviewer a clear warning when the only "proof" is low trust.
// Pure functions only: no network, no DB, no AI.

const OFFICIAL = [
  'sebi.gov.in', 'rbi.org.in', 'nseindia.com', 'bseindia.com', 'mca.gov.in', 'amfiindia.com',
  'irdai.gov.in', 'pfrda.org.in', 'nsdl.co.in', 'cdslindia.com', 'data.gov.in', 'mospi.gov.in',
  'censusindia.gov.in', 'startupindia.gov.in', 'worldbank.org', 'imf.org', 'oecd.org',
  'bis.org', 'sec.gov', 'federalreserve.gov', 'ecb.europa.eu', 'bankofengland.co.uk'
];

const FINANCIAL = [
  'economictimes.indiatimes.com', 'livemint.com', 'business-standard.com', 'thehindubusinessline.com',
  'moneycontrol.com', 'financialexpress.com', 'bloomberg.com', 'reuters.com', 'ft.com', 'wsj.com',
  'cnbc.com', 'cnbctv18.com', 'businesstoday.in', 'forbesindia.com', 'fortuneindia.com',
  'vccircle.com', 'theken.com', 'barrons.com', 'marketwatch.com', 'finance.yahoo.com',
  'investors.com', 'morningstar.in', 'valueresearchonline.com'
];

const STARTUP_PRESS = [
  'entrackr.com', 'inc42.com', 'yourstory.com', 'trak.in', 'vccircle.com', 'thebetterindia.com'
];

const GENERAL_PRESS = [
  'thehindu.com', 'indianexpress.com', 'ndtv.com', 'hindustantimes.com', 'timesofindia.indiatimes.com',
  'indiatimes.com', 'telegraphindia.com', 'scroll.in', 'thewire.in', 'deccanherald.com',
  'businessinsider.in', 'bbc.com', 'bbc.co.uk', 'theguardian.com', 'nytimes.com', 'apnews.com',
  'aljazeera.com', 'cnn.com', 'theprint.in', 'news18.com', 'zeenews.india.com', 'firstpost.com'
];

const REFERENCE = [
  'wikipedia.org', 'britannica.com', 'investopedia.com', 'screener.in', 'tickertape.in',
  'companiesmarketcap.com', 'trendlyne.com', 'stockanalysis.com'
];

const BLOG_SOCIAL = [
  'medium.com', 'substack.com', 'quora.com', 'reddit.com', 'linkedin.com', 'youtube.com',
  'youtu.be', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'threads.net',
  'blogspot.com', 'wordpress.com', 'tumblr.com', 'pinterest.com', 'telegram.me', 't.me',
  'whatsapp.com', 'valuepickr.com', 'tradingview.com'
];

const AGGREGATOR = [
  'news.google.com', 'google.com', 'bing.com', 'msn.com', 'yahoo.com', 'flipboard.com',
  'news18.com', 'dailyhunt.in'
];

const TIERS = [
  { kind: 'official', label: 'official/regulator', score: 100, note: 'sarkari/regulator/exchange filing — strongest evidence', domains: OFFICIAL },
  { kind: 'financial', label: 'financial press', score: 85, note: 'business newsroom — good for numbers, still check the original filing', domains: FINANCIAL },
  { kind: 'startup', label: 'startup press', score: 62, note: 'startup coverage — useful for funding/plans, often repeats company claims', domains: STARTUP_PRESS },
  { kind: 'general', label: 'general press', score: 70, note: 'reputed general newsroom — good for events/context', domains: GENERAL_PRESS },
  { kind: 'reference', label: 'reference', score: 55, note: 'encyclopedia/data page — context only, never the only proof for a number', domains: REFERENCE },
  { kind: 'blog', label: 'blog/social', score: 20, note: 'blog/social/forum — opinion, not evidence', domains: BLOG_SOCIAL },
  { kind: 'aggregator', label: 'aggregator', score: 35, note: 'aggregator/redirect — find the original publisher', domains: AGGREGATOR }
];

const COMPANY_HINT = /(^|\.)investors?\.|(^|\.)ir\.|\/investors?\/|annual[-_ ]?report|investor[-_ ]?relations/i;

const LABEL = {
  official: 'official/regulator', financial: 'financial press', startup: 'startup press',
  general: 'general press', reference: 'reference', blog: 'blog/social',
  aggregator: 'aggregator', company: 'company/IR', unknown: 'unknown site'
};

export function domainOf(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

const matches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// source = { url, title, source } or just a URL string.
// Returns { host, score, kind, label, note }. Unknown never becomes "fake"; it becomes "unverified".
export function sourceTrust(source) {
  const s = typeof source === 'string' ? { url: source } : (source || {});
  const host = domainOf(s.url);
  if (!host) {
    return { host: '', score: 35, kind: 'unknown', label: LABEL.unknown, note: 'link nahi hai — verify nahi ho sakta' };
  }

  for (const tier of TIERS) {
    if (tier.domains.some((d) => matches(host, d))) {
      return { host, score: tier.score, kind: tier.kind, label: tier.label, note: tier.note };
    }
  }

  // Government/exchange domains that are not in the short list.
  if (/(^|\.)(gov|gov\.in|nic\.in|ac\.in|edu|edu\.in)$/.test(host)) {
    return { host, score: 95, kind: 'official', label: 'official/academic', note: 'sarkari/academic domain — strong, but check the exact page' };
  }

  // Company annual report / investor-relations page: primary evidence, but self-interested.
  const hay = `${host}${s.url || ''} ${s.title || ''} ${s.source || ''}`;
  if (COMPANY_HINT.test(hay) || /\b(ltd|limited|inc|corp|plc)\b/i.test(String(s.source || s.title || ''))) {
    return { host, score: 72, kind: 'company', label: LABEL.company, note: 'company ka apna page — primary, par apni hi kahani; independent source se cross-check karo' };
  }

  return { host, score: 40, kind: 'unknown', label: LABEL.unknown, note: 'pehchana hua newsroom nahi — proof ke liye akela mat use karo' };
}

export function annotateSources(sources) {
  return (Array.isArray(sources) ? sources : []).map((s) => ({ ...s, trust: sourceTrust(s) }));
}

// Stable sort: best sources stay first, but equal-ranked sources keep their original order.
export function sortByTrust(sources) {
  return annotateSources(sources)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.trust.score - a.s.trust.score) || (a.i - b.i))
    .map((x) => x.s);
}

// Pure summary used by prompts, check_json and the admin review page.
export function trustSummary(sources) {
  const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
  const items = list.map(sourceTrust);
  const counts = { official: 0, financial: 0, startup: 0, general: 0, reference: 0, blog: 0, aggregator: 0, company: 0, unknown: 0 };
  for (const t of items) counts[t.kind] = (counts[t.kind] || 0) + 1;
  const hosts = [...new Set(items.map((t) => t.host).filter(Boolean))];
  const score = items.length ? Math.round(items.reduce((a, t) => a + t.score, 0) / items.length) : 0;
  const strongest = items.slice().sort((a, b) => b.score - a.score)[0] || null;
  const weakest = items.slice().sort((a, b) => a.score - b.score)[0] || null;
  const credible = counts.official + counts.financial + counts.general + counts.company;
  const weak = counts.blog + counts.aggregator + counts.unknown;
  let level = 'weak';
  if (!items.length) level = 'none';
  else if ((counts.official > 0 || counts.financial > 0) && credible >= 2 && weak <= credible && score >= 65) level = 'strong';
  else if (credible >= 1 && score >= 50) level = 'ok';
  else if (score >= 65) level = 'ok';
  return {
    count: items.length,
    independent: hosts.length,
    score,
    level,
    counts,
    strongest: strongest ? { host: strongest.host, score: strongest.score, kind: strongest.kind } : null,
    weakest: weakest ? { host: weakest.host, score: weakest.score, kind: weakest.kind } : null
  };
}

export function trustText(summary) {
  if (!summary || !summary.count) return 'koi source nahi — trust 0/100';
  const order = ['official', 'financial', 'company', 'general', 'startup', 'reference', 'blog', 'aggregator', 'unknown'];
  const parts = order.filter((k) => summary.counts && summary.counts[k]).map((k) => `${summary.counts[k]} ${LABEL[k]}`);
  return `${summary.count} source${summary.count === 1 ? '' : 's'} (${parts.join(', ')}); trust ${summary.score}/100 (${summary.level})`;
}

export function trustMeta(summary) {
  if (!summary) return null;
  return {
    count: summary.count,
    independent: summary.independent,
    score: summary.score,
    level: summary.level,
    counts: { ...summary.counts },
    strongest: summary.strongest,
    weakest: summary.weakest,
    text: trustText(summary)
  };
}

export const SOURCE_TIERS = TIERS.map((t) => ({ kind: t.kind, label: t.label, score: t.score, domains: [...t.domains] }));
