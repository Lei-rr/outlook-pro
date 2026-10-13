import { maskToken } from '../core/validate.js';

const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface GraphError {
  code: string;
  message: string;
}

export interface MailAddress {
  emailAddress: { name: string; address: string };
}

export interface MailMessage {
  id: string;
  subject: string;
  from?: MailAddress;
  toRecipients?: MailAddress[];
  ccRecipients?: MailAddress[];
  receivedDateTime: string;
  bodyPreview: string;
  isRead: boolean;
  hasAttachments: boolean;
  body?: { contentType: string; content: string };
}

export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes?: string;
}

// Strip anything token-shaped from upstream error text before surfacing it.
function redact(msg: string): string {
  return msg.replace(/[A-Za-z0-9_-]{40,}/g, (m) => maskToken(m));
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string
): Promise<{ token?: string; newRefreshToken?: string; error?: GraphError }> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, string>;
      return {
        error: {
          code: err.error || (res.status === 429 ? 'RATE_LIMITED' : 'TOKEN_FAILED'),
          message: err.error_description
            ? redact(err.error_description)
            : `Token request failed (${res.status})`,
        },
      };
    }

    const data = (await res.json()) as { access_token: string; refresh_token?: string };
    return { token: data.access_token, newRefreshToken: data.refresh_token };
  } catch (e) {
    return {
      error: { code: 'NETWORK_ERROR', message: `网络错误: ${e instanceof Error ? e.message : 'unknown'}` },
    };
  }
}

export async function fetchEmails(
  accessToken: string,
  options: { folder?: string; top?: number; skip?: number; keyword?: string; includeBody?: boolean } = {}
): Promise<{ items?: MailMessage[]; error?: GraphError }> {
  const { folder = 'inbox', top = 20, skip = 0, keyword, includeBody = false } = options;

  // Aggregated view merges inbox + junk. Pagination (`skip`) does not apply here
  // because the merged ordering only holds for the first page.
  if (folder === 'all') {
    const [inbox, junk] = await Promise.all([
      fetchEmails(accessToken, { folder: 'inbox', top, keyword, includeBody }),
      fetchEmails(accessToken, { folder: 'junkemail', top, keyword, includeBody }),
    ]);
    if (inbox.error && junk.error) return { error: inbox.error };
    const merged = [...(inbox.items ?? []), ...(junk.items ?? [])]
      .sort((a, b) => (b.receivedDateTime ?? '').localeCompare(a.receivedDateTime ?? ''))
      .slice(0, top);
    return { items: merged };
  }

  const params = new URLSearchParams({
    $top: String(top),
    $skip: String(skip),
    $orderby: 'receivedDateTime desc',
    $select:
      'id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments' + (includeBody ? ',body' : ''),
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Prefer: 'outlook.body-content-type="text"',
  };

  if (keyword) {
    params.set('$search', `"${keyword}"`);
    headers['ConsistencyLevel'] = 'eventual';
  }

  const url = `${GRAPH_BASE}/me/mailFolders/${folder}/messages?${params}`;

  try {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      return { error: { code: 'RATE_LIMITED', message: 'Graph API 限流，请稍后重试' } };
    }
    if (!res.ok) {
      return { error: { code: 'GRAPH_ERROR', message: `获取邮件失败 (${res.status})` } };
    }
    const data = (await res.json()) as { value: MailMessage[] };
    return { items: data.value ?? [] };
  } catch (e) {
    return {
      error: { code: 'NETWORK_ERROR', message: `网络错误: ${e instanceof Error ? e.message : 'unknown'}` },
    };
  }
}

export async function fetchEmailDetail(
  accessToken: string,
  messageId: string
): Promise<{ item?: MailMessage; error?: GraphError }> {
  const url =
    `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?` +
    new URLSearchParams({
      $select:
        'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,isRead,hasAttachments',
    }).toString();

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.body-content-type="html"' },
    });
    if (res.status === 404) return { error: { code: 'NOT_FOUND', message: '邮件不存在' } };
    if (!res.ok) return { error: { code: 'GRAPH_ERROR', message: `获取邮件详情失败 (${res.status})` } };
    return { item: (await res.json()) as MailMessage };
  } catch (e) {
    return {
      error: { code: 'NETWORK_ERROR', message: `网络错误: ${e instanceof Error ? e.message : 'unknown'}` },
    };
  }
}

export async function deleteEmail(
  accessToken: string,
  messageId: string
): Promise<{ ok: boolean; error?: GraphError }> {
  try {
    const res = await fetch(`${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) return { ok: true };
    if (res.status === 404) return { ok: false, error: { code: 'NOT_FOUND', message: '邮件不存在' } };
    if (res.status === 403) {
      return {
        ok: false,
        error: { code: 'FORBIDDEN', message: '无删除权限：该账号为只读授权，请重新授权以获取读写权限' },
      };
    }
    return { ok: false, error: { code: 'GRAPH_ERROR', message: `删除失败 (${res.status})` } };
  } catch (e) {
    return {
      ok: false,
      error: { code: 'NETWORK_ERROR', message: `网络错误: ${e instanceof Error ? e.message : 'unknown'}` },
    };
  }
}

export async function listAttachments(
  accessToken: string,
  messageId: string
): Promise<{ items?: Attachment[]; error?: GraphError }> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return { error: { code: 'GRAPH_ERROR', message: `获取附件列表失败 (${res.status})` } };
    const data = (await res.json()) as { value: Attachment[] };
    return { items: data.value ?? [] };
  } catch (e) {
    return {
      error: { code: 'NETWORK_ERROR', message: `网络错误: ${e instanceof Error ? e.message : 'unknown'}` },
    };
  }
}

export async function getAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<{ attachment?: Attachment; error?: GraphError }> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 404) return { error: { code: 'NOT_FOUND', message: '附件不存在' } };
    if (!res.ok) return { error: { code: 'GRAPH_ERROR', message: `获取附件失败 (${res.status})` } };
    return { attachment: (await res.json()) as Attachment };
  } catch (e) {
    return {
      error: { code: 'NETWORK_ERROR', message: `网络错误: ${e instanceof Error ? e.message : 'unknown'}` },
    };
  }
}
