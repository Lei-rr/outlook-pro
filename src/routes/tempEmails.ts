import { Hono, type Context } from 'hono';
import { badRequest, notFound, ok } from '../core/http.js';
import { generateTempEmail, getTempMessage, listTempMessages } from '../services/gptmail.js';
import type { AppEnv } from '../types.js';

const tempEmails = new Hono<AppEnv>();

const apiKey = (c: Context<AppEnv>) =>
  c.env.repo.settings.get('gptmail_api_key') || c.env.config.gptmailApiKey;

tempEmails.get('/', (c) => ok(c.env.repo.tempEmails.list()));

tempEmails.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { prefix?: string; domain?: string };
  const result = await generateTempEmail(
    apiKey(c),
    body.prefix || body.domain ? { prefix: body.prefix, domain: body.domain } : undefined
  );
  if (!result.email) return badRequest(result.error ?? '生成临时邮箱失败');

  try {
    c.env.repo.tempEmails.create(result.email, 'gptmail');
  } catch {
    return badRequest('邮箱已存在');
  }
  return ok({ email: result.email }, '临时邮箱创建成功');
});

tempEmails.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!c.env.repo.tempEmails.get(id)) return notFound('临时邮箱不存在');
  c.env.repo.tempEmails.remove(id);
  return ok(null, '临时邮箱已删除');
});

tempEmails.get('/:id/messages', async (c) => {
  const record = c.env.repo.tempEmails.get(Number(c.req.param('id')));
  if (!record) return notFound('临时邮箱不存在');

  const result = await listTempMessages(apiKey(c), record.email);
  if (result.error) return ok({ emails: [], error: result.error });

  const emails = (result.emails ?? []).map((m) => ({
    id: m.id,
    from: m.from_address ?? '未知',
    subject: m.subject ?? '无主题',
    body_preview: typeof m.content === 'string' ? m.content.slice(0, 200) : '',
    timestamp: m.timestamp ?? 0,
    has_html: Boolean(m.has_html),
  }));
  return ok({ emails, count: emails.length });
});

tempEmails.get('/:id/messages/:messageId', async (c) => {
  const record = c.env.repo.tempEmails.get(Number(c.req.param('id')));
  if (!record) return notFound('临时邮箱不存在');

  const result = await getTempMessage(apiKey(c), c.req.param('messageId'));
  if (!result.message) return notFound('邮件不存在');

  const m = result.message;
  return ok({
    id: m.id,
    from: m.from_address ?? '未知',
    to: record.email,
    subject: m.subject ?? '无主题',
    body: m.html_content ?? m.content ?? '',
    body_type: m.has_html ? 'html' : 'text',
    timestamp: m.timestamp ?? 0,
  });
});

export default tempEmails;
