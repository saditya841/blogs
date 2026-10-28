// cardpost.js — thumbnail jaisa SUNDAR "card post": headline + 3-5 chhote point + photo + source + brand.
// Flow: admin ne card dekha -> "Card post banao" -> ek chhota AI call facts ko apne shabdon mein 3-5 point banata hai
//       -> code jaanchta hai (sankhya/naam facts mein hain, seedhi nakal nahi) -> photo (free stock pehle) -> /card/<id> par live.
import { runAI } from './ai.js';
import { numbersNotIn, latinNotIn } from './verify.js';
import { copyCheck } from './writer.js';
import { findPexels, findPhoto, aiThumbnail, stockQuery, genericQuery } from './media.js';
import { classify } from './playbook.js';

const now = () => Math.floor(Date.now() / 1000);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s) => String(s || '').replace(/[*#_`]/g, '').replace(/[“”„«»"]/g, '').replace(/\s+/g, ' ').trim();

// ---------- 1) AI ka jawab -> hook + points ----------
export function parseCardOutput(text) {
  let hook = ''; const points = [];
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim(); if (!l) continue;
    const h = l.match(/^\W*HOOK\s*:\s*(.*)$/i);
    if (h) { hook = clean(h[1]); continue; }
    const b = l.match(/^(?:[-•*]|\d+[.)])\s*(.+)$/);
    if (b) points.push(clean(b[1]));
  }
  return { hook, points };
}

// ---------- 2) code ki jaanch (bina AI) ----------
export function guardCard(out, facts, lang = 'hi') {
  const errs = [];
  const factText = (facts || []).map((f) => f.text).join('\n');
  const pts = (out && out.points) || [];
  const hook = (out && out.hook) || '';
  if (!hook) errs.push('headline nahi mila');
  else if (hook.split(/\s+/).filter(Boolean).length > 10) errs.push('headline bahut lamba (10 shabd se kam rakho)');
  if (pts.length < 3) errs.push(`sirf ${pts.length} point (3 se 5 chahiye)`);
  pts.slice(0, 5).forEach((p, i) => { if (p.length < 15) errs.push(`point ${i + 1} bahut chhota`); if (p.length > 230) errs.push(`point ${i + 1} bahut lamba`); });
  const all = [hook, ...pts].join('\n');
  const nn = numbersNotIn(all, factText);
  if (nn.length) errs.push(`sankhya facts mein nahi hain: ${nn.join(', ')}`);
  const ln = latinNotIn(all, factText, lang);
  if (ln.length >= 2) errs.push(`naam/shabd facts mein nahi hain: ${ln.join(', ')}`);
  const cc = copyCheck(pts.join('\n'), (facts || []).map((f) => f.text));
  if (cc.longest >= 10) errs.push(`facts ki ${cc.longest} shabd ki line seedhi nakal ho gayi: apne shabdon mein likho`);
  return errs.length ? { ok: false, reason: errs.join('; ') } : { ok: true };
}

// ---------- 3) AI prompt (bahut chhota) ----------
function buildPrompt(facts, lang, lastError) {
  const L = lang === 'en' ? 'English' : 'Hindi (Devanagari script)';
  return `You write a short social-media news card in ${L}. Use ONLY the FACTS below (each one was reported by 2 or more news outlets).
Reply EXACTLY in this format and nothing else:
HOOK: <headline, at most 8 words, truthful, no clickbait>
- <point 1: one short sentence, at most 18 words>
- <point 2>
(3 to 5 points)
Rules: write in your own words, never copy a fact word for word. Keep every number and date exactly as in the facts. Do not add any name, number, reason, opinion or prediction that is not in the facts. No quotation marks, no emojis, no markdown.${lastError ? `\nYour previous answer was rejected: ${lastError}. Fix this.` : ''}

FACTS:
${facts.map((f, i) => `${i + 1}. ${f.text}`).join('\n')}`;
}

const TYPE_CAT = { sports: 'Sports', entertainment: 'Entertainment', politics: 'Politics' };
const TYPE_LABEL = { sports: 'खेल', entertainment: 'मनोरंजन', politics: 'राजनीति' };

async function pickImage(env, topic, category) {
  const qs = [stockQuery(topic.query, category), genericQuery(category)].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const q of qs) { const p = await findPexels(env, q, category).catch(() => null); if (p) return p; }
  const c = await findPhoto(topic.query).catch(() => null);
  if (c) return c;
  return (await aiThumbnail(env, { query: topic.query, category }).catch(() => null)) || null; // aakhri raasta
}

