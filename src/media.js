// Step 4: image (free licensed photo -> AI thumbnail) + video (YouTube) for a post. Never throws: a post never fails because of media.
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
export async function findPhoto(query) {
  const qw = words(query);
  if (!qw.length) return null;
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
    const text = ((p.title || '') + ' ' + strip(md.ImageDescription && md.ImageDescription.value)).toLowerCase();
    if (qw.filter((w) => text.includes(w)).length / qw.length < 0.6) continue; // must really be about the topic
    const artist = strip(md.Artist && md.Artist.value).slice(0, 60) || 'Unknown';
    return { url: ii.thumburl || ii.url, credit: `${artist} / ${lic} / Wikimedia Commons` };
  }
  return null;
}

// ---- 2) AI thumbnail (Workers AI, no key). Symbolic art only: never real people or faces. Stored in D1, served at /img/<id>.jpg ----
export async function aiIllustration(env, query) {
  const subject = String(query || '').replace(/["']/g, '').slice(0, 80);
  if (!subject) return null;
  const prompt = `Editorial thumbnail for a news article about: ${subject}. Modern flat vector style, symbolic scene, soft colors, no text, no letters, no logos, no real people, no faces.`;
  const r = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 4 });
  const b64 = r && (r.image || (r.result && r.result.image));
  if (!b64 || typeof b64 !== 'string') return null;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, mime TEXT, b64 TEXT, created_at INTEGER)').run();
  const id = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
  await env.DB.prepare('INSERT INTO images(id,mime,b64,created_at) VALUES(?,?,?,?)').bind(id, 'image/jpeg', b64, now()).run();
  return { url: `${env.SITE_URL}/img/${id}.jpg`, credit: 'AI-generated thumbnail' };
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
// Image order: licensed photo -> thumbnail of the matching YouTube video -> AI thumbnail -> (site shows a poster)
const ytId = (u) => { const m = String(u || '').match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/); return m ? m[1] : null; };
export async function addMedia(env, postId, o = {}) {
  const out = { image: '', video: '' };
  const query = String(o.query || '').trim();
  const cur = await env.DB.prepare('SELECT image_url,video_url FROM posts WHERE id=?').bind(postId).first().catch(() => null);
  if (!cur) return { image: 'post nahi mila', video: '' };
  let vid = null; // { thumb, credit } of the video this post uses
  try {
    if (o.force || !cur.video_url) {
      const v = await findVideo(env, query || (o.tags || [])[0] || '');
      if (v && v.url) {
        await env.DB.prepare('UPDATE posts SET video_url=?,updated_at=? WHERE id=?').bind(v.url, now(), postId).run();
        out.video = v.title; vid = { thumb: v.thumb, credit: `Video thumbnail: ${v.channel} / YouTube` };
      } else out.video = (v && v.note) || 'video nahi mila';
    } else if (ytId(cur.video_url)) {
      vid = { thumb: `https://i.ytimg.com/vi/${ytId(cur.video_url)}/hqdefault.jpg`, credit: 'Video thumbnail: YouTube' };
    }
  } catch (e) { out.video = 'YouTube error: ' + String(e.message).slice(0, 60); }
  try {
    if (o.force || !cur.image_url) {
      let img = null;
      for (const q of [query, ...(o.tags || []).slice(0, 2)]) {
        if (!q) continue;
        img = await findPhoto(q).catch(() => null);
        if (img) break;
      }
      if (!img && vid) img = { url: vid.thumb, credit: vid.credit };
      if (!img) img = await aiIllustration(env, query || (o.tags || [])[0]).catch((e) => { out.image = 'AI image error: ' + e.message.slice(0, 60); return null; });
      if (img) {
        await env.DB.prepare('UPDATE posts SET image_url=?,image_credit=?,updated_at=? WHERE id=?').bind(img.url, img.credit, now(), postId).run();
        out.image = img.credit;
      } else if (!out.image) out.image = 'image nahi mili';
    }
  } catch (e) { out.image = 'image error: ' + String(e.message).slice(0, 60); }
  return out;
}
