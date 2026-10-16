import type { APIRoute } from 'astro';
import {
  PAGE_IDS,
  ContentValidationError,
  type PageId,
} from '../../../lib/contentModel';
import { getDraftFirestore } from '../../../lib/firebaseAdmin';
import {
  DraftConflictError,
  DraftNotFoundError,
  getBusinessDetailsDraft,
  getPageDraft,
  getProjectDraft,
  getSeoDraft,
  getServiceDraft,
  listProjectDrafts,
  listServiceDrafts,
  saveBusinessDetailsDraft,
  savePageDraft,
  saveProjectDraft,
  saveSeoDraft,
  saveServiceDraft,
  setProjectDraftArchived,
  setServiceDraftArchived,
} from '../../../lib/draftRepository';
import { csrfFailure, jsonResponse, readJsonBody } from '../../../lib/adminSession';

export const prerender = false;

const maxRequestBytes = 64 * 1024;
const kinds = ['services', 'projects', 'pages', 'businessDetails', 'seo'] as const;
type DraftKind = (typeof kinds)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUpdatedAt(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value.length <= 40 ? value : undefined;
}

function actorFor(locals: App.Locals) {
  return locals.authUser;
}

function mapError(error: unknown): Response {
  if (error instanceof ContentValidationError) {
    return jsonResponse({ error: 'invalid_draft', detail: error.message }, 400);
  }
  if (error instanceof DraftConflictError) {
    return jsonResponse({ error: 'draft_conflict', detail: error.message }, 409);
  }
  if (error instanceof DraftNotFoundError) {
    return jsonResponse({ error: 'draft_not_found' }, 404);
  }

  console.error('Admin draft operation failed.', error);
  return jsonResponse({ error: 'draft_service_unavailable' }, 503);
}

export const GET: APIRoute = async ({ request, locals }) => {
  const actor = actorFor(locals);
  if (!actor?.admin) return jsonResponse({ error: 'unauthorized' }, 403);

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  if (!kinds.includes(kind as DraftKind)) {
    return jsonResponse({ error: 'invalid_draft_kind' }, 400);
  }
  const id = url.searchParams.get('id');

  try {
    const firestore = getDraftFirestore();
    if (kind === 'services') {
      return jsonResponse(
        { drafts: id ? await getServiceDraft(firestore, actor, id) : await listServiceDrafts(firestore, actor) },
        200,
      );
    }
    if (kind === 'projects') {
      return jsonResponse(
        { drafts: id ? await getProjectDraft(firestore, actor, id) : await listProjectDrafts(firestore, actor) },
        200,
      );
    }
    if (kind === 'pages') {
      if (!id || !PAGE_IDS.includes(id as PageId)) {
        return jsonResponse({ error: 'invalid_page_id' }, 400);
      }
      return jsonResponse({ drafts: await getPageDraft(firestore, actor, id) }, 200);
    }
    if (kind === 'businessDetails') {
      if (id) return jsonResponse({ error: 'id_not_supported' }, 400);
      return jsonResponse({ drafts: await getBusinessDetailsDraft(firestore, actor) }, 200);
    }
    if (id) return jsonResponse({ error: 'id_not_supported' }, 400);
    return jsonResponse({ drafts: await getSeoDraft(firestore, actor) }, 200);
  } catch (error) {
    return mapError(error);
  }
};

export const POST: APIRoute = async ({ request, url, locals }) => {
  const csrfError = csrfFailure(request, url, true);
  if (csrfError) return csrfError;

  const actor = actorFor(locals);
  if (!actor?.admin) return jsonResponse({ error: 'unauthorized' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return jsonResponse({ error: 'unsupported_media_type' }, 415);
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maxRequestBytes) return jsonResponse({ error: 'request_too_large' }, 413);
  const body = await readJsonBody(request, maxRequestBytes);
  if (!body.ok) {
    return jsonResponse(
      { error: body.reason === 'too-large' ? 'request_too_large' : 'invalid_request' },
      body.reason === 'too-large' ? 413 : 400,
    );
  }
  if (!isRecord(body.value)) return jsonResponse({ error: 'invalid_request' }, 400);

  const kind = body.value.kind;
  const action = body.value.action;
  const expectedUpdatedAt = parseUpdatedAt(body.value.expectedUpdatedAt);
  if (!kinds.includes(kind as DraftKind) || typeof action !== 'string') {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }
  if (expectedUpdatedAt === undefined) {
    return jsonResponse({ error: 'invalid_expected_updated_at' }, 400);
  }

  try {
    const firestore = getDraftFirestore();
    let draft: unknown;
    if (action === 'save' && kind === 'services') {
      draft = await saveServiceDraft(firestore, actor, body.value.draft, expectedUpdatedAt);
    } else if (action === 'save' && kind === 'projects') {
      draft = await saveProjectDraft(firestore, actor, body.value.draft, expectedUpdatedAt);
    } else if ((action === 'archive' || action === 'restore') && kind === 'services') {
      if (typeof body.value.id !== 'string' || typeof expectedUpdatedAt !== 'string') {
        return jsonResponse({ error: 'invalid_request' }, 400);
      }
      draft = await setServiceDraftArchived(
        firestore, actor, body.value.id, action === 'archive', expectedUpdatedAt,
      );
    } else if ((action === 'archive' || action === 'restore') && kind === 'projects') {
      if (typeof body.value.id !== 'string' || typeof expectedUpdatedAt !== 'string') {
        return jsonResponse({ error: 'invalid_request' }, 400);
      }
      draft = await setProjectDraftArchived(
        firestore, actor, body.value.id, action === 'archive', expectedUpdatedAt,
      );
    } else if (action === 'save' && kind === 'pages') {
      draft = await savePageDraft(firestore, actor, body.value.draft, expectedUpdatedAt);
    } else if (action === 'save' && kind === 'businessDetails') {
      draft = await saveBusinessDetailsDraft(firestore, actor, body.value.draft, expectedUpdatedAt);
    } else if (action === 'save' && kind === 'seo') {
      draft = await saveSeoDraft(firestore, actor, body.value.draft, expectedUpdatedAt);
    } else {
      return jsonResponse({ error: 'unsupported_draft_operation' }, 400);
    }
    return jsonResponse({ draft }, 200);
  } catch (error) {
    return mapError(error);
  }
};
