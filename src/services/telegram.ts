const TG_BASE = 'https://api.telegram.org';

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<TelegramResult> {
  if (!botToken || !chatId) return { ok: false, error: '未配置 Bot Token 或 Chat ID' };
  try {
    const res = await fetch(`${TG_BASE}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { description?: string };
    return { ok: false, error: data.description || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
}

// Escape the characters that break Telegram HTML parse mode.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
