// Virall - Cloudflare-only blog. Step 1: SEO site + D1 + admin. Step 2: Trends -> topics -> research.
import { collectTopics, researchPending } from './trends.js';
import { runAI } from './ai.js';
import { writeOne } from './writer.js';
import { addMedia } from './media.js';
import { validatePost } from './validate.js';
import { preflight } from './playbook.js';
const now = () => Math.floor(Date.now() / 1000);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// zero-token verdict shown next to each topic: will the draft button even try it?
const pfTag = (r) => { try { if (r.status !== 'ready') return ''; const p = preflight(r, JSON.parse(r.research || '{}')); return p.ok ? `<span class="tag" style="background:#dff3e3">&#10003; ${esc(p.label)}</span>` : `<span class="tag" style="background:#fde8e8">&#10007; ${esc(p.reason)}</span>`; } catch { return ''; } };
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const LIVE = "status='approved' AND publish_at<=?";
const PER_PAGE = 12;

const HDR = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };
const html = (s, status = 200, cache = true) => new Response(s, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache && status === 200 ? 'public, max-age=300, s-maxage=600' : 'no-store', ...HDR } });
const xml = (s) => new Response(s, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600', ...HDR } });
const go = (loc, headers = {}) => new Response(null, { status: 303, headers: { Location: loc, 'Cache-Control': 'no-store', ...headers } });

const CSS = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font:17px/1.75 system-ui,-apple-system,'Segoe UI','Noto Sans Devanagari',sans-serif;background:#f6f7f9;color:#1b1b1b}
a{color:#0b3d91}.w{max-width:780px;margin:0 auto;padding:14px}header{background:#0b3d91}header .w{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
header a{color:#fff;text-decoration:none}.logo{font-weight:800;font-size:23px}nav a{margin-right:12px;font-size:14px;opacity:.95}
.grid{display:grid;gap:14px}.card{background:#fff;border:1px solid #e4e6ea;border-radius:12px;overflow:hidden}.card .p{padding:12px 14px}.card h2{margin:4px 0;font-size:19px;line-height:1.35}.card h2 a{color:#111;text-decoration:none}
.card img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#e9ecf1}.m{color:#666;font-size:13px}.chip{display:inline-block;padding:2px 10px;margin:2px 4px 2px 0;border-radius:99px;background:#e8eefb;color:#0b3d91;font-size:13px;text-decoration:none}
article h1{font-size:28px;line-height:1.3;margin:8px 0}article h2{font-size:22px;margin:26px 0 6px}article img.hero{width:100%;height:auto;border-radius:10px;aspect-ratio:16/9;object-fit:cover}
.toc{background:#fff;border:1px solid #e4e6ea;border-radius:10px;padding:8px 16px;font-size:15px}.toc ol{margin:4px 0;padding-left:20px}.note{background:#fff8e1;border:1px solid #f1e0a0;border-radius:10px;padding:10px 14px;font-size:14px}
.share a{display:inline-block;margin:4px 6px 4px 0;padding:6px 12px;border-radius:8px;background:#0b3d91;color:#fff;text-decoration:none;font-size:14px}.crumb{font-size:13px;color:#666}.crumb a{color:#666}
.vid{position:relative;aspect-ratio:16/9}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px}.pg{display:flex;justify-content:space-between;margin:16px 0}
input,textarea,button,select{width:100%;padding:10px;margin:6px 0;font:inherit;border:1px solid #bbb;border-radius:8px}button{background:#0b3d91;color:#fff;border:0;cursor:pointer}button.r{background:#b3261e}button.g{background:#2e7d32}button.o{background:#6b6b6b}
.tag{display:inline-block;padding:1px 8px;border-radius:99px;background:#eee;font-size:12px}footer{color:#666;font-size:14px;padding:22px 14px;text-align:center}footer a{margin:0 6px}form.s{display:flex;gap:6px}form.s input{margin:0}form.s button{width:auto}
.poster{position:relative;display:flex;flex-direction:column;justify-content:space-between;gap:10px;aspect-ratio:16/9;padding:14px 16px;color:#fff;overflow:hidden}.poster:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 88% 12%,rgba(255,255,255,.25),transparent 45%),radial-gradient(circle at 8% 100%,rgba(0,0,0,.35),transparent 55%)}.poster>*{position:relative}
.poster .pc{align-self:flex-start;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.5);border-radius:99px;padding:2px 12px;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase}
.poster .pt{font-weight:800;font-size:clamp(17px,3.4vw,22px);line-height:1.35;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 2px 10px rgba(0,0,0,.3)}
.poster .pf{display:flex;justify-content:space-between;font-size:12px;font-weight:600;opacity:.9}.poster.hero{border-radius:10px;padding:22px 26px}.poster.hero .pt{font-size:clamp(22px,4.4vw,34px);-webkit-line-clamp:5}
.credit{display:block;margin-top:4px}
@media(min-width:700px){.grid{grid-template-columns:1fr 1fr}}`;

const jsonld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;

function layout(env, o, body, cats = []) {
  const site = env.SITE_URL, name = env.SITE_NAME || 'Virall', title = o.title === name ? name : `${o.title} | ${name}`;
  const adHead = env.ADSENSE_PUB && !o.noAdScript
    ? `<meta name="google-adsense-account" content="ca-${esc(env.ADSENSE_PUB)}"><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${esc(env.ADSENSE_PUB)}" crossorigin="anonymous"></script>` : '';
  return `<!doctype html><html lang="${esc(o.lang || 'hi')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc((o.desc || env.SITE_TAGLINE || '').slice(0, 160))}">
${o.canonical ? `<link rel="canonical" href="${esc(o.canonical)}">` : ''}${o.prev ? `<link rel="prev" href="${esc(o.prev)}">` : ''}${o.next ? `<link rel="next" href="${esc(o.next)}">` : ''}
<meta name="robots" content="${o.noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large,max-snippet:-1'}">
<meta property="og:site_name" content="${esc(name)}"><meta property="og:type" content="${o.type || 'website'}"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc((o.desc || '').slice(0, 200))}">
${o.canonical ? `<meta property="og:url" content="${esc(o.canonical)}">` : ''}${o.image ? `<meta property="og:image" content="${esc(o.image)}">` : ''}
<meta name="twitter:card" content="${o.image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(o.title)}">
<link rel="alternate" type="application/rss+xml" title="${esc(name)}" href="${site}/feed.xml"><meta name="theme-color" content="#0b3d91">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%230b3d91'/%3E%3Ctext x='50' y='70' font-size='62' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='700'%3EV%3C/text%3E%3C/svg%3E">
<style>${CSS}</style>${adHead}${o.ld || ''}</head><body>
<header><div class="w"><a class="logo" href="${o.admin ? '/admin' : '/'}">${esc(name)}${o.admin ? ' Admin' : ''}</a>
${o.admin ? '' : `<nav>${cats.map((c) => `<a href="/category/${encodeURIComponent(c.category)}">${esc(c.category)}</a>`).join('')}</nav>`}</div></header>
<main class="w">${o.admin ? '' : `<form class="s" action="/search" method="get" role="search"><input name="q" placeholder="Search..." aria-label="Search"><button>Go</button></form>`}${body}</main>
<footer>${o.admin ? '' : `<div><a href="/about">About</a><a href="/editorial-policy">Editorial Policy</a><a href="/contact">Contact</a><a href="/privacy-policy">Privacy</a><a href="/terms">Terms</a><a href="/disclaimer">Disclaimer</a><a href="/feed.xml">RSS</a></div>`}
<div>&copy; ${new Date().getUTCFullYear()} ${esc(name)}</div></footer></body></html>`;
}

// plain-text body -> safe HTML. "## Heading" = h2, blank line = paragraph
function renderBody(text, adHtml = '') {
  const norm = String(text || '').replace(/\r/g, '').replace(/^(## .+)$/gm, '\n\n$1\n\n');
  const blocks = norm.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const h2s = []; let out = [], paras = 0;
  for (const b of blocks) {
    if (b.startsWith('## ')) { const t = b.slice(3), id = 's' + (h2s.length + 1); h2s.push({ id, t }); out.push(`<h2 id="${id}">${esc(t)}</h2>`); }
    else { out.push(`<p>${esc(b).replace(/\n/g, '<br>')}</p>`); if (++paras === 2 && adHtml) out.push(adHtml); }
  }
  return { html: out.join('\n'), h2s };
}
const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const ytId = (u) => { const m = String(u || '').match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/); return m ? m[1] : null; };
const slugify = (t) => (String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'post') + '-' + Math.random().toString(36).slice(2, 7);
const dec = (s) => { try { return decodeURIComponent(s); } catch { return null; } }; // broken %-encoding must be a 404, not a crash
const pageOf = (url) => Math.max(1, Math.floor(Number(url.searchParams.get('page'))) || 1);
const okImg = (u) => (String(u || '').startsWith('https://') ? u : null);
const adSlot = (env) => (env.ADSENSE_PUB && env.ADSENSE_SLOT
  ? `<ins class="adsbygoogle" style="display:block" data-ad-client="ca-${esc(env.ADSENSE_PUB)}" data-ad-slot="${esc(env.ADSENSE_SLOT)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>` : '');

const GRAD = ['#0b3d91,#3b82f6', '#7c2d12,#f97316', '#14532d,#22c55e', '#581c87,#a855f7', '#134e4a,#14b8a6', '#9f1239,#f43f5e'];
const cover = (r, hero = false) => {
  const k = String(r.category || 'Virall'); let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 997;
  const t = String(r.title || '').slice(0, 120);
  return `<div class="poster${hero ? ' hero' : ''}" style="background:linear-gradient(135deg,${GRAD[h % GRAD.length]})"><span class="pc">${esc(k)}</span><div class="pt">${esc(t)}</div><div class="pf"><span>virall.in</span><span>${r.publish_at ? day(r.publish_at) : ''}</span></div></div>`;
};
const card = (r) => `<div class="card">${r.image_url ? `<a href="/post/${r.slug}"><img loading="lazy" width="640" height="360" src="${esc(r.image_url)}" alt="${esc(r.title)}"></a>` : `<a href="/post/${r.slug}">${cover(r)}</a>`}<div class="p">${r.category ? `<a class="chip" href="/category/${encodeURIComponent(r.category)}">${esc(r.category)}</a>` : ''}<h2><a href="/post/${r.slug}">${esc(r.title)}</a></h2><div class="m">${day(r.publish_at)}</div><p>${esc(r.summary)}</p></div></div>`;

// ---------- static trust pages (AdSense / E-E-A-T essentials) ----------
function staticPage(env, key) {
  const n = esc(env.SITE_NAME), s = esc(env.SITE_URL), mail = esc(env.CONTACT_EMAIL);
  const P = {
    'about': ['About Us', `<p>${n} is an independent news-and-explainer website. We watch what India is searching for, collect facts from multiple published sources, and write our own short, clear explainers so readers get the full picture in one place.</p><p>Every article lists the sources it was based on, and carries a publish date so you know how fresh it is.</p><p>Written by: <b>${esc(env.AUTHOR_NAME)}</b> (editorial desk). Questions or corrections: <a href="mailto:${mail}">${mail}</a>.</p>`],
    'editorial-policy': ['Editorial Policy', `<h2>How articles are made</h2><p>Topics come from public trend data. For each topic we collect reporting from at least three independent outlets, then draft an original article in our own words. Drafts are produced with the help of AI tools, checked claim-by-claim against the collected sources, tested for similarity to those sources, and then approved by a person or by our automated quality gate before they go live.</p><h2>What we do not do</h2><p>We do not copy text from other websites, publish unverified rumours as facts, or invent quotes. If sources disagree, we say so.</p><h2>Images and video</h2><p>Images come from openly licensed libraries and are credited under the picture. Videos are embedded from the original publisher.</p><h2>Corrections</h2><p>If you find an error, email <a href="mailto:${mail}">${mail}</a> with the page link. Confirmed errors are corrected quickly and the page is updated.</p>`],
    'contact': ['Contact Us', `<p>For corrections, copyright concerns, advertising or any feedback, email us at <a href="mailto:${mail}">${mail}</a>. We usually reply within 2-3 working days.</p>`],
    'privacy-policy': ['Privacy Policy', `<p>Last updated: ${day(now())}. This policy explains what information ${n} (${s}) handles when you visit.</p><h2>Information we collect</h2><p>We do not ask visitors to create accounts. Our servers and hosting provider (Cloudflare) may log technical data such as IP address, browser type and pages visited, for security and performance.</p><h2>Cookies and advertising</h2><p>We may show ads served by Google AdSense. Google and its partners use cookies to serve ads based on your visits to this and other sites. You can opt out of personalised advertising at <a href="https://www.google.com/settings/ads">google.com/settings/ads</a>, and learn how Google uses data at <a href="https://policies.google.com/technologies/partner-sites">policies.google.com/technologies/partner-sites</a>. Where required by law (for example in the EEA and UK), consent is requested before personalised ads are shown.</p><h2>Third-party content</h2><p>Some pages embed YouTube videos (privacy-enhanced mode). Those services may set their own cookies when you play a video. Links to other sites are not under our control.</p><h2>Children</h2><p>This site is not directed at children under 13.</p><h2>Contact</h2><p><a href="mailto:${mail}">${mail}</a></p>`],
    'terms': ['Terms of Use', `<p>By using ${n} you agree to these terms. Content is provided for general information. You may share links and short excerpts with credit and a link back; you may not republish full articles without permission. We may change or remove content at any time. Use of the site is at your own risk.</p>`],
    'disclaimer': ['Disclaimer', `<p>Information on ${n} is compiled from public sources and is provided for general information only. It is not legal, financial, medical or investment advice. We try to keep articles accurate but cannot guarantee completeness. Please verify important details from official sources before acting on them.</p>`],
  }[key];
  return P ? { title: P[0], body: `<article><h1>${esc(P[0])}</h1>${P[1]}</article>` } : null;
}

// ---------- admin auth ----------
async function token(env) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.ADMIN_PASSWORD), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('virall-admin'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function isAdmin(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)adm=([^;]+)/);
  return !!m && m[1] === (await token(env));
}

// ---------- scheduled jobs ----------
// ---- on/off switches stored in D1 (change them from /admin, no redeploy needed) ----
async function getSetting(env, k, dflt = '0') {
  try {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)').run();
    const r = await env.DB.prepare('SELECT v FROM settings WHERE k=?').bind(k).first();
    return r ? r.v : dflt;
  } catch { return dflt; }
}
async function setSetting(env, k, v) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)').run();
  await env.DB.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, v).run();
}
// AI auto-publish (only when the switch is ON): drafts with a high grounded score, left alone for AUTO_APPROVE_HOURS, go live
const parseCheck = (p) => { try { return p && p.check_json ? JSON.parse(p.check_json) : null; } catch { return null; } };
async function autoApprove(env) {
  if ((await getSetting(env, 'auto_publish')) !== '1') return;
  const hrs = Number(env.AUTO_APPROVE_HOURS || 0), min = Number(env.AUTO_APPROVE_MIN_SCORE || 95);
  const { results } = await env.DB.prepare(`SELECT * FROM posts WHERE status='draft' AND score IS NOT NULL AND score>=?1 AND created_at<=?2 ORDER BY id LIMIT 20`).bind(min, now() - hrs * 3600).all();
  for (const p of results) {
    // strict: no fact-check record, an unsupported claim, a stale source or a missing required field => a human decides
    if (!validatePost(p, { check: parseCheck(p), strict: true }).ok) continue;
    await env.DB.prepare(`UPDATE posts SET status='approved', publish_at=?1 + (abs(random()) % 3600), updated_at=?1 WHERE id=?2 AND status='draft'`).bind(now(), p.id).run();
  }
}
async function pingIndexNow(env) {
  if (!env.INDEXNOW_KEY) return;
  const { results } = await env.DB.prepare(`SELECT id,slug FROM posts WHERE ${LIVE} AND pinged=0 LIMIT 50`).bind(now()).all();
  if (!results.length) return;
  const host = new URL(env.SITE_URL).host;
  const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, key: env.INDEXNOW_KEY, keyLocation: `${env.SITE_URL}/${env.INDEXNOW_KEY}.txt`, urlList: results.map((x) => `${env.SITE_URL}/post/${x.slug}`) }) });
  if (r.status < 300) await env.DB.prepare(`UPDATE posts SET pinged=1 WHERE id IN (${results.map(() => '?').join(',')})`).bind(...results.map((x) => x.id)).run();
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await autoApprove(env); await pingIndexNow(env);
      try { await collectTopics(env); } catch (e) { console.log('trends', e.message); }
      try { await researchPending(env, 2); } catch (e) { console.log('research', e.message); }
      try {
        if ((await getSetting(env, 'auto_write')) === '1') {
          const r = await writeOne(env);
          await setSetting(env, 'last_write', JSON.stringify({ at: now(), ok: !!r.ok, msg: String(r.ok ? r.title : r.reason).slice(0, 300) }));
        }
      } catch (e) {
        console.log('write', e.message);
        try { await setSetting(env, 'last_write', JSON.stringify({ at: now(), ok: false, msg: 'ERROR: ' + String(e.message).slice(0, 250) })); } catch {}
      }
      // Step 4 will add: image + video for drafts
    })());
  },

  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname.replace(/\/+$/, '') || '/', site = env.SITE_URL || url.origin;
    const t = now();

    if (p === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /search\n\nSitemap: ${site}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain' } });
    if (p === '/ads.txt') return new Response(env.ADSENSE_PUB ? `google.com, ${env.ADSENSE_PUB}, DIRECT, f08c47fec0942fa0\n` : '# set ADSENSE_PUB\n', { headers: { 'Content-Type': 'text/plain' } });
    if (env.INDEXNOW_KEY && p === `/${env.INDEXNOW_KEY}.txt`) return new Response(env.INDEXNOW_KEY, { headers: { 'Content-Type': 'text/plain' } });

    if (p === '/sitemap.xml') {
      const { results } = await env.DB.prepare(`SELECT slug,image_url,publish_at,updated_at FROM posts WHERE ${LIVE} ORDER BY publish_at DESC LIMIT 5000`).bind(t).all();
      const cats = await env.DB.prepare(`SELECT DISTINCT category FROM posts WHERE ${LIVE} AND category IS NOT NULL AND category!=''`).bind(t).all();
      const st = ['about', 'editorial-policy', 'contact', 'privacy-policy', 'terms', 'disclaimer'];
      return xml(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>${site}/</loc></url>${st.map((s) => `<url><loc>${site}/${s}</loc></url>`).join('')}${cats.results.map((c) => `<url><loc>${site}/category/${encodeURIComponent(c.category)}</loc></url>`).join('')}${results.map((r) => `<url><loc>${site}/post/${r.slug}</loc><lastmod>${new Date((r.updated_at || r.publish_at) * 1000).toISOString()}</lastmod>${okImg(r.image_url) ? `<image:image><image:loc>${esc(r.image_url)}</image:loc></image:image>` : ''}</url>`).join('')}</urlset>`);
    }
    if (p === '/feed.xml') {
      const { results } = await env.DB.prepare(`SELECT slug,title,summary,publish_at FROM posts WHERE ${LIVE} ORDER BY publish_at DESC LIMIT 50`).bind(t).all();
      return xml(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(env.SITE_NAME)}</title><link>${site}</link><description>${esc(env.SITE_TAGLINE)}</description>${results.map((r) => `<item><title>${esc(r.title)}</title><link>${site}/post/${r.slug}</link><guid>${site}/post/${r.slug}</guid><pubDate>${new Date(r.publish_at * 1000).toUTCString()}</pubDate><description>${esc(r.summary)}</description></item>`).join('')}</channel></rss>`);
    }

    // ----- AI illustrations stored in D1 -----
    if (p.startsWith('/img/')) {
      const id = p.slice(5).replace(/\.jpg$/, '');
      try {
        const r = await env.DB.prepare('SELECT mime,b64 FROM images WHERE id=?').bind(id).first();
        if (r) return new Response(Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0)), { headers: { 'Content-Type': r.mime || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
      } catch {}
      return new Response('not found', { status: 404 });
    }

    // ----- admin -----
    if (p.startsWith('/admin')) return admin(req, env, p, url);

    // ----- public pages -----
    const cats = (await env.DB.prepare(`SELECT category,COUNT(*) c FROM posts WHERE ${LIVE} AND category IS NOT NULL AND category!='' GROUP BY category ORDER BY c DESC LIMIT 6`).bind(t).all()).results;
    const name = env.SITE_NAME;
    const L = (o, b, status) => html(layout(env, o, b, cats), status);
    const siteLd = jsonld({ '@context': 'https://schema.org', '@type': 'WebSite', name, url: site, potentialAction: { '@type': 'SearchAction', target: `${site}/search?q={q}`, 'query-input': 'required name=q' } })
      + jsonld({ '@context': 'https://schema.org', '@type': 'Organization', name, url: site });

    if (p === '/' || p === '/category/' ) {
      const pg = pageOf(url);
      const total = (await env.DB.prepare(`SELECT COUNT(*) c FROM posts WHERE ${LIVE}`).bind(t).first()).c;
      const { results } = await env.DB.prepare(`SELECT slug,title,summary,image_url,category,publish_at FROM posts WHERE ${LIVE} ORDER BY publish_at DESC LIMIT ? OFFSET ?`).bind(t, PER_PAGE, (pg - 1) * PER_PAGE).all();
      const pages = Math.ceil(total / PER_PAGE);
      const pager = pages > 1 ? `<div class="pg">${pg > 1 ? `<a href="/?page=${pg - 1}">&laquo; Newer</a>` : '<span></span>'}${pg < pages ? `<a href="/?page=${pg + 1}">Older &raquo;</a>` : ''}</div>` : '';
      return L({ title: name, desc: env.SITE_TAGLINE, canonical: pg > 1 ? `${site}/?page=${pg}` : site + '/', ld: pg === 1 ? siteLd : '', prev: pg > 1 ? `${site}/?page=${pg - 1}` : '', next: pg < pages ? `${site}/?page=${pg + 1}` : '' },
        `<h1>${esc(env.SITE_TAGLINE)}</h1><div class="grid">${results.map(card).join('') || '<p>Jaldi aa raha hai.</p>'}</div>${pager}`);
    }

    if (p.startsWith('/category/')) {
      const c = dec(p.slice(10)), pg = pageOf(url);
      if (c === null) return L({ title: 'Not found', noindex: true }, '<h1>404</h1><p>Yeh category nahi mili.</p>', 404);
      const total = (await env.DB.prepare(`SELECT COUNT(*) c FROM posts WHERE ${LIVE} AND category=?`).bind(t, c).first()).c;
      if (!total) return L({ title: 'Not found', noindex: true }, '<h1>404</h1><p>Yeh category nahi mili.</p>', 404);
      const { results } = await env.DB.prepare(`SELECT slug,title,summary,image_url,category,publish_at FROM posts WHERE ${LIVE} AND category=? ORDER BY publish_at DESC LIMIT ? OFFSET ?`).bind(t, c, PER_PAGE, (pg - 1) * PER_PAGE).all();
      const base = `${site}/category/${encodeURIComponent(c)}`, pages = Math.ceil(total / PER_PAGE);
      return L({ title: `${c} News`, desc: `${c} par taaza khabrein aur explainers - ${name}`, canonical: pg > 1 ? `${base}?page=${pg}` : base, prev: pg > 1 ? `${base}?page=${pg - 1}` : '', next: pg < pages ? `${base}?page=${pg + 1}` : '' },
        `<div class="crumb"><a href="/">Home</a> &rsaquo; ${esc(c)}</div><h1>${esc(c)}</h1><div class="grid">${results.map(card).join('')}</div>${pages > 1 ? `<div class="pg">${pg > 1 ? `<a href="?page=${pg - 1}">&laquo; Newer</a>` : '<span></span>'}${pg < pages ? `<a href="?page=${pg + 1}">Older &raquo;</a>` : ''}</div>` : ''}`);
    }

    if (p === '/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      const rows = q ? (await env.DB.prepare(`SELECT slug,title,summary,image_url,category,publish_at FROM posts WHERE ${LIVE} AND (title LIKE ?2 OR summary LIKE ?2) ORDER BY publish_at DESC LIMIT 20`).bind(t, `%${q}%`).all()).results : [];
      return L({ title: `Search: ${q}`, noindex: true, noAdScript: true }, `<h1>Search</h1>${q ? `<p>"${esc(q)}" ke ${rows.length} result</p>` : ''}<div class="grid">${rows.map(card).join('')}</div>`);
    }

    const sp = staticPage(env, p.slice(1));
    if (sp) return L({ title: sp.title, desc: sp.title + ' - ' + name, canonical: `${site}${p}`, lang: 'en', noAdScript: p !== '/about' && false }, sp.body);

    if (p.startsWith('/post/')) {
      const slug = dec(p.slice(6));
      if (slug === null) return L({ title: 'Not found', noindex: true }, '<h1>404</h1><p>Yeh page nahi mila. <a href="/">Home par jaiye</a>.</p>', 404);
      const r = await env.DB.prepare(`SELECT * FROM posts WHERE slug=? AND ${LIVE}`).bind(slug, t).first();
      if (!r) return L({ title: 'Not found', noindex: true }, '<h1>404</h1><p>Yeh page nahi mila. <a href="/">Home par jaiye</a>.</p>', 404);
      const wc = r.word_count || words(r.body), showAds = wc >= Number(env.MIN_WORDS_FOR_ADS || 600);
      const { html: bodyHtml, h2s } = renderBody(r.body, showAds ? adSlot(env) : '');
      const rel = (await env.DB.prepare(`SELECT slug,title,summary,image_url,category,publish_at FROM posts WHERE ${LIVE} AND id!=? ORDER BY (category=?) DESC, publish_at DESC LIMIT 4`).bind(t, r.id, r.category || '').all()).results;
      const v = ytId(r.video_url), canon = `${site}/post/${r.slug}`;
      let srcs = []; try { srcs = JSON.parse(r.sources || '[]'); } catch {}
      srcs = (Array.isArray(srcs) ? srcs : []).filter((s) => /^https?:\/\//i.test(String((s && s.url) || s || ''))); // only real web links (no javascript: etc.)
      const tags = String(r.tags || '').split(',').map((x) => x.trim()).filter(Boolean);
      const ld = jsonld({ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: r.title.slice(0, 110), description: r.summary, image: okImg(r.image_url) ? [r.image_url] : undefined, datePublished: new Date(r.publish_at * 1000).toISOString(), dateModified: new Date((r.updated_at || r.publish_at) * 1000).toISOString(), inLanguage: r.lang || 'hi', mainEntityOfPage: canon, wordCount: wc, keywords: tags.join(', ') || undefined, articleSection: r.category || undefined, author: { '@type': 'Organization', name: env.AUTHOR_NAME, url: `${site}/about` }, publisher: { '@type': 'Organization', name, url: site } })
        + jsonld({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: site + '/' }, ...(r.category ? [{ '@type': 'ListItem', position: 2, name: r.category, item: `${site}/category/${encodeURIComponent(r.category)}` }] : []), { '@type': 'ListItem', position: r.category ? 3 : 2, name: r.title }] });
      const enc = encodeURIComponent, shareT = enc(r.title), shareU = enc(canon);
      const b = `<div class="crumb"><a href="/">Home</a>${r.category ? ` &rsaquo; <a href="/category/${enc(r.category)}">${esc(r.category)}</a>` : ''}</div>
<article><h1>${esc(r.title)}</h1><div class="m">By ${esc(env.AUTHOR_NAME)} &middot; Published ${day(r.publish_at)}${r.updated_at && r.updated_at - r.publish_at > 86400 ? ` &middot; Updated ${day(r.updated_at)}` : ''} &middot; ${Math.max(1, Math.round(wc / 200))} min read</div>
${r.image_url ? `<p><img class="hero" width="1200" height="675" fetchpriority="high" src="${esc(r.image_url)}" alt="${esc(r.title)}"><span class="m credit">Image: ${esc(r.image_credit)}</span></p>` : `<p>${cover(r, true)}</p>`}
<p><i>${esc(r.summary)}</i></p>
${h2s.length >= 3 ? `<nav class="toc" aria-label="Contents"><b>Contents</b><ol>${h2s.map((h) => `<li><a href="#${h.id}">${esc(h.t)}</a></li>`).join('')}</ol></nav>` : ''}
${bodyHtml}
${v ? `<h2>Video</h2><div class="vid"><iframe loading="lazy" title="${esc(r.title)}" src="https://www.youtube-nocookie.com/embed/${v}" allowfullscreen></iframe></div>` : ''}
${srcs.length ? `<h2>Sources</h2><ul>${srcs.map((s) => `<li><a rel="nofollow noopener" target="_blank" href="${esc(s.url || s)}">${esc(s.title || s.url || s)}</a></li>`).join('')}</ul>` : ''}
${tags.length ? `<p>${tags.map((x) => `<a class="chip" href="/search?q=${enc(x)}">#${esc(x)}</a>`).join('')}</p>` : ''}
<div class="share"><b>Share:</b> <a href="https://wa.me/?text=${shareT}%20${shareU}">WhatsApp</a><a href="https://t.me/share/url?url=${shareU}&text=${shareT}">Telegram</a><a href="https://twitter.com/intent/tweet?text=${shareT}&url=${shareU}">X</a><a href="https://www.facebook.com/sharer/sharer.php?u=${shareU}">Facebook</a></div>
<p class="note">Yeh lekh AI ki madad se taiyar hua aur multiple sources se jaanch kar publish kiya gaya. Details: <a href="/editorial-policy">Editorial Policy</a>. Galti mile to <a href="/contact">hamein batayein</a>.</p></article>
${rel.length ? `<h2>Aur padhein</h2><div class="grid">${rel.map(card).join('')}</div>` : ''}`;
      return L({ title: r.title, desc: r.summary, canonical: canon, image: okImg(r.image_url), type: 'article', lang: r.lang || 'hi', ld }, b);
    }

    return L({ title: 'Not found', noindex: true }, '<h1>404</h1><p>Yeh page nahi mila. <a href="/">Home par jaiye</a>.</p>', 404);
  },
};

