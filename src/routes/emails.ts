import { Hono, type Context } from 'hono';
import { mapLimit } from '../core/async.js';
import { badRequest, notFound, ok } from '../core/http.js';
import { intParam } from '../core/validate.js';
import { refreshAccountToken } from '../services/account.js';
import {
  deleteEmail,
  fetchEmailDetail,
  fetchEmails,
  getAttachment,
  listAttachments,
  type MailAddress,
} from '../services/graph.js';
import type { AppEnv } from '../types.js';

const emails = new Hono<AppEnv>();

const MAX_BATCH_DELETE = 100;
const DELETE_CONCURRENCY = 10;

function addr(a: MailAddress | undefined): { name: string; address: string } {
  return { name: a?.emailAddress?.name ?? '', address: a?.emailAddress?.address ?? '未知' };
}

// Load the account and get a live token; on failure the response is already built.
async function withToken(c: Context<AppEnv>) {
  const accountId = Number(c.req.param('id'));
  const acc = c.env.repo.accounts.get(accountId);
  if (!acc) return { error: notFound('账号不存在') as Response };
  if (acc.status === 'disabled') return { error: badRequest('该账号已停用') as Response };

  const result = await refreshAccountToken(c.env.repo, acc);
  if (!result.token) return { error: badRequest(result.error ?? 'Graph API 认证失败') as Response };
  return { account: acc, token: result.token };
}

// GET /api/accounts/:id/emails
emails.get('/', async (c) => {
  const ctx = await withToken(c);
  if ('error' in ctx) return ctx.error;

  const folder = c.req.query('folder') ?? 'inbox';
  const top = intParam(c.req.query('top'), 20, 1, 50);
  const skip = intParam(c.req.query('skip'), 0, 0, 100_000);
  const keyword = c.req.query('keyword') || undefined;

  const result = await fetchEmails(ctx.token, { folder, top, skip, keyword });
  if (result.error) return ok({ items: [], error: result.error.message }, '获取邮件失败');

  const items = (result.items ?? []).map((e) => ({
    id: e.id,
    subject: e.subject ?? '(无主题)',
    from: addr(e.from),
    receivedDateTime: e.receivedDateTime,
    bodyPreview: e.bodyPreview ?? '',
    isRead: e.isRead,
    hasAttachments: e.hasAttachments,
  }));
  return ok({ items, total: items.length });
});

// GET /api/accounts/:id/emails/:messageId
emails.get('/:messageId', async (c) => {
  const ctx = await withToken(c);
  if ('error' in ctx) return ctx.error;

  const result = await fetchEmailDetail(ctx.token, c.req.param('messageId'));
  if (result.error) {
    return result.error.code === 'NOT_FOUND' ? notFound('邮件不存在') : badRequest(result.error.message);
  }
  const e = result.item!;
  return ok({
    id: e.id,
    subject: e.subject ?? '(无主题)',
    from: addr(e.from),
    toRecipients: (e.toRecipients ?? []).map(addr),
    ccRecipients: (e.ccRecipients ?? []).map(addr),
    receivedDateTime: e.receivedDateTime,
    body: e.body,
    bodyPreview: e.bodyPreview ?? '',
    isRead: e.isRead,
    hasAttachments: e.hasAttachments,
  });
});

// GET /api/accounts/:id/emails/:messageId/attachments
emails.get('/:messageId/attachments', async (c) => {
  const ctx = await withToken(c);
  if ('error' in ctx) return ctx.error;

  const result = await listAttachments(ctx.token, c.req.param('messageId'));
  if (result.error) return badRequest(result.error.message);
  const items = (result.items ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    contentType: a.contentType,
    size: a.size,
  }));
  return ok({ items });
});

// GET /api/accounts/:id/emails/:messageId/attachments/:attId
emails.get('/:messageId/attachments/:attId', async (c) => {
  const ctx = await withToken(c);
  if ('error' in ctx) return ctx.error;

  const result = await getAttachment(ctx.token, c.req.param('messageId'), c.req.param('attId'));
  if (result.error) {
    return result.error.code === 'NOT_FOUND' ? notFound('附件不存在') : badRequest(result.error.message);
  }
  const att = result.attachment!;
  if (!att.contentBytes) return badRequest('该附件不是文件附件，无法下载');

  const bytes = Buffer.from(att.contentBytes, 'base64');
  return new Response(bytes, {
    headers: {
      'Content-Type': att.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`,
    },
  });
});

// POST /api/accounts/:id/emails/batch-delete  body: { ids: string[] }
emails.post('/batch-delete', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = (body.ids ?? []).filter((x): x is string => typeof x === 'string');
  if (!ids.length) return badRequest('请选择要删除的邮件');

  const ctx = await withToken(c);
  if ('error' in ctx) return ctx.error;

  const targets = ids.slice(0, MAX_BATCH_DELETE);
  const results = await mapLimit(targets, DELETE_CONCURRENCY, (id) => deleteEmail(ctx.token, id));
  const deleted = results.filter((r) => r.ok).length;
  const failed = targets.length - deleted;
  const skipped = ids.length - targets.length;
  const forbidden = results.some((r) => r.error?.code === 'FORBIDDEN');

  let msg = `已删除 ${deleted} 封`;
  if (failed) msg += `，失败 ${failed} 封`;
  if (skipped) msg += `，超出单次上限未处理 ${skipped} 封（请分批）`;
  if (forbidden) msg += '。该账号为只读授权，请重新授权以获取读写权限';
  return ok({ deleted, failed, skipped }, msg);
});

// DELETE /api/accounts/:id/emails/:messageId
emails.delete('/:messageId', async (c) => {
  const ctx = await withToken(c);
  if ('error' in ctx) return ctx.error;

  const result = await deleteEmail(ctx.token, c.req.param('messageId'));
  if (!result.ok) {
    return result.error?.code === 'NOT_FOUND' ? notFound('邮件不存在') : badRequest(result.error?.message ?? '删除失败');
  }
  return ok(null, '已删除');
});

export default emails;
