import type { APIRoute } from 'astro';
import { csrfFailure, jsonResponse, readJsonBody } from '../../../lib/adminSession';
import { runPublishBuild } from '../../../lib/cloudBuild';
import { getDraftFirestore, getDraftStorage } from '../../../lib/firebaseAdmin';
import {
  createPublishRelease,
  createRollbackRelease,
  finishRelease,
  listReleases,
  ReleaseInProgressError,
  ReleaseNotFoundError,
  ReleaseRecordError,
  ReleaseValidationError,
  setReleaseBuildId,
} from '../../../lib/releaseRepository';
import { ContentValidationError } from '../../../lib/contentModel';

export const prerender = false;

const maximumRequestBytes = 4 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{16,80}$/.test(value);
}

function errorResponse(error: unknown): Response {
  if (error instanceof ContentValidationError) {
    return jsonResponse({ error: 'release_validation_failed', detail: error.message }, 422);
  }
  if (error instanceof ReleaseInProgressError) {
    return jsonResponse({ error: 'release_in_progress', detail: error.message }, 409);
  }
  if (error instanceof ReleaseNotFoundError) {
    return jsonResponse({ error: 'release_not_found' }, 404);
  }
  if (error instanceof ReleaseValidationError) {
    return jsonResponse({ error: 'release_validation_failed', issues: error.issues }, 422);
  }
  if (error instanceof ReleaseRecordError) {
    return jsonResponse({ error: 'release_conflict', detail: error.message }, 409);
  }

  console.error('Admin publishing operation failed.', error);
  return jsonResponse({ error: 'publishing_unavailable' }, 503);
}

export const GET: APIRoute = async ({ locals }) => {
  const actor = locals.authUser;
  if (!actor?.admin) return jsonResponse({ error: 'unauthorized' }, 403);

  try {
    const firestore = getDraftFirestore();
    const [releases, lock] = await Promise.all([
      listReleases(firestore),
      firestore.doc('locks/publish').get(),
    ]);
    const lockedReleaseId: unknown = lock.exists ? lock.get('releaseId') : null;
    const activeReleaseId = typeof lockedReleaseId === 'string' ? lockedReleaseId : null;
    return jsonResponse({ releases, activeReleaseId }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: APIRoute = async ({ request, url, locals }) => {
  const csrfError = csrfFailure(request, url, true);
  if (csrfError) return csrfError;
  const actor = locals.authUser;
  if (!actor?.admin) return jsonResponse({ error: 'unauthorized' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return jsonResponse({ error: 'unsupported_media_type' }, 415);
  }

  const body = await readJsonBody(request, maximumRequestBytes);
  if (!body.ok) {
    return jsonResponse(
      { error: body.reason === 'too-large' ? 'request_too_large' : 'invalid_request' },
      body.reason === 'too-large' ? 413 : 400,
    );
  }
  if (!isObject(body.value) || !validRequestId(body.value.requestId)) {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }

  const action = body.value.action;
  if (action !== 'publish' && action !== 'rollback') {
    return jsonResponse({ error: 'invalid_action' }, 400);
  }
  if (action === 'rollback' && (
    typeof body.value.releaseId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(body.value.releaseId)
  )) {
    return jsonResponse({ error: 'invalid_release_id' }, 400);
  }

  let releaseId: string | undefined;
  try {
    const firestore = getDraftFirestore();
    const result = action === 'publish'
      ? await createPublishRelease(firestore, getDraftStorage(), actor, body.value.requestId)
      : await createRollbackRelease(
          firestore,
          getDraftStorage(),
          actor,
          body.value.releaseId as string,
          body.value.requestId,
        );
    releaseId = result.release.id;
    let buildId: string | null = null;
    if (!result.duplicate) {
      try {
        buildId = await runPublishBuild(releaseId);
      } catch (error) {
        await finishRelease(firestore, releaseId, {
          status: 'failed',
          failure: {
            code: 'build_trigger_failed',
            message: 'The publishing pipeline could not be started. No new Hosting release was created.',
          },
        });
        throw error;
      }
      try {
        await setReleaseBuildId(firestore, releaseId, buildId);
      } catch (error) {
        console.error(`Cloud Build started for release ${releaseId}, but its identifier could not be saved.`, error);
      }
    }
    return jsonResponse(
      { release: result.release, buildId, duplicate: result.duplicate },
      result.duplicate ? 200 : 202,
    );
  } catch (error) {
    if (releaseId && !(error instanceof ReleaseValidationError)) {
      console.error(`Publishing request failed for release ${releaseId}.`, error);
    }
    return errorResponse(error);
  }
};
