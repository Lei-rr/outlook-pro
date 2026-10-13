import { Hono } from 'hono';
import { badRequest, ok } from '../core/http.js';
import { hashPassword, randomHex } from '../core/crypto.js';
import { maskToken } from '../core/validate.js';
import { runEmailPush } from '../jobs/push.js';
import { runTokenRefresh } from '../jobs/refresh.js';
import { sendTelegramMessage } from '../services/telegram.js';
import type { AppEnv } from '../types.js';

const settings = new Hono<AppEnv>();

const SECRET_KEYS = new Set(['gptmail_api_key', 'telegram_bot_token']);

// Plain (non-secret) settings the UI may write, keyed by the label shown in messages.
const PLAIN_KEYS: Record<string, string> = {
  site_title: '站点标题',
  telegram_push_enabled: 'Telegram 推送开关',
  telegram_chat_id: 'Telegram Chat ID',
  telegram_push_interval_minutes: 'Telegram 推送间隔',
  token_refresh_enabled: '定时刷新开关',
  token_refresh_interval_hours: '刷新间隔',
  token_refresh_batch: '每批数量',
  token_refresh_window_days: '刷新窗口(天)',
  token_refresh_concurrency: '刷新并发',
};

settings.get('/', (c) => {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(c.env.repo.settings.all())) {
    if (key === 'login_password_hash') data.login_password = '******';
    else if (SECRET_KEYS.has(key)) data[key] = value ? maskToken(value) : '';
    else data[key] = value;
  }
  return ok(data);
});

settings.post('/external-key', (c) => {
  const key = randomHex(24);
  c.env.repo.settings.set('external_api_key', key);
  return ok({ external_api_key: key }, '已生成新的 API Key');
});

settings.delete('/external-key', (c) => {
  c.env.repo.settings.remove('external_api_key');
  return ok(null, '已停用对外 API');
});

settings.post('/refresh-now', async (c) => {
  const summary = await runTokenRefresh(c.env.repo, c.env.config, { force: true });
  return ok({ summary }, summary ? `刷新 ${summary.scanned} 个：成功 ${summary.ok}，失败 ${summary.failed}` : '未执行');
});

settings.post('/push-now', async (c) => {
  const summary = await runEmailPush(c.env.repo, c.env.config, { force: true });
  return ok({ summary }, summary ? `发送 ${summary.sent} 条` : '未执行');
});

settings.post('/telegram-test', async (c) => {
  const { repo } = c.env;
  const botToken = repo.settings.get('telegram_bot_token');
  const chatId = repo.settings.get('telegram_chat_id');
  if (!botToken || !chatId) return badRequest('请先填写并保存 Bot Token 和 Chat ID');

  const r = await sendTelegramMessage(botToken, chatId, '✅ Outlook Pro 测试消息：Telegram 推送配置成功。');
  return r.ok ? ok(null, '测试消息已发送，请检查 Telegram') : badRequest(`发送失败：${r.error}`);
});

settings.put('/', async (c) => {
  const { repo } = c.env;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updated: string[] = [];

  if (body.login_password) {
    const pwd = String(body.login_password).trim();
    if (pwd.length < 4) return badRequest('密码长度至少为 4 位');
    repo.settings.set('login_password_hash', hashPassword(pwd));
    updated.push('登录密码');
  }

  for (const [key, label] of Object.entries(PLAIN_KEYS)) {
    if (body[key] !== undefined) {
      repo.settings.set(key, String(body[key]).trim());
      updated.push(label);
    }
  }

  // Secret fields: skip when the value is still the masked placeholder from the UI.
  for (const key of SECRET_KEYS) {
    if (body[key] !== undefined && !String(body[key]).includes('*')) {
      repo.settings.set(key, String(body[key]).trim());
      updated.push(key === 'gptmail_api_key' ? 'GPTMail API Key' : 'Telegram Bot Token');
    }
  }

  if (!updated.length) return badRequest('没有需要更新的设置');
  return ok(null, `已更新：${updated.join(', ')}`);
});

export default settings;
