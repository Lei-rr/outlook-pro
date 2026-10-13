const BASE = 'https://mail.chatgpt.org.uk';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function request<T>(
  apiKey: string,
  method: string,
  endpoint: string,
  options?: { params?: Record<string, string>; body?: unknown }
): Promise<Envelope<T>> {
  if (!apiKey) return { ok: false, error: 'GPTMail API Key 未配置' };

  let url = `${BASE}${endpoint}`;
  if (options?.params) url += `?${new URLSearchParams(options.params)}`;

  try {
    const res = await fetch(url, {
      method,
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) return { ok: false, error: `GPTMail API 错误: ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, error: `GPTMail 请求失败: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

export async function generateTempEmail(
  apiKey: string,
  body?: { prefix?: string; domain?: string }
): Promise<{ email?: string; error?: string }> {
  const res = body
    ? await request<{ data?: { email?: string } }>(apiKey, 'POST', '/api/generate-email', { body })
    : await request<{ data?: { email?: string } }>(apiKey, 'GET', '/api/generate-email');
  if (!res.ok) return { error: res.error };
  const email = res.data?.data?.email;
  return email ? { email } : { error: '生成临时邮箱失败，API 返回异常' };
}

interface RawTempMessage {
  id: string;
  from_address?: string;
  subject?: string;
  content?: string;
  html_content?: string;
  timestamp?: number;
  has_html?: boolean;
}

export async function listTempMessages(
  apiKey: string,
  email: string
): Promise<{ emails?: RawTempMessage[]; error?: string }> {
  const res = await request<{ data?: { emails?: RawTempMessage[] } }>(apiKey, 'GET', '/api/emails', {
    params: { email },
  });
  if (!res.ok) return { error: res.error };
  return { emails: res.data?.data?.emails ?? [] };
}

export async function getTempMessage(
  apiKey: string,
  messageId: string
): Promise<{ message?: RawTempMessage; error?: string }> {
  const res = await request<{ data?: RawTempMessage }>(apiKey, 'GET', `/api/email/${encodeURIComponent(messageId)}`);
  if (!res.ok) return { error: res.error };
  return res.data?.data ? { message: res.data.data } : { error: '邮件不存在' };
}
