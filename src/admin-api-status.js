// Admin: AI provider status dashboard.
// Shows which optional API keys reached the Worker, plus the built-in Cloudflare Workers AI fallback.
// Important: a missing external key does NOT break the site - Workers AI is the free built-in fallback.

const KEY_NAMES = {
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  huggingface: 'HUGGINGFACE_API_KEY',
  cohere: 'COHERE_API_KEY'
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function handleAPIStatus(env) {
  const { MultiAPIManager } = await import('./multi-api-manager.js');
  const manager = new MultiAPIManager(env);
  const status = await manager.getStatus();
  const hasWorkersAI = !!env.AI;
  const aiModel = env.AI_MODEL || '(default)';
  const multiOn = String(env.USE_MULTI_API || '') === 'true';

  const cards = Object.entries(status).map(([key, api]) => {
    let statusClass = 'status-available';
    let statusText = 'Available';
    if (!api.hasApiKey) {
      statusClass = 'status-no-key';
      statusText = 'No API Key (optional)';
    } else if (!api.available) {
      statusClass = 'status-unavailable';
      statusText = api.reason || 'Unavailable';
    }
    return `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${esc(api.name)}</div>
          <span class="status-badge ${statusClass}">${esc(statusText)}</span>
        </div>
        <div class="stats">
          <div class="stat-row"><span class="stat-label">Secret name</span><span class="stat-value"><code>${esc(KEY_NAMES[key] || key)}</code></span></div>
          <div class="stat-row"><span class="stat-label">Requests Today</span><span class="stat-value">${Number(api.requests || 0).toLocaleString()}</span></div>
          <div class="stat-row"><span class="stat-label">Tokens Used</span><span class="stat-value">${Number(api.tokens || 0).toLocaleString()}</span></div>
          <div class="stat-row"><span class="stat-label">Daily Limit</span><span class="stat-value">${typeof api.limit === 'number' ? api.limit.toLocaleString() : esc(api.limit)}</span></div>
          <div class="stat-row"><span class="stat-label">API Key</span><span class="stat-value">${api.hasApiKey ? 'Configured' : 'Missing'}</span></div>
        </div>
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>AI Status - Virall Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; padding: 20px; color: #111; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: #1e40af; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .header h1 { font-size: 24px; margin-bottom: 5px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .back-link { display: inline-block; color: white; text-decoration: none; margin-top: 10px; opacity: 0.9; }
    .note { background: #fff8e1; border: 1px solid #f1e0a0; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; font-size: 14px; line-height: 1.6; }
    .note b { color: #7a4b00; }
    .summary { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.06); }
    .summary h2 { font-size: 18px; margin-bottom: 12px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; }
    .summary-item { text-align: center; padding: 12px; background: #f8fafc; border-radius: 8px; }
    .summary-value { font-size: 22px; font-weight: 700; color: #1e40af; word-break: break-word; }
    .summary-label { font-size: 13px; color: #666; margin-top: 5px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.08); }
    .card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 15px; }
    .card-title { font-size: 18px; font-weight: 600; }
    .status-badge { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .status-available { background: #dcfce7; color: #166534; }
    .status-unavailable { background: #fee2e2; color: #991b1b; }
    .status-no-key { background: #fef3c7; color: #92400e; }
    .stats { margin-top: 10px; }
    .stat-row { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .stat-label { color: #666; }
    .stat-value { font-weight: 600; text-align: right; }
    code { background: #eef2ff; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
    .cta { display: inline-block; margin-top: 16px; padding: 10px 16px; border-radius: 6px; background: #1e40af; color: #fff; text-decoration: none; font-size: 14px; }
    .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; line-height: 1.8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>AI Status</h1>
      <p>Kaun sa AI provider chal raha hai, kaun sa nahi - ek nazar me.</p>
      <a href="/admin" class="back-link">&larr; Back to Admin</a>
    </div>

    <div class="note">
      <b>No API Key ka matlab site kharab nahi hai.</b> Neeche wale Groq / Gemini / Hugging Face / Cohere
      optional hain. Inki key na ho to Worker seedha <b>Cloudflare Workers AI</b> se likhta hai - wo free hai
      aur alag key nahi maangta. Key add karni ho to Cloudflare - Workers &amp; Pages - blogs - Settings -
      Variables and Secrets me <b>Secret</b> ke roop me add karo, phir <b>Deploy</b> dabao. Naam bilkul
      <code>GROQ_API_KEY</code> jaisa hi rakhna (underscore, hyphen nahi).
    </div>

    <div class="summary">
      <h2>System Summary</h2>
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-value">${hasWorkersAI ? 'Ready' : 'Missing'}</div>
          <div class="summary-label">Cloudflare Workers AI (built-in)</div>
        </div>
        <div class="summary-item">
          <div class="summary-value" style="font-size:15px">${esc(aiModel)}</div>
          <div class="summary-label">AI_MODEL</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${multiOn ? 'ON' : 'OFF'}</div>
          <div class="summary-label">USE_MULTI_API</div>
        </div>
        <div class="summary-item">
          <div class="summary-value">${Object.values(status).filter((a) => a.hasApiKey).length}/${Object.keys(status).length}</div>
          <div class="summary-label">External keys configured</div>
        </div>
      </div>
      <a class="cta" href="/admin/ai-test">Abhi AI test chalao</a>
    </div>

    <div class="grid">${cards}</div>

    <div class="footer">
      <p>Last updated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
      <p>Order: Groq &rarr; Gemini &rarr; Hugging Face &rarr; Cohere &rarr; Cloudflare Workers AI (fallback)</p>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
