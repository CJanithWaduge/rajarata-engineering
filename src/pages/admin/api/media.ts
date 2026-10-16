import type { APIRoute } from 'astro';
import {
  MAX_MEDIA_BYTES,
  MEDIA_CONTENT_TYPES,
  ContentValidationError,
  type MediaDraft,
} from '../../../lib/contentModel';
import { getDraftFirestore, getDraftStorage } from '../../../lib/firebaseAdmin';
import {
  DraftConflictError,
  DraftNotFoundError,
} from '../../../lib/draftRepository';
import {
  createMediaDraft,
  getMediaDraft,
  listMediaDrafts,
  updateMediaDraft,
} from '../../../lib/mediaRepository';
import {
  csrfFailure,
  jsonResponse,
  privateResponseHeaders,
  readBytesBody,
  readJsonBody,
} from '../../../lib/adminSession';

export const prerender = false;

const maximumMetadataRequestBytes = 8 * 1024;

function mapError(error: unknown): Response {
  if (error instanceof ContentValidationError) {
    return jsonResponse({ error: 'invalid_media', detail: error.message }, 400);
  }
  if (error instanceof DraftConflictError) {
    return jsonResponse({ error: 'media_conflict', detail: error.message }, 409);
  }
  if (error instanceof DraftNotFoundError) {
    return jsonResponse({ error: 'media_not_found' }, 404);
  }
  console.error('Admin media operation failed.', error);
  return jsonResponse({ error: 'media_service_unavailable' }, 503);
}

function actorFor(locals: App.Locals) {
  return locals.authUser;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const actor = actorFor(locals);
  if (!actor?.admin) return jsonResponse({ error: 'unauthorized' }, 403);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  try {
    const firestore = getDraftFirestore();
    if (url.searchParams.get('image') === '1') {
      if (!id) return jsonResponse({ error: 'invalid_media_id' }, 400);
      const media = await getMediaDraft(firestore, actor, id);

      const file = getDraftStorage().file(media.storagePath);
      const [exists] = await file.exists();
      if (!exists) return jsonResponse({ error: 'media_object_missing' }, 404);
      const [bytes] = await file.download();
      const headers = privateResponseHeaders();
      headers.set('Content-Type', media.contentType);
      headers.set('Content-Length', String(bytes.byteLength));
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(new Uint8Array(bytes), { status: 200, headers });
    }

    if (id) return jsonResponse({ error: 'id_not_supported' }, 400);
    const media = await listMediaDrafts(firestore, actor);
    return jsonResponse({ media }, 200);
  } catch (error) {
    return mapError(error);
  }
};

export const POST: APIRoute = async ({ request, url, locals }) => {
  const csrfError = csrfFailure(request, url, true);
  if (csrfError) return csrfError;
  const actor = actorFor(locals);
  if (!actor?.admin) return jsonResponse({ error: 'unauthorized' }, 403);

  const contentType = request.headers.get('content-type') ?? '';
  if (MEDIA_CONTENT_TYPES.includes(contentType as (typeof MEDIA_CONTENT_TYPES)[number])) {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_MEDIA_BYTES) {
      return jsonResponse({ error: 'media_too_large' }, 413);
    }
    const encodedMetadata = request.headers.get('x-media-metadata') ?? '';
    if (!encodedMetadata || encodedMetadata.length > 4096) {
      return jsonResponse({ error: 'invalid_media_metadata' }, 400);
    }
    const metadataBytes = Buffer.from(encodedMetadata, 'base64');
    if (metadataBytes.toString('base64') !== encodedMetadata) {
      return jsonResponse({ error: 'invalid_media_metadata' }, 400);
    }
    let metadata: unknown;
    try {
      metadata = JSON.parse(metadataBytes.toString('utf8')) as unknown;
    } catch {
      return jsonResponse({ error: 'invalid_media_metadata' }, 400);
    }
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      Array.isArray(metadata) ||
      !('alt' in metadata) ||
      typeof metadata.alt !== 'string' ||
      !metadata.alt.trim() ||
      metadata.alt.length > 500 ||
      !('filename' in metadata) ||
      typeof metadata.filename !== 'string' ||
      !metadata.filename ||
      metadata.filename.length > 240
    ) {
      return jsonResponse({ error: 'invalid_media_metadata' }, 400);
    }
    const body = await readBytesBody(request, MAX_MEDIA_BYTES);
    if (!body.ok) {
      return jsonResponse(
        { error: body.reason === 'too-large' ? 'media_too_large' : 'invalid_media_body' },
        body.reason === 'too-large' ? 413 : 400,
      );
    }

    try {
      const media = await createMediaDraft(
        getDraftFirestore(),
        getDraftStorage(),
        actor,
        {
          originalName: metadata.filename,
          alt: metadata.alt,
          contentType,
          bytes: body.value,
        },
      );
      return jsonResponse({ media }, 201);
    } catch (error) {
      return mapError(error);
    }
  }

  if (!contentType.toLowerCase().includes('application/json')) {
    return jsonResponse({ error: 'unsupported_media_type' }, 415);
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > maximumMetadataRequestBytes) {
    return jsonResponse({ error: 'request_too_large' }, 413);
  }
  const body = await readJsonBody(request, maximumMetadataRequestBytes);
  if (!body.ok || typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) {
    return jsonResponse(
      { error: body.ok || body.reason === 'invalid' ? 'invalid_request' : 'request_too_large' },
      body.ok || body.reason === 'invalid' ? 400 : 413,
    );
  }

  const input = body.value as Record<string, unknown>;
  if (
    typeof input.id !== 'string' ||
    typeof input.expectedUpdatedAt !== 'string' ||
    input.expectedUpdatedAt.length > 40
  ) {
    return jsonResponse({ error: 'invalid_request' }, 400);
  }
  let update: { alt?: string; archived?: boolean };
  if (input.action === 'update-alt' && typeof input.alt === 'string') {
    update = { alt: input.alt };
  } else if (input.action === 'archive') {
    update = { archived: true };
  } else if (input.action === 'restore') {
    update = { archived: false };
  } else {
    return jsonResponse({ error: 'unsupported_media_operation' }, 400);
  }

  try {
    const media: MediaDraft = await updateMediaDraft(
      getDraftFirestore(),
      actor,
      input.id,
      input.expectedUpdatedAt,
      update,
    );
    return jsonResponse({ media }, 200);
  } catch (error) {
    return mapError(error);
  }
};
