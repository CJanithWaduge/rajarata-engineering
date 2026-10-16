import { createHash } from 'node:crypto';

export const SESSION_COOKIE_NAME = '__session';
export const SESSION_MAX_AGE_SECONDS = 5 * 24 * 60 * 60;

const rejectedSessionCodes = new Set([
  'auth/argument-error',
  'auth/invalid-session-cookie',
  'auth/session-cookie-expired',
  'auth/session-cookie-revoked',
  'auth/user-disabled',
  'auth/user-not-found',
]);

const rejectedIdTokenCodes = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);

export function firebaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

export function isRejectedSession(error: unknown): boolean {
  const code = firebaseErrorCode(error);
  return code !== undefined && rejectedSessionCodes.has(code);
}

export function isRejectedIdToken(error: unknown): boolean {
  const code = firebaseErrorCode(error);
  return code !== undefined && rejectedIdTokenCodes.has(code);
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }

  return undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function csrfFailure(
  request: Request,
  url: URL,
  requireSessionCookie = false,
): Response | undefined {
  const origin = request.headers.get('origin');
  const configuredOrigins = (process.env.ADMIN_PUBLIC_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigin =
    (process.env.NODE_ENV === 'development' && origin === url.origin) ||
    (origin !== null && configuredOrigins.includes(origin));
  const currentSession = sessionCookie(request);
  const expectedToken = requireSessionCookie
    ? currentSession
      ? createHash('sha256').update(currentSession).digest('hex')
      : undefined
    : 'preauth';
  const csrfHeader = request.headers.get('x-csrf-token');

  if (!allowedOrigin || !expectedToken || !csrfHeader || !constantTimeEqual(expectedToken, csrfHeader)) {
    return new Response('Forbidden', {
      status: 403,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
}

export async function readJsonBody(
  request: Request,
  maximumBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: 'too-large' | 'invalid' }> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: 'invalid' };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      return { ok: false, reason: 'too-large' };
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

export function privateResponseHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    Pragma: 'no-cache',
  });
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: HeadersInit,
): Response {
  const headers = privateResponseHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return new Response(JSON.stringify(body), { status, headers });
}

export function cookieSecure(): boolean {
  return process.env.NODE_ENV !== 'development';
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; sameSite: 'Lax' },
): string {
  const secure = cookieSecure() ? '; Secure' : '';
  const httpOnly = name === SESSION_COOKIE_NAME ? '; HttpOnly' : '';
  return `${name}=${value}; Path=/; Max-Age=${options.maxAge}; SameSite=${options.sameSite}${httpOnly}${secure}`;
}

export function sessionCookie(request: Request): string | undefined {
  return readCookie(request, SESSION_COOKIE_NAME);
}