// ---------- admin ----------
async function admin(req, env, p, url) {
  const O = { admin: true, noindex: true, noAdScript: true };
  const A = (title, body, status = 200) => html(layout(env, { ...O, title }, body), status, false);
  if (!env.ADMIN_PASSWORD) return A('Setup', '<p>Cloudflare Settings &rarr; Variables and Secrets me <b>ADMIN_PASSWORD</b> (secret) add karo.</p>');
  if (p === '/admin/login' && req.method === 'POST') {
    const f = await req.formData();
    if (f.get('password') === env.ADMIN_PASSWORD) return go('/admin', { 'Set-Cookie': `adm=${await token(env)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000` });
    return A('Login', '<p>Galat password.</p><p><a href="/admin">Back</a></p>', 401);
  }
  if (!(await isAdmin(req, env))) return A('Login', '<form method="post" action="/admin/login"><input type="password" name="password" placeholder="Admin password" required><button>Login</button></form>');
  if (p === '/admin/logout') return go('/admin', { 'Set-Cookie': 'adm=; Path=/; Max-Age=0' });

  if (p === '/admin/setting' && req.method === 'POST') {
    const f = await req.formData(), k = String(f.get('k') || '');
    if (k === 'auto_write' || k === 'auto_publish') await setSetting(env, k, f.get('v') === '1' ? '1' : '0');
    return go('/admin');
  }

  if (p === '/admin/ai-test') {
    const r = await runAI(env, [{ role: 'user', content: 'Ek line me Hindi me bolo: Cloudflare AI chal raha hai.' }], { max_tokens: 200 });
    const out = r.text ? `OK (model: ${r.model})\n\n${r.text}` : 'ERROR:\n' + r.errors.join('\n');
    return A('AI test', `<h1>AI test</h1><div class="card"><div class="p">${esc(out).replace(/\n/g, '<br>')}</div></div><a href="/admin">Back</a>`);
  }

  if (p === '/admin/new') {
    if (req.method === 'POST') {
      const f = await req.formData(), tt = now(), title = String(f.get('title') || '').trim(), body = String(f.get('body') || '');
      try {
        await env.DB.prepare('INSERT INTO posts(slug,title,summary,body,category,tags,lang,image_url,image_credit,video_url,word_count,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .bind(slugify(title), title, f.get('summary'), body, f.get('category'), f.get('tags'), f.get('lang') || 'hi', okImg(f.get('image_url')), f.get('image_credit'), f.get('video_url'), words(body), 'draft', tt, tt).run();
      } catch (e) { return A('Error', `<p>Save nahi hua: ${esc(e.message)} (shayad yeh title pehle se hai)</p><a href="/admin/new">Back</a>`, 400); }
      return go('/admin');
    }
    return A('New draft', `<h1>Test draft</h1><form method="post"><input name="title" placeholder="Title" required><input name="summary" placeholder="Short summary (150 akshar tak)" maxlength="200"><input name="category" placeholder="Category (e.g. Odisha)"><input name="tags" placeholder="Tags, comma se alag"><select name="lang"><option value="hi">Hindi</option><option value="en">English</option></select><textarea name="body" rows="12" placeholder="Body (## Heading, khali line = naya paragraph)" required></textarea><input name="image_url" placeholder="Image URL (https://...)"><input name="image_credit" placeholder="Image credit"><input name="video_url" placeholder="YouTube link (optional)"><button>Save as draft</button></form>`);
  }

  if (p === '/admin/topics/run' && req.method === 'POST') {
    const parts = [];
    try { const c = await collectTopics(env); parts.push(`Naye topics: ${c.added}${c.note ? ' (' + c.note + ')' : ''} [source: ${c.via || '-'}${c.errs && c.errs.length ? '; ' + c.errs.join(', ') : ''}]`); }
    catch (e) { parts.push('Topics fetch fail: ' + e.message); }
    try { const r = await researchPending(env, 3); parts.push('research: ' + (r.map((x) => x.status + '/' + x.sources).join(', ') || 'koi pending nahi')); }
    catch (e) { parts.push('Research fail: ' + e.message); }
    return go('/admin/topics?msg=' + encodeURIComponent(parts.join(' | ')));
  }
  if (p === '/admin/write' && req.method === 'POST') {
    let msg = '';
    try { const r = await writeOne(env); msg = r.ok ? `Draft ban gaya: ${r.title} (score ${r.score}, ${r.words} shabd)` : 'Draft nahi bana: ' + r.reason; }
    catch (e) { msg = 'ERROR: ' + e.message; }
    return go('/admin/topics?msg=' + encodeURIComponent(msg));
  }
  if (p === '/admin/topics') {
    const { results } = await env.DB.prepare("SELECT id,query,traffic,status,source_count,CASE WHEN status='ready' THEN research END AS research FROM topics ORDER BY id DESC LIMIT 60").all();
    const msg = url.searchParams.get('msg');
    return A('Topics', `<h1>Trending topics</h1>${msg ? `<p class="note">${esc(msg)}</p>` : ''}<form method="post" action="/admin/topics/run"><button>Abhi trends + research chalao</button></form><form method="post" action="/admin/write"><button class="g">Ek draft abhi likho (1-2 min lagenge, page band mat karna)</button></form>${results.map((r) => `<div class="card"><div class="p"><a href="/admin/topic/${r.id}"><b>${esc(r.query)}</b></a><div class="m"><span class="tag">${esc(r.status)}</span> sources: ${r.source_count} &middot; ${esc(r.traffic)} ${pfTag(r)}</div></div></div>`).join('') || '<p>Abhi koi topic nahi. Upar ka button dabao.</p>'}`);
  }
  const tm = p.match(/^\/admin\/topic\/(\d+)$/);
  if (tm) {
    const r = await env.DB.prepare('SELECT * FROM topics WHERE id=?').bind(Number(tm[1])).first();
    if (!r) return go('/admin/topics');
    let d = {}; try { d = JSON.parse(r.research || '{}'); } catch {}
    return A('Topic', `<h1>${esc(r.query)}</h1><p><span class="tag">${esc(r.status)}</span> ${esc(r.traffic)}</p>${d.errors && d.errors.length ? `<p class="note">Provider errors: ${esc(d.errors.join(' | '))} (koshish: ${d.tried || 0} outlets)</p>` : ''}${d.reject_reason ? `<p class="note">Reject karne ki wajah: ${esc(d.reject_reason)}</p>` : ''}${d.check ? `<p class="note">Checks: ${esc(JSON.stringify(d.check))}</p>` : ''}${(d.sources || []).map((s) => `<div class="card"><div class="p"><b>${esc(s.source)}</b><br><a href="${esc(/^https?:\/\//i.test(String(s.url || '')) ? s.url : '#')}" target="_blank" rel="noopener">${esc(s.title)}</a><p class="m">${esc(s.snippet)}</p><p class="m">${(s.text || '').length} akshar text</p></div></div>`).join('') || '<p>Research abhi baaki hai.</p>'}<p><a href="/admin/topics">Back</a></p>`);
  }

  const m = p.match(/^\/admin\/post\/(\d+)(\/action)?$/);
  if (m) {
    const id = Number(m[1]);
    if (m[2] && req.method === 'POST') {
      const f = await req.formData(), a = f.get('a'), tt = now();
      if (a === 'media_refresh') {
        const pr = await env.DB.prepare('SELECT tags FROM posts WHERE id=?').bind(id).first();
        const tags = String((pr && pr.tags) || '').split(',').map((x) => x.trim()).filter(Boolean);
        const mo = await addMedia(env, id, { query: String(f.get('q') || tags[0] || '').trim(), tags, force: true });
        return go('/admin/post/' + id + '?msg=' + encodeURIComponent('Image: ' + (mo.image || '-') + ' | Video: ' + (mo.video || '-')));
      }
      if (a === 'save_media') {
        await env.DB.prepare('UPDATE posts SET image_url=?,image_credit=?,video_url=?,updated_at=? WHERE id=?').bind(okImg(f.get('image_url')), String(f.get('image_credit') || ''), String(f.get('video_url') || ''), tt, id).run();
        return go('/admin/post/' + id);
      }
      if ((a === 'approve_now' || a === 'approve_random') && f.get('force') !== '1') {
        const pr = await env.DB.prepare('SELECT * FROM posts WHERE id=?').bind(id).first();
        const vr = pr ? validatePost(pr, { check: parseCheck(pr) }) : { ok: true, errors: [] };
        if (!vr.ok) return go('/admin/post/' + id + '?vm=' + encodeURIComponent('Approve nahi hua: ' + vr.errors.map((e) => e.msg).join('; ')));
      }
      const q = {
        approve_now: ["UPDATE posts SET status='approved',publish_at=?1,updated_at=?1,pinged=0 WHERE id=?2", [tt, id]],
        approve_random: ["UPDATE posts SET status='approved',publish_at=?1+(abs(random())%3600),updated_at=?1,pinged=0 WHERE id=?2", [tt, id]],
        reject: ["UPDATE posts SET status='rejected',updated_at=?1 WHERE id=?2", [tt, id]],
        to_draft: ["UPDATE posts SET status='draft',publish_at=NULL,updated_at=?1 WHERE id=?2", [tt, id]],
        delete: ['DELETE FROM posts WHERE id=?2 AND ?1>0', [tt, id]],
      }[a];
      if (q) await env.DB.prepare(q[0]).bind(...q[1]).run();
      return go('/admin');
    }
    const r = await env.DB.prepare('SELECT * FROM posts WHERE id=?').bind(id).first();
    if (!r) return go('/admin');
    const btn = (a, label, c = '') => `<form method="post" action="/admin/post/${id}/action"><input type="hidden" name="a" value="${a}"><button class="${c}">${label}</button></form>`;
    const act = '/admin/post/' + id + '/action', vid = ytId(r.video_url), mmsg = url.searchParams.get('msg');
    const mediaBlock = `<div class="card"><div class="p"><b>Image / Video</b>${mmsg ? `<p class="note">${esc(mmsg)}</p>` : ''}${r.image_credit ? `<p class="m">Image credit: ${esc(r.image_credit)}</p>` : ''}${vid ? `<div class="vid"><iframe loading="lazy" title="video" src="https://www.youtube-nocookie.com/embed/${vid}" allowfullscreen></iframe></div>` : '<p class="m">Abhi video nahi hai.</p>'}<form method="post" action="${act}"><input type="hidden" name="a" value="media_refresh"><input name="q" placeholder="English search words, jaise: Ann Li tennis"><button class="o">Image + video dobara dhoondo</button></form><form method="post" action="${act}"><input type="hidden" name="a" value="save_media"><input name="image_url" value="${esc(r.image_url)}" placeholder="Image URL (https://...)"><input name="image_credit" value="${esc(r.image_credit)}" placeholder="Image credit"><input name="video_url" value="${esc(r.video_url)}" placeholder="YouTube link"><button>Image / video save karo</button></form></div></div>`;
    const vr = validatePost(r, { check: parseCheck(r) }), ck = parseCheck(r), vm = url.searchParams.get('vm');
    const li = (arr, icon, st) => arr.map((x) => `<p class="note"${st ? ` style="${st}"` : ''}>${icon} ${esc(x.msg)}</p>`).join('');
    const claimRows = ((ck && ck.claimList) || []).map((c) => `<li>${c.ok ? '&#10003;' : '&#10007;'} ${esc(c.c)}<br><span class="m">${esc(c.e)}</span></li>`).join('');
    const checkBlock = `<div class="card"><div class="p"><b>Publish se pehle jaanch</b>${vm ? `<p class="note">${esc(vm)}</p>` : ''}${li(vr.errors, '&#10060;', 'background:#fdecea;border-color:#f5c2c0')}${li(vr.warnings, '&#9888;&#65039;')}${vr.errors.length || vr.warnings.length ? '' : '<p class="m">Sab jaanch theek hain.</p>'}`
      + `${ck ? `<p class="m">Fact-check: ${ck.supported}/${ck.claims} claims ka sabut sources mein mila, ${ck.fixRounds || 0} baar sudhaara gaya, copy overlap ${((ck.overlap || 0) * 100).toFixed(0)}%${ck.numbersNotInSources && ck.numbersNotInSources.length ? ' | sankhya sources mein nahi: ' + esc(ck.numbersNotInSources.join(', ')) : ''}${ck.latinNotInSources && ck.latinNotInSources.length ? ' | English naam sources mein nahi: ' + esc(ck.latinNotInSources.join(', ')) : ''}</p>${claimRows ? `<details><summary>Kya check hua (claim + sabut)</summary><ul>${claimRows}</ul></details>` : ''}` : '<p class="m">Is post ka fact-check record nahi hai.</p>'}</div></div>`;
    const btnF = (a, label, c = '') => `<form method="post" action="${act}"><input type="hidden" name="a" value="${a}"><input type="hidden" name="force" value="1"><button class="${c}">${label}</button></form>`;
    const approveBtns = vr.ok ? btn('approve_now', 'Approve + publish now', 'g') + btn('approve_random', 'Approve + publish at random time (within 1 hr)')
      : '<p class="note">Upar ki &#10060; galtiyan theek hone tak Approve band hai.</p>' + btnF('approve_now', 'Phir bhi approve + publish karo (meri zimmedari)', 'r');
    return A('Review', `<h1>${esc(r.title)}</h1><p><span class="tag">${esc(r.status)}</span> score: ${r.score ?? '-'} &middot; ${r.word_count || words(r.body)} words &middot; ${esc(r.category)}</p>${r.image_url ? `<img src="${esc(r.image_url)}" style="max-width:100%">` : ''}<p><i>${esc(r.summary)}</i></p>${renderBody(r.body).html}
${checkBlock}
${mediaBlock}
${approveBtns}${btn('reject', 'Reject', 'r')}${btn('to_draft', 'Back to draft', 'o')}${btn('delete', 'Delete', 'r')}`);
  }

  const { results } = await env.DB.prepare('SELECT id,title,status,score,publish_at FROM posts ORDER BY id DESC LIMIT 60').all();
  const rows = results.map((r) => `<div class="card"><div class="p"><a href="/admin/post/${r.id}"><b>${esc(r.title)}</b></a><div class="m"><span class="tag">${esc(r.status)}</span> score: ${r.score ?? '-'}${r.publish_at ? ' | live: ' + new Date(r.publish_at * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : ''}</div></div></div>`).join('');
  const aw = (await getSetting(env, 'auto_write')) === '1', ap = (await getSetting(env, 'auto_publish')) === '1';
  let lw = null; try { lw = JSON.parse(await getSetting(env, 'last_write', '')); } catch {}
  const lwHtml = lw ? `<p class="note">Aakhri auto-draft koshish (${new Date((lw.at + 19800) * 1000).toISOString().replace('T', ' ').slice(0, 16)} IST): ${lw.ok ? 'draft bana: ' : 'nahi bana: '}${esc(lw.msg)}</p>` : '<p class="m">Auto-draft ne abhi tak koi koshish record nahi ki.</p>';
  const sw = (k, on, label) => `<form method="post" action="/admin/setting"><input type="hidden" name="k" value="${k}"><input type="hidden" name="v" value="${on ? 0 : 1}"><button class="${on ? 'g' : 'o'}">${label}: ${on ? 'ON (band karne ke liye dabao)' : 'OFF (chalu karne ke liye dabao)'}</button></form>`;
  const panel = `<div class="card"><div class="p"><b>Switches</b>${sw('auto_write', aw, 'Auto-draft (har ghante AI khud draft likhe)')}${sw('auto_publish', ap, 'AI auto-publish (draft khud live kare)')}${lwHtml}<p class="m">Auto-draft OFF ho to draft sirf tab banega jab tum Topics page par green button dabaoge. AI auto-publish ON ho to score ${esc(env.AUTO_APPROVE_MIN_SCORE || 95)} ya zyada wale drafts, ${esc(env.AUTO_APPROVE_HOURS || 0)} ghante tak tumne kuch na kiya to, khud live ho jayenge. Dono OFF = har post tum khud approve karoge.</p></div></div>`;
  return A('Admin', `<p><a href="/admin/new">+ New test draft</a> | <a href="/admin/topics">Topics</a> | <a href="/admin/ai-test">AI test</a> | <a href="/" target="_blank">Site</a> | <a href="/admin/logout">Logout</a></p>${panel}${rows || '<p>Koi post nahi.</p>'}`);
}
