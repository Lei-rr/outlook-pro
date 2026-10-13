import { Hono } from 'hono';
import { badRequest, notFound, ok } from '../core/http.js';
import type { AppEnv } from '../types.js';

const tags = new Hono<AppEnv>();

tags.get('/', (c) => ok(c.env.repo.tags.list()));

tags.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; color?: string };
  const name = body.name?.trim();
  if (!name) return badRequest('标签名不能为空');
  try {
    c.env.repo.tags.create({ name, color: body.color?.trim() || undefined });
    return ok(null, '标签已创建');
  } catch {
    return badRequest('创建失败，标签名可能已存在');
  }
});

tags.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = c.env.repo.tags.get(id);
  if (!existing) return notFound('标签不存在');

  const body = (await c.req.json().catch(() => ({}))) as { name?: string; color?: string };
  const name = body.name?.trim() ?? existing.name;
  const color = body.color?.trim() ?? existing.color;
  if (!name) return badRequest('标签名不能为空');

  try {
    c.env.repo.tags.update(id, { name, color });
    return ok(null, '标签已更新');
  } catch {
    return badRequest('更新失败，标签名可能已存在');
  }
});

tags.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (!c.env.repo.tags.get(id)) return notFound('标签不存在');
  c.env.repo.tags.remove(id);
  return ok(null, '标签已删除');
});

export default tags;
