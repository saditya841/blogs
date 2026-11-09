// Step 2: Google Trends (India) -> topics -> research from 3+ independent outlets. No API keys.
import { looksInjected } from './verify.js';
import { buildBrief, targetLang } from './preread.js';
import { classify } from './playbook.js';

export { looksInjected };

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; VirallBot/1.0; +https://virall.in/about)', 'Accept-Language': 'hi-IN,hi;q=0.9,en-IN;q=0.8,en;q=0.7' };
const now = () => Math.floor(Date.now() / 1000);

// Topics we never write about automatically (policy safety)
const BLOCK = /\b(porn|xxx|sex|nude|escort|casino|betting|satta|matka|lottery|dream11|rummy|suicide|murder|rape|killed|death toll|cure|miracle|loan app)\b/i;

// Navigational / low-value searches (TV channels, live streams, logins, stats pages, previews...) - never worth an article
export const JUNK = /\b(live|livestream|streaming|channel|login|log in|apk|download|watch online|full movie|webcam|tv|rate today|price today|aaj ka|bhav|gold rate|silver rate|petrol price|diesel price|standings|points table|fixtures?|schedule|prediction|preview|lineups?|probable xi)\b/i;
const decode = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (s, n) => { const m = s.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`)); return m ? decode(m[1]) : ''; };
const epoch = (s) => { const t = Date.parse(String(s || '')); return Number.isFinite(t) ? Math.floor(t / 1000) : 0; };
const gdeltEpoch = (s) => { const m = String(s || '').match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000) : 0; };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function parseTrends(xml) {
  const out = [];
  for (const it of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = it[1], query = tag(b, 'title');
    if (!query) continue;
    const news = [...b.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map((n) => ({
      title: tag(n[1], 'ht:news_item_title'), snippet: tag(n[1], 'ht:news_item_snippet'),
      url: tag(n[1], 'ht:news_item_url'), source: tag(n[1], 'ht:news_item_source'),
    })).filter((n) => n.url);
    out.push({ query, traffic: tag(b, 'ht:approx_traffic'), news });
  }
  return out;
}

export function parseNewsRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((it) => ({
    title: tag(it[1], 'title'), url: tag(it[1], 'link'), source: tag(it[1], 'source'), date: epoch(tag(it[1], 'pubDate')),
    snippet: decode(tag(it[1], 'description').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 300),
  })).filter((n) => n.url);
}

// One retry for 5xx / 429 only. A timeout is NOT retried: waiting twice for a dead provider is the
// "time pass" that made the admin click feel stuck. Providers run in parallel, so fast failures are fine.
async function get(url, ms = 8000, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(ms) });
      if (r.ok) return r;
      last = new Error(`${r.status} ${url}`);
      if (r.status !== 429 && r.status < 500) throw last;
    } catch (e) {
      last = e;
      const name = e && e.name;
      if (name === 'TimeoutError' || name === 'AbortError') break;
      if (e && /^(4\d\d) /.test(e.message || '')) break;
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 500));
  }
  throw last;
}

// Pull readable paragraph text out of an article page
export async function articleText(url, ms = 8000) {
  try {
    const r = await get(url, ms);
    if (!(r.headers.get('content-type') || '').includes('html')) return '';
    let h = (await r.text()).slice(0, 400000);
    h = h.replace(/<(script|style|nav|footer|header|aside|form|noscript)[\s\S]*?<\/\1>/gi, ' ');
    const ps = [...h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()).filter((t) => t.length > 70);
    return ps.join('\n').slice(0, 2500);
  } catch { return ''; }
}

// Topic source with fallbacks: Trends RSS (new) -> Trends RSS (old URL) -> Google News India top headlines
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchTrends(geo = 'IN') {
  // All three sources at once. Before, a dead Google Trends endpoint cost 8-16s before the
  // news fallback even started - that is the "click par kuch nahi hua" feeling.
  const tries = [
    ['trends', `https://trends.google.com/trending/rss?geo=${geo}`, (t) => parseTrends(t)],
    ['trends-old', `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`, (t) => parseTrends(t)],
    ['google-news-top', `https://news.google.com/rss?hl=en-IN&gl=${geo}&ceid=${geo}:en`, (t) => parseNewsRss(t).map((n) => {
      const i = n.title.lastIndexOf(' - ');
      const q = (i > 20 ? n.title.slice(0, i) : n.title).slice(0, 90);
      return { query: q, traffic: 'news', news: [{ title: n.title, snippet: n.snippet, url: n.url, source: n.source, date: n.date || 0 }] };
    })],
  ];
  const settled = new Array(tries.length).fill(null);
  let pending = tries.length, anySuccess = false, wakeFirst, wakeAll;
  const firstDone = new Promise((r) => (wakeFirst = r));
  const allDone = new Promise((r) => (wakeAll = r));
  tries.forEach(async ([via, url, parse], i) => {
    try {
      const items = parse(await (await get(url)).text());
      if (!items.length) throw new Error('empty');
      settled[i] = { via, items };
    } catch (e) {
      settled[i] = { error: String((e && e.message) || e).slice(0, 40) };
    }
    if (!anySuccess && settled[i].items) { anySuccess = true; wakeFirst(); }
    if (--pending === 0) wakeAll();
  });
  await Promise.race([firstDone, allDone]);
  // If a lower-priority source answered but a better one is still in flight, give it a short
  // grace period. Never wait for the full timeout when we already have usable topics.
  const best = settled.findIndex((s) => s && s.items);
  const higherPending = best > 0 && settled.slice(0, best).some((s) => !s);
  if (best >= 0 && higherPending) await Promise.race([allDone, delay(1200)]);
  const hit = settled.find((s) => s && s.items);
  if (hit) return { items: hit.items, via: hit.via, errs: settled.map((s, i) => (s && s.error ? `${tries[i][0]}: ${s.error}` : null)).filter(Boolean) };
  throw new Error('Topic source nahi mila (' + settled.map((s, i) => `${tries[i][0]}: ${(s && s.error) || 'pending'}`).join('; ') + ')');
}

