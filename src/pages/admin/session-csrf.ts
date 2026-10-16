import { createHash } from 'node:crypto';
import type { APIRoute } from 'astro';
import {
  jsonResponse,
  sessionCookie,
} from '../../lib/adminSession';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const cookie = sessionCookie(request);
  const csrfToken = cookie
    ? createHash('sha256').update(cookie).digest('hex')
    : 'preauth';
  return jsonResponse({ csrfToken }, 200);
};
