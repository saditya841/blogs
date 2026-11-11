// sourcecheck.js — ZERO-token publish-time source liveness check.
//
// A draft can sit in review for hours. By approval time one of its sources may be 404/410.
// This module fetches up to `max` source URLs in parallel with a hard timeout and reports:
//   ok      -> 2xx/3xx
//   dead    -> 404 / 410 / 451 (the page is really gone)
//   unknown -> 401/403/405/429/timeout (site blocks bots; do not punish the article)
//
// It never throws. `opts.fetch` is injectable for tests.

export const isHttp = (u) => /^https?:\/\/\S+$/i.test(String(u || ''));

export async function checkUrl(url, opts = {}) {
  const out = { url: String(url || ''), status: 0, ok: false, dead: false, unknown: false, error: '' };
  if (!isHttp(url)) { out.error = 'invalid url'; out.unknown = true; return out; }

  const f = opts.fetch || fetch;
  const timeoutMs = Math.max(500, Number(opts.timeoutMs ?? 3000) || 3000);
  let timer = null;
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctrl) timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, timeoutMs);
    const res = await f(url, {
      method: opts.method || 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'VirallBot/1.0 (+https://virall.in)', Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      signal: ctrl ? ctrl.signal : undefined
    });
    const status = Number(res && res.status) || 0;
    out.status = status;
    out.ok = status >= 200 && status < 400;
    out.dead = [404, 410, 451].includes(status);
    out.unknown = [0, 401, 403, 405, 406, 429, 999].includes(status);
    return out;
  } catch (e) {
    out.status = 0;
    out.unknown = true;
    out.error = String((e && e.message) || e).slice(0, 120);
    return out;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// sources = [{ url, title, source }] or plain URL strings.
export async function recheckSources(sources, opts = {}) {
  const max = Math.max(1, Math.min(6, Number(opts.max ?? 3)));
  const urls = [...new Set(
    (sources || [])
      .map((s) => (typeof s === 'string' ? s : s && s.url))
      .filter(isHttp)
  )].slice(0, max);

  if (!urls.length) return { checked: 0, results: [], ok: false, dead: [], unknown: [], reason: 'Koi http source nahi' };

  const results = await Promise.all(urls.map((u) => checkUrl(u, opts)));
  const dead = results.filter((r) => r.dead).map((r) => r.url);
  const unknown = results.filter((r) => r.unknown).map((r) => r.url);
  const okCount = results.filter((r) => r.ok).length;
  return {
    checked: results.length,
    results,
    okCount,
    ok: dead.length === 0 && okCount > 0,
    dead,
    unknown,
    reason: dead.length ? `${dead.length} source link dead hai` : (okCount ? '' : 'Source status verify nahi ho paya')
  };
}
