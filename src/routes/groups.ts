import { Hono } from 'hono';
import { badRequest, notFound, ok } from '../core/http.js';
import type { AppEnv } from '../types.js';

const groups = new Hono<AppEnv>();

groups.get('/', (c) => ok(c.env.repo.groups.list()));

groups.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string; description?: string; color?: string };
  const name = body.name?.trim();
  if (!name) return badRequest('分组名称不能为空');
  try {
    const id = c.env.repo.groups.create({ name, description: body.description, color: body.color });
    return ok({ id }, '分组创建成功');
  } catch {
    return badRequest('分组名称已存在');
  }
});

groups.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const existing = c.env.repo.groups.get(id);
  if (!existing) return notFound('分组不存在');

  const body = (await c.req.json().catch(() => ({}))) as { name?: string; description?: string; color?: string };
  const name = body.name?.trim();
  if (!name) return badRequest('分组名称不能为空');

  try {
    c.env.repo.groups.update(id, {
      name,
      description: body.description ?? existing.description,
      color: body.color ?? existing.color,
    });
    return ok(null, '分组更新成功');
  } catch {
    return badRequest('分组名称已存在');
  }
});

groups.delete('/:id', (c) => {
  const id = Number(c.req.param('id'));
  if (id === 1) return badRequest('默认分组不能删除');
  if (!c.env.repo.groups.get(id)) return notFound('分组不存在');

  c.env.repo.groups.remove(id);
  return ok(null, '分组已删除，邮箱已移至默认分组');
});

export default groups;
