export interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: { code: string; message: string };
}

export function ok<T>(data?: T, message?: string): Response {
  const body: ApiEnvelope<T> = { success: true };
  if (data !== undefined) body.data = data;
  if (message) body.message = message;
  return Response.json(body);
}

export function fail(code: string, message: string, status = 400): Response {
  return Response.json({ success: false, error: { code, message } } satisfies ApiEnvelope, { status });
}

export const badRequest = (message: string) => fail('BAD_REQUEST', message, 400);
export const unauthorized = () => fail('UNAUTHORIZED', '请先登录', 401);
export const notFound = (message = '资源不存在') => fail('NOT_FOUND', message, 404);
export const tooManyRequests = (message = '请求过于频繁，请稍后再试') =>
  fail('TOO_MANY_REQUESTS', message, 429);
export const serverError = (message = '服务器内部错误') => fail('SERVER_ERROR', message, 500);
