// Step 4: image (AI thumbnail first; fallback licensed photo -> YouTube thumbnail) + video (YouTube) for a post. Never throws: a post never fails because of media.
import { generateSVGThumbnail } from './viral-thumbnail-generator.js';
const UA = { 'User-Agent': 'VirallBot/1.0 (https://virall.in; pcssupp77@gmail.com)', Accept: 'application/json' };
const now = () => Math.floor(Date.now() / 1000);
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

async function getJson(url, ms = 9000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// ---- 1) free licensed photo from Wikimedia Commons (no key). Only CC BY / CC BY-SA / CC0 / public domain. ----
// Relevance rule (fixes misleading photos): a short query like "DAC" or "Free Fire" is too ambiguous for a photo
// library, so a real photo is used only when the file TITLE itself contains at least 2 topic words and the title +
// description cover at least 60% of them. Otherwise we return null and an AI illustration is used instead.
export const MIN_PHOTO_WORDS = 3;
export const photoRelevant = (query, title, description = '') => {
  const qw = [...new Set(words(query))];
  if (qw.length < MIN_PHOTO_WORDS) return false;
  const t = String(title || '').toLowerCase();
  const all = `${t} ${String(description || '').toLowerCase()}`;
  const inTitle = qw.filter((w) => t.includes(w)).length;
  const inAll = qw.filter((w) => all.includes(w)).length;
  return inTitle >= 2 && inAll / qw.length >= 0.6;
};
export async function findPhoto(query) {
  const qw = [...new Set(words(query))];
  if (qw.length < MIN_PHOTO_WORDS) return null;
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=20'
    + '&gsrsearch=' + encodeURIComponent(query + ' filetype:bitmap')
    + '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1200';
  const j = await getJson(url);
  const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  for (const p of pages) {
    const ii = p.imageinfo && p.imageinfo[0];
    if (!ii) continue;
    if (!/^image\/(jpeg|png)$/.test(ii.mime || '') || (ii.width || 0) < 900) continue;
    if (/logo|flag of|map of|screenshot|diagram|coat of arms|poster|stamp/i.test(p.title || '')) continue;
    const md = ii.extmetadata || {};
    const lic = strip(md.LicenseShortName && md.LicenseShortName.value);
    if (!/^(CC BY|CC BY-SA|CC0|Public domain|PD)/i.test(lic) || /\b(NC|ND)\b/i.test(lic)) continue;
    const desc = strip(md.ImageDescription && md.ImageDescription.value);
    if (!photoRelevant(query, p.title, desc)) continue; // must really be about the topic
    const artist = strip(md.Artist && md.Artist.value).slice(0, 60) || 'Unknown';
    // drop Wikimedia's tracking query string: the plain thumb URL is faster and does not expire
    return { url: String(ii.thumburl || ii.url).split('?')[0], credit: `${artist} / ${lic} / Wikimedia Commons` };
  }
  return null;
}

// ---- 1b) FREE STOCK PHOTO: Pexels (free key: https://www.pexels.com/api/ ; secret PEXELS_API_KEY). Key na ho to ye step chhoot jata hai. ----
// Safety: khabar ke saath kisi ajnabi insaan ki stock photo galat lagti hai (jaise crime/rajniti ki khabar), isliye jin photos ke alt text mein insaan hai wo skip.
const CAT_Q = {
  Sports: 'sports stadium floodlights', India: 'india city skyline sunset', Odisha: 'odisha temple coast', Business: 'stock market chart city skyline',
  Technology: 'technology circuit board neon', Entertainment: 'cinema theatre stage lights', Education: 'books classroom desk', Jobs: 'modern office building',
  Politics: 'parliament building flags', World: 'earth globe night lights',
};
const DEFAULT_Q = 'news studio background';
const PEOPLE = /\b(man|men|woman|women|person|people|boy|girl|child|children|kid|kids|portrait|face|couple|family|worker|workers|student|students|crowd|businessman|businesswoman|lady|guy|player|players|athlete)\b/i;
export const genericQuery = (category) => CAT_Q[category] || DEFAULT_Q;
// Latin shabd (jaise "ipad mini") ho to wahi, warna category ki English query (Pexels Hindi nahi samajhta).
// One Latin word ("DAC") is too ambiguous for stock search -> use the category image instead.
export const stockQuery = (query, category) => {
  const latin = String(query || '').match(/[A-Za-z]{3,}/g) || [];
  return latin.length >= 2 ? latin.slice(0, 4).join(' ') : genericQuery(category);
};
export async function findPexels(env, query, category) {
  if (!env || !env.PEXELS_API_KEY) return null;
  const q = stockQuery(query, category);
  const generic = q === genericQuery(category);
  const url = 'https://api.pexels.com/v1/search?per_page=10&orientation=landscape&size=large&query=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { ...UA, Authorization: env.PEXELS_API_KEY }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  const qw = words(q);
  for (const p of j.photos || []) {
    const alt = String(p.alt || '');
    if (!alt || PEOPLE.test(alt)) continue;                       // alt nahi ya insaan = skip
    if (!generic) {
      const hits = qw.filter((w) => alt.toLowerCase().includes(w)).length;
      if (!qw.length || hits / qw.length < 0.6) continue;         // photo sach mein usi ke baare mein ho
    }
    const url2 = p.src && (p.src.large2x || p.src.large);
    if (url2) return { url: url2, credit: `${String(p.photographer || 'Pexels').slice(0, 60)} / Pexels` };
  }
  return null;
}

// ---- 2) AI THUMBNAIL (Workers AI flux, no key). Viral-thumbnail look: vivid, high contrast, empty space on the left for the headline.
// The AI draws only the background (it cannot write Hindi text); the website adds the headline + badge on top (see thumb() in index.js).
// Never real people or faces. Stored in D1, served at /img/<id>.jpg ----
const SCENES = {
  Sports: 'a dramatic sports stadium at night under bright floodlights, a ball flying in motion, roaring crowd silhouettes',
  India: 'an iconic Indian landmark skyline at golden hour with a dramatic glowing sky',
  Odisha: 'the Odisha coastline with a temple silhouette at sunrise, dramatic glowing sky',
  Business: 'glowing stock market charts over a city skyline, rising arrows, dynamic energy',
  Technology: 'futuristic glowing circuits and devices, neon blue and purple light',
  Entertainment: 'cinema spotlights, stage lights and confetti, red carpet energy',
  Education: 'books, a graduation cap and bright rays of light, students in silhouette',
  Jobs: 'modern office towers with a rising arrow and handshake silhouette, bright light',
  Politics: 'a grand parliament building with waving flags and a crowd in silhouette, dramatic sky',
  World: 'a glowing globe with bright connection lines across continents, dramatic light',
};
const STYLE = 'YouTube thumbnail style, ultra vibrant saturated colors, very high contrast, cinematic dramatic lighting, one strong focal subject on the right, empty dark space on the left for a headline, 16:9. No text, no letters, no numbers, no logos, no watermark, no real people, no recognisable faces.';
export const thumbPrompt = (subject, category) => {
  const sub = String(subject || '').replace(/["']/g, '').slice(0, 80);
  return `${SCENES[category] || 'a dramatic breaking-news scene with bright studio lights and bold colors'}${sub ? `. Theme: ${sub}` : ''}. ${STYLE}`;
};
// short punchy headline for the thumbnail: the part before ":" / "|" / " - ", max 7 words
export const makeHook = (title, max = 7) => {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  const first = t.split(/\s*[:|–—]\s*|\s+-\s+/)[0].trim();
  if (first.split(' ').length >= 3) t = first;
  const w = t.split(' ').filter(Boolean);
  return w.length > max ? w.slice(0, max).join(' ') + '…' : t;
};
export async function aiThumbnail(env, o = {}) {
  const subject = String(o.query || o.title || '').replace(/["']/g, '').slice(0, 80);
  if (!subject) return null;
  const r = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: thumbPrompt(subject, o.category), steps: 6 });
  const b64 = r && (r.image || (r.result && r.result.image));
  if (!b64 || typeof b64 !== 'string') return null;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, mime TEXT, b64 TEXT, created_at INTEGER)').run();
  const id = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
  await env.DB.prepare('INSERT INTO images(id,mime,b64,created_at) VALUES(?,?,?,?)').bind(id, 'image/jpeg', b64, now()).run();
  return { url: `${env.SITE_URL}/img/${id}.jpg`, credit: 'AI-generated illustration' };
}

// ---- 2b) GUARANTEED FALLBACK IMAGE (0 token, no key): a branded news card SVG stored in D1.
// AI image can fail (rate limit / binding) and then a draft used to have no image at all. This always works.
export async function brandedImage(env, text, category) {
  try {
    const svg = generateSVGThumbnail(text, category, env.SITE_URL);
    const bytes = new TextEncoder().encode(svg);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = btoa(bin);
    const id = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, mime TEXT, b64 TEXT, created_at INTEGER)').run();
    await env.DB.prepare('INSERT INTO images(id,mime,b64,created_at) VALUES(?,?,?,?)').bind(id, 'image/svg+xml', b64, now()).run();
    return { url: `${env.SITE_URL}/img/${id}.svg`, credit: 'Virall graphic' };
  } catch { return null; }
}

// ---- 3) YouTube video (needs a free YouTube Data API key in the secret YOUTUBE_API_KEY) ----
export async function findVideo(env, query) {
  if (!env.YOUTUBE_API_KEY) return { note: 'YOUTUBE_API_KEY set nahi hai' };
  const qw = words(query);
  if (!qw.length) return { note: 'search words khali' };
  const after = new Date(Date.now() - 10 * 86400e3).toISOString();
  const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&order=relevance&videoEmbeddable=true&safeSearch=moderate&regionCode=IN'
    + '&publishedAfter=' + encodeURIComponent(after) + '&q=' + encodeURIComponent(query) + '&key=' + encodeURIComponent(env.YOUTUBE_API_KEY);
  const j = await getJson(url);
  let best = null, bestScore = 0;
  for (const it of j.items || []) {
    const sn = it.snippet || {};
    if (sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none') continue;
    const text = ((sn.title || '') + ' ' + (sn.channelTitle || '')).toLowerCase();
    const sc = qw.filter((w) => text.includes(w)).length / qw.length;
    if (sc > bestScore && it.id && it.id.videoId) { best = it; bestScore = sc; }
  }
  if (!best || bestScore < 0.6) return { note: 'topic se milta video nahi mila' };
  const th = best.snippet.thumbnails || {};
  const thumb = (th.maxres || th.standard || th.high || th.medium || {}).url || `https://i.ytimg.com/vi/${best.id.videoId}/hqdefault.jpg`;
  return { url: `https://www.youtube.com/watch?v=${best.id.videoId}`, title: strip(best.snippet.title).slice(0, 80), thumb, channel: strip(best.snippet.channelTitle).slice(0, 40) || 'YouTube' };
}

// Fills image + video of one post. o = { query, tags[], force }. Returns short notes for the admin.
// Image order (default, THUMB_MODE khali ya "photo"): free stock photo (Pexels) -> Wikimedia Commons -> AI thumbnail (aakhri raasta) -> (site poster)
// THUMB_MODE=ai: AI thumbnail pehle. YouTube ka thumbnail image ke roop mein KABHI nahi lagta (wo doosre ki copyrighted image hai); video embed alag chalta hai.
const ytId = (u) => { const m = String(u || '').match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/); return m ? m[1] : null; };
export async function addMedia(env, postId, o = {}) {
  const out = { image: '', video: '' };
  const query = String(o.query || '').trim();
  const cur = await env.DB.prepare('SELECT image_url,video_url FROM posts WHERE id=?').bind(postId).first().catch(() => null);
  if (!cur) return { image: 'post nahi mila', video: '' };
  try {
    if (o.force || !cur.video_url) {
      const v = await findVideo(env, query || (o.tags || [])[0] || '');
      if (v && v.url) {
        await env.DB.prepare('UPDATE posts SET video_url=?,updated_at=? WHERE id=?').bind(v.url, now(), postId).run();
        out.video = v.title;
      } else out.video = (v && v.note) || 'video nahi mila';
    }
  } catch (e) { out.video = 'YouTube error: ' + String(e.message).slice(0, 60); }
  try {
    if (o.force || !cur.image_url) {
      const tags = o.tags || [];
      const aiFirst = env.THUMB_MODE === 'ai';
      const tryAI = () => aiThumbnail(env, { query: query || tags[0], title: o.title, category: o.category }).catch((e) => { out.image = 'AI image error: ' + String(e.message).slice(0, 60); return null; });
      const tryStock = async () => {
        const qs = [stockQuery(query || tags[0] || '', o.category), genericQuery(o.category)].filter((q, i, a) => q && a.indexOf(q) === i);
        for (const q of qs) { const p = await findPexels(env, q, o.category).catch(() => null); if (p) return p; }
        return null;
      };
      const tryCommons = async () => { for (const q of [query, ...tags.slice(0, 2)]) { if (!q) continue; const p = await findPhoto(q).catch(() => null); if (p) return p; } return null; };
      let img = null;
      if (aiFirst) img = await tryAI();
      if (!img) img = await tryStock();
      if (!img) img = await tryCommons();
      if (!img && !aiFirst) img = await tryAI();
      if (!img) img = await brandedImage(env, o.title || query || tags[0] || 'News', o.category);
      if (img) {
        await env.DB.prepare('UPDATE posts SET image_url=?,image_credit=?,updated_at=? WHERE id=?').bind(img.url, img.credit, now(), postId).run();
        out.image = img.credit;
      } else if (!out.image) out.image = 'image nahi mili';
    }
  } catch (e) { out.image = 'image error: ' + String(e.message).slice(0, 60); }
  return out;
}
