import { Hono } from 'hono';
import { badRequest, ok } from '../core/http.js';
import { baseUrl } from '../core/request.js';
import { authMiddleware } from '../middleware/auth.js';
import { buildAuthorizeUrl, DEFAULT_CLIENT_ID, exchangeCode } from '../services/oauth.js';
import type { AppEnv } from '../types.js';

const oauth = new Hono<AppEnv>();

// GET /api/oauth/authorize — returns the Microsoft consent URL for a popup.
oauth.get('/authorize', authMiddleware(), (c) => {
  const clientId = c.req.query('client_id') || DEFAULT_CLIENT_ID;
  const loginHint = c.req.query('login_hint') || '';
  const redirectUri = `${baseUrl(c)}/api/oauth/callback`;
  return ok({ url: buildAuthorizeUrl({ clientId, redirectUri, loginHint }), client_id: clientId });
});

// POST /api/oauth/exchange — manual flow using the https://localhost redirect
// registered for the Thunderbird public client, so no Azure app is needed.
oauth.post('/exchange', authMiddleware(), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string;
    client_id?: string;
    redirect_uri?: string;
  };
  const code = body.code?.trim();
  if (!code) return badRequest('请提供授权码 code');

  const clientId = body.client_id?.trim() || DEFAULT_CLIENT_ID;
  const redirectUri = body.redirect_uri?.trim() || 'https://localhost';

  const result = await exchangeCode({ code, clientId, redirectUri });
  if (result.error) return badRequest(`换取令牌失败: ${result.error}`);
  return ok({ client_id: clientId, refresh_token: result.refreshToken });
});

// GET /api/oauth/callback — Microsoft redirects here; page posts the result back
// to the opener. Public (the browser may not carry the session cookie).
oauth.get('/callback', async (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');
  const errorDesc = c.req.query('error_description');

  if (error) return c.html(callbackPage(false, `授权失败: ${errorDesc || error}`));
  if (!code) return c.html(callbackPage(false, '未收到授权码'));

  const clientId = c.req.query('state') || DEFAULT_CLIENT_ID;
  const redirectUri = `${baseUrl(c)}/api/oauth/callback`;
  const result = await exchangeCode({ code, clientId, redirectUri });

  if (result.error || !result.refreshToken) {
    return c.html(callbackPage(false, `换取令牌失败: ${result.error ?? '未知错误'}`));
  }
  return c.html(callbackPage(true, '', { client_id: clientId, refresh_token: result.refreshToken }));
});

function callbackPage(
  success: boolean,
  error: string,
  data?: { client_id: string; refresh_token: string }
): string {
  const result = { success, data: data ?? null, error };
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OAuth 授权</title>
<style>
  body { font-family: -apple-system, sans-serif; background:#0f172a; color:#e2e8f0; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .card { background:#1e293b; border:1px solid #334155; border-radius:12px; padding:32px; max-width:500px; text-align:center; }
  .success { color:#22c55e; } .error { color:#ef4444; }
  p { color:#94a3b8; font-size:14px; }
</style></head>
<body><div class="card">
  ${success ? '<h2 class="success">授权成功！</h2><p>正在自动填入账号信息，请稍候...</p>' : `<h2 class="error">授权失败</h2><p>${error}</p><p>你可以关闭此窗口重试。</p>`}
</div>
<script>
  var result = ${JSON.stringify(result)};
  if (window.opener) {
    window.opener.postMessage({ type: 'oauth-callback', ...result }, location.origin);
    setTimeout(function () { window.close(); }, 1500);
  }
</script>
</body></html>`;
}

export default oauth;
