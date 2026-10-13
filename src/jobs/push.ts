import type { Config } from '../config.js';
import { mapLimit, RateLimiter } from '../core/async.js';
import type { Repo } from '../db/repo/index.js';
import { refreshAccountToken } from '../services/account.js';
import { fetchEmails } from '../services/graph.js';
import { escapeHtml, sendTelegramMessage } from '../services/telegram.js';

export interface PushSummary {
  ranAt: string;
  scanned: number;
  sent: number;
  failed: number;
}

const MAX_ACCOUNTS = 50;
const MAX_MSGS_PER_ACCOUNT = 5;
const ACCOUNT_CONCURRENCY = 8;
const TELEGRAM_RATE_PER_SEC = 25; // Telegram allows ~30 msg/s

export async function runEmailPush(
  repo: Repo,
  config: Config,
  opts: { force?: boolean } = {}
): Promise<PushSummary | null> {
  const { settings, accounts, pushState } = repo;

  if (!opts.force && settings.get('telegram_push_enabled') !== '1') return null;

  const botToken = settings.get('telegram_bot_token');
  const chatId = settings.get('telegram_chat_id');
  if (!botToken || !chatId) return null;

  if (!opts.force) {
    const intervalMin =
      Number.parseInt(settings.get('telegram_push_interval_minutes') || '', 10) || config.pushIntervalMinutes;
    const lastRun = Number.parseInt(settings.get('telegram_push_last_run') || '0', 10);
    if (lastRun && Date.now() - lastRun < intervalMin * 60_000) return null;
  }

  const due = accounts.dueForPush(MAX_ACCOUNTS);
  const limiter = new RateLimiter(TELEGRAM_RATE_PER_SEC);
  let sent = 0;
  let failed = 0;

  await mapLimit(due, ACCOUNT_CONCURRENCY, async (acc) => {
    const auth = await refreshAccountToken(repo, acc);
    if (!auth.token) {
      failed++;
      pushState.markChecked(acc.id);
      return;
    }

    const list = await fetchEmails(auth.token, { folder: 'inbox', top: 10 });
    if (list.error || !list.items) {
      failed++;
      pushState.markChecked(acc.id);
      return;
    }

    const watermark = pushState.watermark(acc.id);
    // First sighting: adopt the newest message as the watermark instead of
    // flooding the chat with the whole backlog.
    if (!watermark) {
      pushState.markChecked(acc.id, list.items[0]?.receivedDateTime ?? '');
      return;
    }

    const fresh = list.items
      .filter((m) => (m.receivedDateTime || '') > watermark)
      .sort((a, b) => (a.receivedDateTime || '').localeCompare(b.receivedDateTime || ''))
      .slice(-MAX_MSGS_PER_ACCOUNT);

    let newWatermark = watermark;
    for (const m of fresh) {
      await limiter.acquire();
      const text =
        `📬 <b>${escapeHtml(acc.email)}</b>\n` +
        `发件人: ${escapeHtml(m.from?.emailAddress?.address ?? '未知发件人')}\n` +
        `主题: <b>${escapeHtml(m.subject || '(无主题)')}</b>\n` +
        `${escapeHtml((m.bodyPreview || '').slice(0, 300))}`;
      const r = await sendTelegramMessage(botToken, chatId, text);
      if (r.ok) {
        sent++;
        if ((m.receivedDateTime || '') > newWatermark) newWatermark = m.receivedDateTime;
      }
    }

    pushState.markChecked(acc.id, newWatermark);
  });

  const summary: PushSummary = { ranAt: new Date().toISOString(), scanned: due.length, sent, failed };
  settings.set('telegram_push_last_run', String(Date.now()));
  settings.set(
    'telegram_push_last_result',
    `${summary.ranAt} 推送：扫描 ${due.length} 个，发送 ${sent} 条，失败账号 ${failed}`
  );
  return summary;
}
