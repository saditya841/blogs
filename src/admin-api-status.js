// Add this to your admin panel (index.js) to show API status

// NEW ROUTE: API Status Dashboard
export async function handleAPIStatus(env) {
  const { MultiAPIManager } = await import('./multi-api-manager.js');
  const manager = new MultiAPIManager(env);
  const status = await manager.getStatus();

  const html = `<!DOCTYPE html>
<html lang="hi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Status - Virall Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { background: #1e40af; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .header h1 { font-size: 24px; margin-bottom: 5px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; }
    .card-title { font-size: 18px; font-weight: 600; }
    .status-badge { padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .status-available { background: #dcfce7; color: #166534; }
    .status-unavailable { background: #fee2e2; color: #991b1b; }
    .status-no-key { background: #fef3c7; color: #92400e; }
    .stats { margin-top: 15px; }
    .stat-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
    .stat-label { color: #666; font-size: 14px; }
    .stat-value { font-weight: 600; color: #333; }
    .back-link { display: inline-block; color: white; text-decoration: none; margin-top: 10px; opacity: 0.9; }
    .back-link:hover { opacity: 1; }
    .summary { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-top: 15px; }
    .summary-item { text-align: center; }
    .summary-value { font-size: 32px; font-weight: 700; color: #1e40af; }
    .summary-label { font-size: 14px; color: #666; margin-top: 5px; }
    .refresh-btn { background: #1e40af; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; }
    .refresh-btn:hover { background: #1e3a8a; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔄 Multi-API Status Dashboard</h1>
      <p>Real-time monitoring of all AI API providers</p>
      <a href="/admin" class="back-link">← Back to Admin</a>
    </div>

    <div class="summary">
      <h2 style="margin-bottom: 10px;">Today's Usage Summary</h2>
      <div class="summary-grid">
        ${Object.entries(status).map(([key, api]) => `
          <div class="summary-item">
            <div class="summary-value">${api.requests}</div>
            <div class="summary-label">${api.name}<br>Requests</div>
          </div>
        `).join('')}
      </div>
      <div style="text-align: center; margin-top: 20px;">
        <button class="refresh-btn" onclick="location.reload()">🔄 Refresh Status</button>
      </div>
    </div>

    <div class="grid">
      ${Object.entries(status).map(([key, api]) => {
        let statusClass = 'status-available';
        let statusText = '✓ Available';

        if (!api.hasApiKey) {
          statusClass = 'status-no-key';
          statusText = '⚠ No API Key';
        } else if (!api.available) {
          statusClass = 'status-unavailable';
          statusText = '✗ ' + (api.reason || 'Unavailable');
        }

        return `
          <div class="card">
            <div class="card-header">
              <div class="card-title">${api.name}</div>
              <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            <div class="stats">
              <div class="stat-row">
                <span class="stat-label">Requests Today</span>
                <span class="stat-value">${api.requests.toLocaleString()}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Tokens Used</span>
                <span class="stat-value">${api.tokens.toLocaleString()}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Daily Limit</span>
                <span class="stat-value">${typeof api.limit === 'number' ? api.limit.toLocaleString() : api.limit}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">API Key</span>
                <span class="stat-value">${api.hasApiKey ? '✓ Configured' : '✗ Missing'}</span>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div style="text-align: center; margin-top: 30px; color: #666; font-size: 14px;">
      <p>Last updated: ${new Date().toLocaleString('hi-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
      <p style="margin-top: 10px;">API rotation: Groq → Gemini → Hugging Face → Cohere → Cloudflare Workers AI (fallback)</p>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
