import { randomUUID } from 'node:crypto';
import type { Bucket } from '@google-cloud/storage';
import type { Firestore } from 'firebase-admin/firestore';
import {
  CONTENT_SCHEMA_VERSION,
  DRAFT_COLLECTION_PATHS,
  ContentValidationError,
  draftDocumentPath,
  parseMediaDraft,
  parseProjectDraft,
  parseReleaseRecord,
  parseSeoDraft,
  parseServiceDraft,
  type MediaDraft,
} from './contentModel.ts';
import {
  DraftConflictError,
  DraftNotFoundError,
  type AdminActor,
} from './draftRepository.ts';
import { inspectImage, safeMediaFilename } from './mediaFile.ts';

function assertAdmin(actor: AdminActor | undefined): asserts actor is AdminActor {
  if (!actor || actor.admin !== true || !actor.uid) {
    throw new Error('An authenticated administrator is required.');
  }
}

export interface MediaUpload {
  originalName: string;
  alt: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface MediaListItem extends MediaDraft {
  usedBy: string[];
}

export async function createMediaDraft(
  firestore: Firestore,
  bucket: Bucket,
  actor: AdminActor | undefined,
  upload: MediaUpload,
): Promise<MediaDraft> {
  assertAdmin(actor);
  if (!upload.alt.trim() || upload.alt.length > 500) {
    throw new ContentValidationError('alt', 'must contain 1 to 500 characters');
  }

  const inspected = inspectImage(upload.bytes, upload.contentType);
  const id = `asset-${randomUUID().replaceAll('-', '')}`;
  const filename = safeMediaFilename(upload.originalName, inspected.contentType);
  const storagePath = `media/drafts/${id}/${filename}`;
  const media = parseMediaDraft({
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id,
    filename,
    alt: upload.alt.trim(),
    width: inspected.width,
    height: inspected.height,
    contentType: inspected.contentType,
    bytes: upload.bytes.byteLength,
    storagePath,
    archived: false,
    updatedAt: new Date().toISOString(),
  });
  const object = bucket.file(storagePath);

  await object.save(Buffer.from(upload.bytes), {
    resumable: false,
    metadata: {
      contentType: media.contentType,
      cacheControl: 'private, no-store, max-age=0',
      metadata: { assetId: media.id },
    },
  });

  try {
    await firestore.doc(draftDocumentPath('media', id)).create(media);
  } catch (error) {
    try {
      await object.delete();
    } catch (cleanupError) {
      console.error('Failed to clean up an unregistered media upload.', cleanupError);
    }
    throw error;
  }

  return media;
}

export async function getMediaDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  id: string,
): Promise<MediaDraft> {
  assertAdmin(actor);
  const document = await firestore.doc(draftDocumentPath('media', id)).get();
  if (!document.exists) throw new DraftNotFoundError();
  const media = parseMediaDraft(document.data());
  if (media.id !== document.id) {
    throw new ContentValidationError('id', 'does not match its Firestore document id');
  }
  return media;
}

export async function updateMediaDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  id: string,
  expectedUpdatedAt: string,
  update: { alt?: string; archived?: boolean },
): Promise<MediaDraft> {
  assertAdmin(actor);
  if (update.alt !== undefined && (!update.alt.trim() || update.alt.length > 500)) {
    throw new ContentValidationError('alt', 'must contain 1 to 500 characters');
  }
  if (update.archived !== undefined && typeof update.archived !== 'boolean') {
    throw new ContentValidationError('archived', 'must be a boolean');
  }

  const reference = firestore.doc(draftDocumentPath('media', id));
  return firestore.runTransaction(async (transaction) => {
    const document = await transaction.get(reference);
    if (!document.exists) throw new DraftNotFoundError();
    const current = parseMediaDraft(document.data());
    if (current.id !== document.id || current.updatedAt !== expectedUpdatedAt) {
      throw new DraftConflictError();
    }
    const updated = parseMediaDraft({
      ...current,
      ...(update.alt === undefined ? {} : { alt: update.alt.trim() }),
      ...(update.archived === undefined ? {} : { archived: update.archived }),
      updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString(),
    });
    transaction.set(reference, updated);
    return updated;
  });
}

export async function listMediaDrafts(
  firestore: Firestore,
  actor: AdminActor | undefined,
): Promise<MediaListItem[]> {
  assertAdmin(actor);
  const [mediaSnapshot, serviceSnapshot, projectSnapshot, seoDocument, releasesSnapshot] =
    await Promise.all([
      firestore.collection(DRAFT_COLLECTION_PATHS.media).get(),
      firestore.collection(DRAFT_COLLECTION_PATHS.services).get(),
      firestore.collection(DRAFT_COLLECTION_PATHS.projects).get(),
      firestore.doc('drafts/settings/records/seo').get(),
      firestore.collection('releases').get(),
    ]);

  const media = mediaSnapshot.docs.map((document) => {
    const asset = parseMediaDraft(document.data());
    if (asset.id !== document.id) {
      throw new ContentValidationError('id', 'does not match its Firestore document id');
    }
    return asset;
  });
  const usages = new Map(media.map(({ id }) => [id, [] as string[]]));
  const addUsage = (id: string | null, label: string) => {
    if (id && usages.has(id)) usages.get(id)?.push(label);
  };

  serviceSnapshot.docs.forEach((document) => {
    const service = parseServiceDraft(document.data());
    if (service.id !== document.id) {
      throw new ContentValidationError('id', 'does not match its Firestore document id');
    }
    addUsage(service.imageRef, `Service: ${service.title || service.id}`);
  });
  projectSnapshot.docs.forEach((document) => {
    const project = parseProjectDraft(document.data());
    if (project.id !== document.id) {
      throw new ContentValidationError('id', 'does not match its Firestore document id');
    }
    addUsage(project.imageRef, `Project: ${project.title || project.id}`);
  });
  if (seoDocument.exists) {
    const seo = parseSeoDraft(seoDocument.data());
    Object.entries(seo.routes).forEach(([route, metadata]) => {
      addUsage(metadata.shareImageRef, `SEO: ${route}`);
    });
  }
  releasesSnapshot.docs.forEach((document) => {
    const release = parseReleaseRecord(document.data());
    release.mediaRefs.forEach((id) => addUsage(id, `Retained release: ${release.id}`));
  });

  return media
    .map((asset) => ({ ...asset, usedBy: usages.get(asset.id) ?? [] }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
}
