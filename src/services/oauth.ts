const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

// Mozilla Thunderbird public client id: Mail.ReadWrite + offline_access.
export const DEFAULT_CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
const SCOPE = 'Mail.ReadWrite offline_access';

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    scope: SCOPE,
    response_mode: 'query',
  });
  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  return `${AUTHORIZE_URL}?${params}`;
}

export async function exchangeCode(opts: {
  code: string;
  clientId: string;
  redirectUri: string;
}): Promise<{ refreshToken?: string; error?: string }> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: opts.clientId,
        grant_type: 'authorization_code',
        code: opts.code,
        redirect_uri: opts.redirectUri,
        scope: SCOPE,
      }).toString(),
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || !data.refresh_token) {
      const msg =
        (data.error_description as string) || (data.error as string) || `换取令牌失败 (${res.status})`;
      return { error: msg };
    }
    return { refreshToken: data.refresh_token as string };
  } catch (e) {
    return { error: `网络错误: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}
