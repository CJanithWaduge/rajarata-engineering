interface CsrfResponse {
  csrfToken: string;
}

async function getCsrfToken(): Promise<string> {
  const response = await fetch('/admin/session-csrf', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Unable to verify the security token.');

  const payload = (await response.json()) as Partial<CsrfResponse>;
  if (typeof payload.csrfToken !== 'string' || payload.csrfToken.length < 32) {
    throw new Error('The security token response was invalid.');
  }
  return payload.csrfToken;
}

export async function signOutAdminSession(): Promise<void> {
  const csrfToken = await getCsrfToken();
  const response = await fetch('/admin/sign-out', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-CSRF-Token': csrfToken },
  });
  if (!response.ok) throw new Error('Sign-out could not be confirmed by the server.');
}