// admin ne "Card post banao" dabaya
export async function writeCardPost(env, topicId) {
  const t = await env.DB.prepare('SELECT * FROM topics WHERE id=?').bind(topicId).first();
  if (!t || t.status !== 'carded') return { ok: false, reason: 'Topic card ki halat mein nahi hai (pehle "Card banao" chalao)' };
  let rs = {}; try { rs = JSON.parse(t.research || '{}'); } catch {}
  const facts = (rs.card && rs.card.facts) || [];
  if (facts.length < 2) return { ok: false, reason: 'Card mein facts nahi hain' };
  const lang = env.POST_LANG === 'en' ? 'en' : 'hi';

  let out = null, last = '', model = null;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    const r = await runAI(env, [{ role: 'user', content: buildPrompt(facts, lang, last) }], { max_tokens: 900, temperature: 0.3 });
    if (!r.text) { last = 'AI ne khali jawab diya'; continue; }
    const o = parseCardOutput(r.text); const g = guardCard(o, facts, lang);
    if (g.ok) { out = o; model = r.model; } else last = g.reason;
  }
  if (!out) return { ok: false, reason: 'Card post nahi bana: ' + last };

  const type = classify(t.query).type;
  const category = TYPE_CAT[type] || 'India';
  const img = await pickImage(env, t, category);
  rs.post = {
    hook: out.hook, points: out.points.slice(0, 5), image_url: img ? img.url : '', image_credit: img ? img.credit : '',
    label: TYPE_LABEL[type] || 'ताज़ा खबर', category, outlets: [...new Set(facts.flatMap((f) => f.outlets || []))].slice(0, 4), published_at: now(), model,
  };
  await env.DB.prepare('UPDATE topics SET status=?,research=?,updated_at=? WHERE id=?').bind('card_live', JSON.stringify(rs), now(), t.id).run();
  return { ok: true, id: t.id, hook: out.hook, url: `${env.SITE_URL || ''}/card/${t.id}` };
}

// ---------- 4) DESIGN: thumbnail jaisa card page ----------
const CSS = `*{box-sizing:border-box}body{margin:0;background:#05070f;color:#fff;font-family:'Noto Sans Devanagari','Mukta','Nirmala UI',system-ui,-apple-system,'Segoe UI',sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:12px 12px 28px}
.top{display:flex;justify-content:space-between;align-items:center;padding:4px 2px 10px;font-size:14px}.top a{color:#ffd60a;text-decoration:none;font-weight:800}
.card{position:relative;overflow:hidden;border-radius:22px;background:#0a0f1e center/cover no-repeat;box-shadow:0 12px 40px rgba(0,0,0,.6);min-height:640px;display:flex}
.card.nopic{background:linear-gradient(160deg,#0b3d91 0%,#3a1c71 55%,#d76d77 120%)}
.card:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,7,15,.25) 0%,rgba(5,7,15,.80) 48%,#05070f 100%)}
.in{position:relative;width:100%;padding:18px 16px 14px;display:flex;flex-direction:column;justify-content:flex-end}
.badge{align-self:flex-start;background:#e5173f;color:#fff;font-weight:800;font-size:13px;padding:5px 14px;border-radius:999px;letter-spacing:.3px;box-shadow:0 4px 14px rgba(229,23,63,.5)}
h1{margin:12px 0 14px;font-size:32px;line-height:1.3;font-weight:900;text-shadow:0 2px 10px rgba(0,0,0,.8)}
h1 span{background:#ffd60a;color:#111;padding:0 8px;border-radius:7px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.pt{display:flex;gap:11px;align-items:flex-start;background:rgba(255,255,255,.96);color:#14182b;border-radius:15px;padding:11px 13px;margin:8px 0;font-size:17px;line-height:1.5;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.pt b{flex:none;width:30px;height:30px;border-radius:50%;background:#0b3d91;color:#fff;display:grid;place-items:center;font-size:15px;font-weight:800}
.pt:nth-of-type(2n) b{background:#e5173f}.pt:nth-of-type(3n) b{background:#0a8a4a}
.src{margin-top:10px;font-size:13px;color:#e8ecff;opacity:.95}
.ft{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px}
.brand{background:#ffd60a;color:#111;font-weight:900;padding:7px 14px;border-radius:11px;font-size:15px}
.cta{font-size:13px;font-weight:700;color:#ffd60a}
.act{display:flex;gap:10px;margin:14px 0 6px}.act button,.act a{flex:1;text-align:center;background:#1c2340;color:#fff;border:0;border-radius:12px;padding:12px;font-size:15px;font-weight:700;text-decoration:none;cursor:pointer}
.act .p{background:#ffd60a;color:#111}
.note{font-size:12px;opacity:.7;line-height:1.6;margin:10px 2px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mini{position:relative;display:flex;align-items:flex-end;min-height:230px;border-radius:16px;overflow:hidden;background:#0a0f1e center/cover;color:#fff;text-decoration:none}
.mini.nopic{background:linear-gradient(160deg,#0b3d91,#3a1c71)}.mini:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,7,15,.1),rgba(5,7,15,.9))}
.mini div{position:relative;padding:10px}.mini i{font-style:normal;background:#e5173f;font-size:11px;font-weight:800;padding:2px 9px;border-radius:99px}.mini h2{margin:6px 0 0;font-size:16px;line-height:1.35}
@media (max-width:420px){h1{font-size:27px}.pt{font-size:16px}}`;

