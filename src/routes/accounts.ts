import { Hono } from 'hono';
import { badRequest, notFound, ok } from '../core/http.js';
import { isValidEmail, maskToken } from '../core/validate.js';
import type { AccountRow, AccountWithGroup } from '../db/repo/types.js';
import { refreshAccountToken } from '../services/account.js';
import type { AppEnv } from '../types.js';

const accounts = new Hono<AppEnv>();

// Public shape of an account: secrets are masked on the way out.
function safeAccount(acc: AccountRow) {
  return {
    id: acc.id,
    email: acc.email,
    client_id: maskToken(acc.client_id),
    refresh_token: maskToken(acc.refresh_token),
    group_id: acc.group_id,
    remark: acc.remark,
    status: acc.status,
    last_refreshed_at: acc.last_refreshed_at,
    refresh_fail_count: acc.refresh_fail_count,
    created_at: acc.created_at,
    updated_at: acc.updated_at,
  };
}

accounts.get('/', (c) => {
  const rows = c.env.repo.accounts.list({
    groupId: c.req.query('group_id') ? Number(c.req.query('group_id')) : undefined,
    keyword: c.req.query('keyword') || undefined,
    tagId: c.req.query('tag_id') ? Number(c.req.query('tag_id')) : undefined,
  });
  const tags = c.env.repo.tags.forAccounts(rows.map((r) => r.id));

  const data = rows.map((r: AccountWithGroup) => ({
    ...safeAccount(r),
    group_name: r.group_name ?? '默认分组',
    group_color: r.group_color ?? '#2563eb',
    tags: tags.get(r.id) ?? [],
  }));
  return ok(data);
});

accounts.post('/', async (c) => {
  const { repo } = c.env;
  const body = (await c.req.json().catch(() => ({}))) as {
    account_string?: string;
    email?: string;
    client_id?: string;
    refresh_token?: string;
    password?: string;
    group_id?: number;
    remark?: string;
  };
  const groupId = body.group_id ?? 1;

  if (body.account_string) {
    const rows = body.account_string
      .split('\n')
      .map((line) => {
        const parts = line.trim().split('----');
        if (parts.length < 4) return null;
        const [email, password, clientId, refreshToken] = parts.map((p) => p.trim());
        return email && clientId && refreshToken
          ? { email, password: password ?? '', client_id: clientId, refresh_token: refreshToken }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (!rows.length) return badRequest('没有解析到有效账号（格式：邮箱----密码----client_id----refresh_token）');
    const added = repo.accounts.createBulk(rows, groupId);
    return added > 0 ? ok({ added }, `成功添加 ${added} 个账号`) : badRequest('没有新账号被添加（可能已存在）');
  }

  const email = body.email?.trim();
  const clientId = body.client_id?.trim();
  const refreshToken = body.refresh_token?.trim();
  if (!email || !clientId || !refreshToken) return badRequest('邮箱、Client ID 和 Refresh Token 不能为空');
  if (!isValidEmail(email)) return badRequest('邮箱格式不正确');

  try {
    const id = repo.accounts.create({
      email,
      client_id: clientId,
      refresh_token: refreshToken,
      password: body.password ?? '',
      group_id: groupId,
      remark: body.remark ?? '',
    });
    return ok({ id }, '账号添加成功');
  } catch {
    return badRequest('邮箱已存在');
  }
});

// Declared before /:id so "export" is not captured as an id.
accounts.get('/export', (c) => {
  const groupId = c.req.query('group_id') ? Number(c.req.query('group_id')) : undefined;
  const idsParam = c.req.query('ids');

  let rows: AccountRow[];
  if (idsParam) {
    const ids = idsParam
      .split(',')
      .map((s) => Number.parseInt(s, 10))
      .filter(Number.isInteger);
    rows = ids
      .map((id) => c.env.repo.accounts.get(id))
      .filter((a): a is AccountRow => a !== null)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  } else {
    rows = c.env.repo.accounts
      .list({ groupId })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }

  const content = rows
    .map((r) => `${r.email}----${r.password || ''}----${r.client_id}----${r.refresh_token}`)
    .join('\n');
  return ok({ content, count: rows.length });
});

accounts.post('/batch', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    action?: string;
    ids?: number[];
    group_id?: number;
  };
  if (!body.ids?.length) return badRequest('请选择账号');

  const actions: Record<string, 'delete' | 'move' | 'enable' | 'disable'> = {
    delete: 'delete',
    move: 'move',
    enable: 'enable',
    disable: 'disable',
  };
  const action = body.action ? actions[body.action] : undefined;
  if (!action) return badRequest('未知操作');
  if (action === 'move' && body.group_id === undefined) return badRequest('缺少目标分组');

  c.env.repo.accounts.batch(body.ids, action, body.group_id);
  const labels = { delete: '删除', move: '移动', enable: '启用', disable: '停用' };
  return ok(null, `已${labels[action]} ${body.ids.length} 个账号`);
});

