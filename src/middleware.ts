import { defineMiddleware } from 'astro:middleware';
import { getAdminAuth } from './lib/firebaseAdmin';
import {
  isRejectedSession,
  privateResponseHeaders,
  sessionCookie,
} from './lib/adminSession';

function withPrivateHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  privateResponseHeaders().forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function loginRedirect(requestUrl: URL, requestPath: string): Response {
  const returnTo = `${requestPath}${requestUrl.search}`;
  const safeReturnTo = returnTo.startsWith('/admin/') && !returnTo.startsWith('//')
    ? returnTo
    : '/admin/';
  const location = new URL('/admin/login', requestUrl);
  location.searchParams.set('returnTo', safeReturnTo);
  return withPrivateHeaders(Response.redirect(location, 302));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  const pathname = url.pathname;
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/');

  if (!isAdminPath) return next();

  if (
    pathname === '/admin/session' ||
    pathname === '/admin/session-csrf' ||
    pathname === '/admin/sign-out'
  ) {
    const response = await next();
    return withPrivateHeaders(response);
  }

  if (pathname === '/admin/login') {
    const cookie = sessionCookie(context.request);
    if (!cookie) return withPrivateHeaders(await next());

    try {
      const claims = await getAdminAuth().verifySessionCookie(cookie, true);
      if (claims.admin === true) {
        return withPrivateHeaders(Response.redirect(new URL('/admin/', url), 302));
      }
      return withPrivateHeaders(await next());
    } catch (error) {
      if (isRejectedSession(error)) return withPrivateHeaders(await next());

      console.error('Admin login session check failed.', error);
      return withPrivateHeaders(
        new Response('Admin authentication is temporarily unavailable. Please try again.', {
          status: 503,
        }),
      );
    }
  }

  const cookie = sessionCookie(context.request);
  if (!cookie) return loginRedirect(url, pathname);

  try {
    const claims = await getAdminAuth().verifySessionCookie(cookie, true);
    if (claims.admin !== true) {
      return withPrivateHeaders(new Response('Forbidden', { status: 403 }));
    }

    context.locals.authUser = {
      uid: claims.uid,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      admin: true,
    };

    return withPrivateHeaders(await next());
  } catch (error) {
    if (isRejectedSession(error)) return loginRedirect(url, pathname);

    console.error('Admin session verification failed.', error);
    return withPrivateHeaders(
      new Response('Admin authentication is temporarily unavailable. Please try again.', {
        status: 503,
      }),
    );
  }
});