// ---- extra news providers (all keyless). They return direct article URLs so we can read the text ----
const enc = encodeURIComponent;
async function bingNews(q) {
  const r = await get(`https://www.bing.com/news/search?q=${enc(q)}&format=rss&mkt=en-IN`);
  return [...(await r.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)].map((it) => {
    const link = tag(it[1], 'link'); let real = link;
    try { real = new URL(link).searchParams.get('url') || link; } catch {}
    return { title: tag(it[1], 'title'), url: real, date: epoch(tag(it[1], 'pubDate')), source: tag(it[1], 'News:Source'), snippet: tag(it[1], 'description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300) };
  }).filter((n) => n.url && !/bing\.com/.test(host(n.url)));
}
async function gdeltNews(q) {
  const r = await get(`https://api.gdeltproject.org/api/v2/doc/doc?query=${enc(q + ' sourcecountry:IN')}&mode=artlist&maxrecords=10&format=json&timespan=3d`, 18000);
  const j = JSON.parse(await r.text());
  return (j.articles || []).map((a) => ({ title: a.title, url: a.url, source: a.domain, snippet: '', date: gdeltEpoch(a.seendate) }));
}
async function googleNews(q) {
  const r = await get(`https://news.google.com/rss/search?q=${enc(q)}&hl=hi&gl=IN&ceid=IN:hi`, 15000);
  return parseNewsRss(await r.text()).slice(0, 10);
}

// Only Hindi/English topics (skip other Indian scripts), highest traffic first
const OTHER_SCRIPT = /[\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0600-\u06FF]/;
const trafficNum = (t) => Number(String(t).replace(/[^0-9]/g, '')) || 0;

// Collect new topics (respects daily limit, dedupes, skips blocked topics)
export async function collectTopics(env) {
  const limit = Number(env.DAILY_TOPIC_LIMIT || 6);
  const since = now() - 86400;
  // topics that failed research ('thin') do not use up the daily limit
  const have = (await env.DB.prepare("SELECT COUNT(*) c FROM topics WHERE created_at>? AND status IN ('new','ready','used')").bind(since).first()).c;
  if (have >= limit) return { added: 0, note: 'daily limit reached' };
  const ft = await fetchTrends(env.TRENDS_GEO || 'IN');
  const trends = ft.items.sort((a, b) => trafficNum(b.traffic) - trafficNum(a.traffic));
  let added = 0;
  for (const t of trends) {
    if (have + added >= limit) break;
    if (OTHER_SCRIPT.test(t.query) || JUNK.test(t.query)) continue;
    if (BLOCK.test(t.query) || t.news.some((n) => BLOCK.test(n.title))) continue;
    const r = await env.DB.prepare('INSERT OR IGNORE INTO topics(query,traffic,status,research,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .bind(t.query, t.traffic, 'new', JSON.stringify({ trendNews: t.news }), now(), now()).run();
    if (r.meta.changes) added++;
  }
  return { added, total: trends.length, via: ft.via, errs: ft.errs };
}

// Hard ceiling for one phase. A click must always end with a visible result; a slow provider
// is skipped instead of making the admin stare at a spinner.
const within = (p, ms) => Promise.race([
  p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })),
  new Promise((r) => setTimeout(() => r({ ok: false, e: new Error(`timeout ${Math.round(ms / 1000)}s`) }), ms)),
]);