accounts.get('/:id', (c) => {
  const id = Number(c.req.param('id'));
  const acc = c.env.repo.accounts.get(id);
  if (!acc) return notFound('账号不存在');
  const tags = c.env.repo.tags.forAccount(id);

  const group = c.env.repo.groups.get(acc.group_id);
  return ok({
    ...acc,
    refresh_token: maskToken(acc.refresh_token),
    group_name: group?.name ?? '默认分组',
    group_color: group?.color ?? '#2563eb',
    tags,
    tag_ids: tags.map((t) => t.id),
  });
});

accounts.put('/:id', async (c) => {
  const { repo } = c.env;
  const id = Number(c.req.param('id'));
  const existing = repo.accounts.get(id);
  if (!existing) return notFound('账号不存在');

  const body = (await c.req.json().catch(() => ({}))) as Partial<{
    email: string;
    client_id: string;
    refresh_token: string;
    password: string;
    group_id: number;
    remark: string;
    status: string;
    tag_ids: number[];
  }>;

  if (Array.isArray(body.tag_ids)) {
    repo.tags.setForAccount(id, body.tag_ids.filter(Number.isInteger));
    if (Object.keys(body).length === 1) return ok(null, '标签已更新');
  }

  if (body.status && Object.keys(body).length === 1) {
    repo.accounts.update(id, { status: body.status });
    return ok(null, '状态更新成功');
  }

  const email = body.email?.trim() ?? existing.email;
  const clientId = body.client_id?.trim() ?? existing.client_id;
  const refreshToken = body.refresh_token?.trim() ?? existing.refresh_token;
  if (!email || !clientId || !refreshToken) return badRequest('邮箱、Client ID 和 Refresh Token 不能为空');
  if (!isValidEmail(email)) return badRequest('邮箱格式不正确');

  // A freshly supplied refresh_token clears a stale 'error' verdict; a deliberate
  // 'disabled' is never auto-revived.
  const status =
    body.status ?? (body.refresh_token?.trim() && existing.status === 'error' ? 'active' : existing.status);

  try {
    repo.accounts.update(id, {
      email,
      client_id: clientId,
      refresh_token: refreshToken,
      password: body.password ?? existing.password,
      group_id: body.group_id ?? existing.group_id,
      remark: body.remark ?? existing.remark,
      status,
    });
    return ok(null, '账号更新成功');
  } catch {
    return badRequest('更新失败，邮箱可能已存在');
  }
});

accounts.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!c.env.repo.accounts.get(id)) return notFound('账号不存在');
  c.env.repo.accounts.remove(id);
  return ok(null, '账号已删除');
});

accounts.post('/:id/test', async (c) => {
  const id = Number(c.req.param('id'));
  const acc = c.env.repo.accounts.get(id);
  if (!acc) return notFound('账号不存在');

  const result = await refreshAccountToken(c.env.repo, acc);
  if (result.token) return ok({ connected: true }, 'Graph API 连接正常');
  return ok({ connected: false, error: result.error }, 'Graph API 连接失败');
});

export default accounts;
