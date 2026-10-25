// Publish checklist (pure function). errors = block "Approve", warnings = shown only.
// Used by the admin review page, the approve buttons and AI auto-publish.
export const CATS = ['India', 'Odisha', 'Business', 'Technology', 'Sports', 'Entertainment', 'Education', 'Jobs', 'Politics', 'World'];

const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// p = a row of the posts table.
// o = { check: research.check of the topic (or null), strict: true for auto-publish, freshDays, nowSec }
export function validatePost(p, o = {}) {
  const errors = [], warnings = [];
  const E = (code, msg) => errors.push({ code, msg }), W = (code, msg) => warnings.push({ code, msg });
  const now = o.nowSec || Math.floor(Date.now() / 1000), fresh = (o.freshDays || 3) * 86400;
  const title = String(p.title || '').trim(), summary = String(p.summary || '').trim(), body = String(p.body || '');

  if (!title) E('title', 'Title khali hai');
  else if (title.length > 120) E('title_long', `Title bahut lamba (${title.length} akshar)`);
  else if (title.length > 90) W('title_long', `Title lamba hai (${title.length} akshar), 90 tak rakho`);

  if (!summary) E('summary', 'Summary / meta description khali hai');
  else {
    if (summary.length < 40) W('summary_short', `Summary chhoti hai (${summary.length} akshar)`);
    if (summary.length > 160) W('summary_long', `Summary ${summary.length} akshar ki hai, Google 160 par kaat dega`);
    if (summary === title) W('summary_same', 'Summary aur title ek jaise hain');
  }

  const wc = p.word_count || words(body);
  if (!body.trim()) E('body', 'Body khali hai');
  else if (wc < 150) E('body_short', `Lekh bahut chhota hai (${wc} shabd, kam se kam 150)`);
  else if (wc >= 350 && (body.match(/^## /gm) || []).length < 2) W('headings', 'Lambe lekh mein 2 se kam "## " headings hain');

  if ((p.lang || 'hi') === 'hi' && body) { // a Hindi post whose body is mostly Latin letters = the AI answered in the wrong language
    const letters = (body.match(/\p{L}/gu) || []).length, dev = (body.match(/[\u0900-\u097F]/g) || []).length;
    if (letters > 50 && dev / letters < 0.5) W('language', 'Post Hindi hai par lekh zyadatar Hindi mein nahi likha hai');
  }

  let srcs = []; try { srcs = JSON.parse(p.sources || '[]'); } catch {}
  const hosts = new Set((Array.isArray(srcs) ? srcs : []).map((s) => hostOf(s && s.url ? s.url : s)).filter(Boolean));
  if (!hosts.size) E('sources', 'Koi source link nahi hai');
  else if (hosts.size < 3) W('sources_few', `Sirf ${hosts.size} alag source hai (3 chahiye)`);

  if (!p.category) W('category', 'Category nahi hai');
  else if (!CATS.includes(p.category)) W('category', `Category "${p.category}" list mein nahi hai`);
  if (String(p.tags || '').split(',').filter((x) => x.trim()).length < 3) W('tags', '3 se kam tags hain');

  if (!p.image_url) W('image', 'Image nahi hai (Google Discover / share preview ke liye chahiye)');
  else {
    if (!String(p.image_url).startsWith('https://')) E('image_https', 'Image URL https:// se shuru hona chahiye');
    if (!p.image_credit) W('image_credit', 'Image credit khali hai');
  }
  if (!p.slug || /^(post|news)(-[a-z0-9]{4,5})?$/.test(p.slug) || String(p.slug).length < 8) W('slug', 'URL slug saaf nahi hai (jaise post-xxxxx)');

  const c = o.check;
  if (c) {
    if (c.verified !== true) E('not_verified', 'Fact-check pass nahi hua');
    if (c.coverageLow) E('coverage', 'Fact-check poora nahi hua (checker ne kam claims diye): post khud padhkar dekho');
    if ((c.unsupportedCount || 0) > 0) E('unsupported', `${c.unsupportedCount} claims ka sabut sources mein nahi`);
    if (c.newest_source && now - c.newest_source > fresh) E('stale', `Sabse nayi source ${Math.round((now - c.newest_source) / 86400)} din purani hai`);
    else if (!c.newest_source) W('no_dates', 'Sources ki tareekh pata nahi: khabar taaza hai ya purani, khud dekh lo');
  } else if (o.strict) E('no_check', 'Is post ka fact-check record nahi mila (auto-publish nahi hoga)');
  else W('no_check', 'Is post ka fact-check record nahi mila (manual draft?). Khud jaanch lo.');

  return { ok: errors.length === 0, errors, warnings };
}