// Research one topic: gather >=3 independent outlets with usable text/snippets
export async function researchTopic(env, topic) {
  let old = {}; try { old = JSON.parse(topic.research || '{}'); } catch {}
  const seed = old.trendNews || [];
  const pool = [...seed];
  // Run providers together: one slow provider no longer blocks the other two.
  const providers = [['bing', bingNews], ['gdelt', gdeltNews], ['google', googleNews]];
  const errs = [];
  const settled = await Promise.all(providers.map(([, fn]) => within(fn(topic.query), 10000)));
  settled.forEach((r, i) => {
    if (r.ok) pool.push(...r.v);
    else errs.push(`${providers[i][0]}: ${String((r.e && r.e.message) || r.e).slice(0, 60)}`);
  });
  const seen = new Set(), pick = [];
  for (const n of pool) {
    const key = (n.source || host(n.url)).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key); pick.push({ ...n, source: n.source || host(n.url) });
    if (pick.length >= 8) break;
  }
  const got = await Promise.all(pick.map(async (n) => {
    const direct = host(n.url) && !host(n.url).endsWith('news.google.com');
    const text = direct ? await articleText(n.url, 6000) : '';
    return (text.length > 300 || (n.snippet && n.snippet.length > 60)) ? { source: n.source, title: n.title, url: n.url, snippet: n.snippet, text, date: n.date || 0 } : null;
  }));
  const sources = got.filter(Boolean).filter((s) => { const bad = looksInjected(`${s.title} ${s.snippet} ${s.text}`); if (bad) errs.push('source hata di (AI ko hukm dene wala text): ' + s.source); return !bad; }).slice(0, 8);

  // ZERO-token pre-read: decide here whether this source set is worth spending AI tokens on.
  // buildBrief also drops foreign-language, unrelated, duplicate and injection sources.
  const p = classify(topic.query);
  const brief = buildBrief(topic.query, sources, {
    lang: targetLang(env),
    nowSec: now(),
    minSources: p.minSources || 3,
    maxAgeDays: p.maxAgeDays || 7,
    needDates: !!p.needDates,
    label: p.label
  });
  const status = brief.ok ? 'ready' : 'thin';
  const research = {
    sources: brief.sources,
    brief,
    dropped: brief.dropped,
    researched_at: now(),
    attempts: (old.attempts || 0) + 1,
    errors: errs,
    tried: pick.length
  };
  await env.DB.prepare('UPDATE topics SET status=?,research=?,source_count=?,updated_at=? WHERE id=?')
    .bind(status, JSON.stringify(research), brief.sources.length, now(), topic.id).run();
  return { id: topic.id, query: topic.query, status, sources: brief.sources.length, brief, reason: brief.reason || '' };
}

export async function researchPending(env, max = 2) {
  let { results } = await env.DB.prepare("SELECT * FROM topics WHERE status='new' ORDER BY id LIMIT ?").bind(max).all();
  if (results.length < max) {
    // retry 'thin' topics (max 2 attempts) from the last 2 days
    const th = (await env.DB.prepare("SELECT * FROM topics WHERE status='thin' AND created_at>? ORDER BY id DESC LIMIT 6").bind(now() - 172800).all()).results
      .filter((t) => { try { return (JSON.parse(t.research || '{}').attempts || 0) < 2; } catch { return true; } });
    results = [...results, ...th].slice(0, max);
  }
  // Research together, with no artificial sleep. Each topic is isolated: one provider failure
  // never hides the result of the other topic, and this function never throws.
  const settled = await Promise.allSettled(results.map((t) => researchTopic(env, t)));
  return settled.map((r, i) => {
    const t = results[i];
    if (r.status === 'fulfilled') return { id: t.id, query: t.query, ...r.value };
    const reason = String((r.reason && r.reason.message) || r.reason || 'research fail').slice(0, 300);
    return { id: t.id, query: t.query, status: 'error', sources: 0, brief: null, reason, error: true };
  });
}
