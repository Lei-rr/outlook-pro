import { Hono } from 'hono';
import { fail, ok } from '../core/http.js';
import { intParam } from '../core/validate.js';
import { refreshAccountToken } from '../services/account.js';
import { fetchEmails } from '../services/graph.js';
import type { AppEnv } from '../types.js';

// External API: read mail by API key, no login. Mounted before the cookie
// middleware in app.ts so it is not gated by sessions.
const external = new Hono<AppEnv>();

external.use('*', async (c, next) => {
  const configured = c.env.repo.settings.get('external_api_key');
  if (!configured) return fail('API_DISABLED', '对外 API 未启用：请在系统设置生成 API Key', 403);

  const provided = c.req.header('X-API-Key') || c.req.query('key') || '';
  if (provided !== configured) return fail('UNAUTHORIZED', 'API Key 无效', 401);
  await next();
});

external.get('/emails', async (c) => {
  const email = (c.req.query('email') || '').trim().toLowerCase();
  if (!email) return fail('BAD_REQUEST', '缺少 email 参数', 400);

  const folder = c.req.query('folder') || 'inbox';
  const top = intParam(c.req.query('top'), 10, 1, 50);
  const keyword = c.req.query('keyword') || undefined;
  const includeBody = ['1', 'true'].includes((c.req.query('includeBody') || '').toLowerCase());

  const acc = c.env.repo.accounts.getByEmail(email);
  if (!acc) return fail('NOT_FOUND', '账号不存在', 404);
  if (acc.status === 'disabled') return fail('DISABLED', '该账号已停用', 400);

  const auth = await refreshAccountToken(c.env.repo, acc);
  if (!auth.token) return fail('TOKEN_FAILED', auth.error ?? 'Token 获取失败', 502);

  const result = await fetchEmails(auth.token, { folder, top, skip: 0, keyword, includeBody });
  if (result.error) return fail('GRAPH_ERROR', result.error.message, 502);

  const items = (result.items ?? []).map((e) => ({
    id: e.id,
    subject: e.subject ?? '(无主题)',
    from: { name: e.from?.emailAddress?.name ?? '', address: e.from?.emailAddress?.address ?? '' },
    receivedDateTime: e.receivedDateTime,
    bodyPreview: e.bodyPreview ?? '',
    ...(includeBody ? { body: e.body?.content ?? '' } : {}),
    isRead: e.isRead,
  }));
  return ok({ email, folder, count: items.length, items });
});

export default external;
