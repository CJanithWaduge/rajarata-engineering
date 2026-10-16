import type { APIRoute } from 'astro';
import {
  csrfFailure,
  jsonResponse,
  SESSION_COOKIE_NAME,
  serializeCookie,
} from '../../lib/adminSession';

export const prerender = false;

export const POST: APIRoute = async ({ request, url }) => {
  const csrfError = csrfFailure(request, url, true);
  if (csrfError) return csrfError;

  const headers = new Headers({
    'Set-Cookie': serializeCookie(SESSION_COOKIE_NAME, '', {
      maxAge: 0,
      sameSite: 'Lax',
    }),
  });
  return jsonResponse({ signedOut: true }, 200, headers);
};
