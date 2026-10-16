import type { APIRoute } from 'astro';
import { getAdminAuth } from '../../lib/firebaseAdmin';
import {
  csrfFailure,
  isRejectedIdToken,
  jsonResponse,
  readJsonBody,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  serializeCookie,
} from '../../lib/adminSession';

export const prerender = false;

const maxRequestBytes = 16 * 1024;
const recentAuthenticationSeconds = 5 * 60;

export const POST: APIRoute = async ({ request, url }) => {
  const csrfError = csrfFailure(request, url, false);
  if (csrfError) return csrfError;

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxRequestBytes) {
    return jsonResponse({ error: 'request_too_large' }, 413);
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return jsonResponse({ error: 'unsupported_media_type' }, 415);
  }

  const parsedBody = await readJsonBody(request, maxRequestBytes);
  if (!parsedBody.ok) {
    return jsonResponse(
      { error: parsedBody.reason === 'too-large' ? 'request_too_large' : 'invalid_request' },
      parsedBody.reason === 'too-large' ? 413 : 400,
    );
  }
  const payload = parsedBody.value;

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('idToken' in payload) ||
    typeof payload.idToken !== 'string' ||
    payload.idToken.length === 0 ||
    payload.idToken.length > 12_000
  ) {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  try {
    const auth = getAdminAuth();
    const claims = await auth.verifyIdToken(payload.idToken, true);
    if (claims.admin !== true) return jsonResponse({ error: 'unauthorized' }, 403);

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.auth_time !== 'number' || now - claims.auth_time > recentAuthenticationSeconds) {
      return jsonResponse({ error: 'recent_sign_in_required' }, 401);
    }

    const sessionCookie = await auth.createSessionCookie(payload.idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });
    const headers = new Headers({
      'Set-Cookie': serializeCookie(SESSION_COOKIE_NAME, sessionCookie, {
        maxAge: SESSION_MAX_AGE_SECONDS,
        sameSite: 'Lax',
      }),
      'Location': '/admin/',
    });
    return jsonResponse({ signedIn: true }, 200, headers);
  } catch (error) {
    if (isRejectedIdToken(error)) return jsonResponse({ error: 'unauthorized' }, 401);

    console.error('Admin session cookie creation failed.', error);
    return jsonResponse({ error: 'authentication_unavailable' }, 503);
  }
};
