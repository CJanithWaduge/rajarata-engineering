import type { APIRoute } from 'astro';
import { getAdminAuth, getAdminFirestore } from '../../lib/firebaseAdmin';
import { csrfFailure, jsonResponse, readJsonBody } from '../../lib/adminSession';
import custodians from '../../config/admin-custodians.json';

export const prerender = false;

const maximumChangesPerWindow = 5;
const rateLimitWindowMs = 15 * 60 * 1000;
const validUid = /^[A-Za-z0-9:_-]{1,128}$/;

interface ProvisionRequest {
  action: 'grant' | 'revoke';
  uid: string;
  reason: string;
}

function parseRequest(value: unknown): ProvisionRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (!('action' in value) || !('uid' in value) || !('reason' in value)) return undefined;
  if (value.action !== 'grant' && value.action !== 'revoke') return undefined;
  if (typeof value.uid !== 'string' || !validUid.test(value.uid)) return undefined;
  if (typeof value.reason !== 'string' || value.reason.trim().length < 3 || value.reason.length > 500) {
    return undefined;
  }
  return { action: value.action, uid: value.uid, reason: value.reason.trim() };
}

export const POST: APIRoute = async ({ request, url, locals }) => {
  const csrfError = csrfFailure(request, url, true);
  if (csrfError) return csrfError;

  const actorUid = locals.authUser?.uid;
  const custodianUids: readonly string[] = custodians.uids;
  if (custodianUids.length < 2 || !actorUid || !custodianUids.includes(actorUid)) {
    return jsonResponse(
      { error: 'Admin provisioning is disabled until two custodians are designated.' },
      403,
    );
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 16 * 1024) return jsonResponse({ error: 'request_too_large' }, 413);

  const parsedBody = await readJsonBody(request, 16 * 1024);
  if (!parsedBody.ok) {
    return jsonResponse(
      { error: parsedBody.reason === 'too-large' ? 'request_too_large' : 'invalid_request' },
      parsedBody.reason === 'too-large' ? 413 : 400,
    );
  }

  const input = parseRequest(parsedBody.value);
  if (!input) return jsonResponse({ error: 'invalid_request' }, 400);
  if (actorUid === input.uid && input.action === 'revoke') {
    return jsonResponse({ error: 'self_revocation_not_allowed' }, 409);
  }

  const firestore = getAdminFirestore();
  const rateLimitRef = firestore.collection('adminRateLimits').doc(actorUid);
  const now = Date.now();
  const allowed = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);
    const current = snapshot.data();
    const windowStartedAt =
      typeof current?.windowStartedAt === 'number' ? current.windowStartedAt : 0;
    const count = typeof current?.count === 'number' ? current.count : 0;
    const inCurrentWindow = now - windowStartedAt < rateLimitWindowMs;

    if (inCurrentWindow && count >= maximumChangesPerWindow) return false;

    transaction.set(rateLimitRef, {
      windowStartedAt: inCurrentWindow ? windowStartedAt : now,
      count: inCurrentWindow ? count + 1 : 1,
    });
    return true;
  });
  if (!allowed) return jsonResponse({ error: 'rate_limit_exceeded' }, 429);

  const auth = getAdminAuth();
  const target = await auth.getUser(input.uid);
  const auditRef = firestore.collection('adminAudit').doc();
  await auditRef.set({
    actorUid,
    targetUid: input.uid,
    action: input.action,
    reason: input.reason,
    status: 'requested',
    createdAt: new Date(),
  });

  const customClaims = { ...target.customClaims };
  if (input.action === 'grant') customClaims.admin = true;
  else delete customClaims.admin;

  let claimChanged = false;
  try {
    await auth.setCustomUserClaims(input.uid, customClaims);
    claimChanged = true;
    if (input.action === 'revoke') await auth.revokeRefreshTokens(input.uid);
  } catch (error) {
    await auditRef.update({
      status: claimChanged ? 'revocation-incomplete' : 'failed',
      finishedAt: new Date(),
    });
    console.error('Admin claim update failed.', error);
    return jsonResponse(
      {
        error: claimChanged
          ? 'claim_removed_but_sessions_may_remain'
          : 'claim_update_failed',
      },
      502,
    );
  }

  try {
    await auditRef.update({ status: 'completed', finishedAt: new Date() });
  } catch (error) {
    console.error('Admin claim changed but the audit record could not be completed.', error);
    return jsonResponse({ error: 'claim_changed_audit_incomplete' }, 503);
  }

  return jsonResponse({ action: input.action, uid: input.uid, completed: true }, 200);
};