const bg = (u) => (/^https:\/\//.test(u || '') ? ` style="background-image:url(&#39;${esc(u)}&#39;)"` : '');
const hookHtml = (hook) => {
  const w = String(hook || '').split(/\s+/).filter(Boolean);
  if (w.length < 4) return `<span>${esc(w.join(' '))}</span>`;
  return `${esc(w.slice(0, -2).join(' '))} <span>${esc(w.slice(-2).join(' '))}</span>`;
};

export function renderCardPage(env, topic, post) {
  const site = env.SITE_URL || '', name = esc(env.SITE_NAME || 'Virall');
  const id = topic && topic.id;
  const hasImg = /^https:\/\//.test(post.image_url || '');
  const url = `${site}/card/${id}`;
  const desc = esc((post.points || [])[0] || post.hook);
  const robots = env.CARD_INDEX === '1' ? 'index,follow' : 'noindex,follow';
  const pts = (post.points || []).map((p, i) => `<div class="pt"><b>${i + 1}</b><span>${esc(p)}</span></div>`).join('');
  return `<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(post.hook)} | ${name}</title><meta name="description" content="${desc}"><meta name="robots" content="${robots}"><link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(post.hook)}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${esc(url)}">${hasImg ? `<meta property="og:image" content="${esc(post.image_url)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<style>${CSS}</style></head><body><div class="wrap">
<div class="top"><a href="/">${name}</a><a href="/cards">सभी कार्ड →</a></div>
<div class="card${hasImg ? '' : ' nopic'}"${hasImg ? bg(post.image_url) : ''}><div class="in">
<span class="badge">${esc(post.label || 'ताज़ा खबर')}</span>
<h1>${hookHtml(post.hook)}</h1>${pts}
<div class="src">स्रोत: ${esc((post.outlets || []).join(', '))}</div>
<div class="ft"><span class="brand">${name}</span><span class="cta">रोज़ की ताज़ा खबरों के लिए फॉलो करें</span></div>
</div></div>
<div class="act"><button class="p" onclick="if(navigator.share){navigator.share({title:document.title,url:location.href})}else{navigator.clipboard&&navigator.clipboard.writeText(location.href);this.textContent='लिंक कॉपी हो गया'}">शेयर करें</button><a href="/cards">और कार्ड देखें</a></div>
<p class="note">${post.image_credit ? `फोटो: ${esc(post.image_credit)}. ` : ''}यह कार्ड सार्वजनिक समाचार स्रोतों की जानकारी का सार है।</p>
</div></body></html>`;
}

export function renderCardsList(env, rows) {
  const name = esc(env.SITE_NAME || 'Virall');
  const items = (rows || []).map((r) => {
    const p = r.post || {}; const hasImg = /^https:\/\//.test(p.image_url || '');
    return `<a class="mini${hasImg ? '' : ' nopic'}" href="/card/${Number(r.id)}"${hasImg ? bg(p.image_url) : ''}><div><i>${esc(p.label || 'ताज़ा खबर')}</i><h2>${esc(p.hook)}</h2></div></a>`;
  }).join('');
  return `<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>कार्ड | ${name}</title><meta name="robots" content="noindex,follow"><style>${CSS}</style></head><body><div class="wrap"><div class="top"><a href="/">${name}</a><span>ताज़ा कार्ड</span></div><div class="grid">${items || '<p class="note">अभी कोई कार्ड नहीं है।</p>'}</div></div></body></html>`;
}
