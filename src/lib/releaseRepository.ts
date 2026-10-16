import { createHash, randomUUID } from 'node:crypto';
import type { Bucket } from '@google-cloud/storage';
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  CONTENT_SCHEMA_VERSION,
  DRAFT_COLLECTION_PATHS,
  PAGE_IDS,
  ContentValidationError,
  parseBusinessDetailsDraft,
  parseContentSnapshot,
  parseMediaDraft,
  parsePageDraft,
  parseProjectDraft,
  parseReleaseRecord,
  parseSeoDraft,
  parseServiceDraft,
  type ContentSnapshot,
  type MediaDraft,
  type PageId,
  type ReleaseRecord,
} from './contentModel.ts';
import type { AdminActor } from './draftRepository.ts';
import { collectDraftPreviewIssues } from './draftPreview.ts';

const releaseCollection = 'releases';
const publishLockPath = 'locks/publish';
const releaseLimit = 20;

export class ReleaseInProgressError extends Error {
  constructor() {
    super('Another release is already in progress.');
    this.name = 'ReleaseInProgressError';
  }
}

export class ReleaseNotFoundError extends Error {
  constructor() {
    super('The requested release does not exist.');
    this.name = 'ReleaseNotFoundError';
  }
}

export class ReleaseValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`The draft cannot be published: ${issues.join(' ')}`);
    this.name = 'ReleaseValidationError';
    this.issues = issues;
  }
}

export class ReleaseRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseRecordError';
  }
}

function assertAdmin(actor: AdminActor | undefined): asserts actor is AdminActor {
  if (!actor || actor.admin !== true || !actor.uid) {
    throw new Error('An authenticated administrator is required.');
  }
}

function sortableReleaseId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function requestDocumentId(uid: string, requestId: string): string {
  return createHash('sha256').update(`${uid}\0${requestId}`).digest('hex');
}

function parsedDocuments<T>(
  documents: QueryDocumentSnapshot[],
  parse: (value: unknown) => T,
  getId: (value: T) => string,
  field: string,
): T[] {
  return documents.map((document) => {
    const value = parse(document.data());
    if (getId(value) !== document.id) {
      throw new ContentValidationError(field, `does not match document ${document.id}`);
    }
    return value;
  });
}

function mediaReferences(snapshot: ContentSnapshot): string[] {
  const ids = new Set<string>();
  snapshot.services.forEach(({ imageRef }) => {
    if (imageRef) ids.add(imageRef);
  });
  snapshot.projects.forEach(({ imageRef }) => {
    if (imageRef) ids.add(imageRef);
  });
  Object.values(snapshot.seo.routes).forEach((route) => {
    if (route?.shareImageRef) ids.add(route.shareImageRef);
  });
  return [...ids].sort();
}

function createSnapshot(input: {
  services: unknown[];
  projects: unknown[];
  pages: unknown[];
  businessDetails: unknown;
  seo: unknown;
  media: unknown[];
}): ContentSnapshot {
  const services = input.services.map(parseServiceDraft)
    .filter((service) => !service.archived)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const projects = input.projects.map(parseProjectDraft)
    .filter((project) => !project.archived)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const pages = input.pages.map(parsePageDraft)
    .sort((left, right) => left.pageId.localeCompare(right.pageId));
  const seo = parseSeoDraft(input.seo);
  const referencedIds = new Set<string>();
  services.forEach(({ imageRef }) => {
    if (imageRef) referencedIds.add(imageRef);
  });
  projects.forEach(({ imageRef }) => {
    if (imageRef) referencedIds.add(imageRef);
  });
  Object.values(seo.routes).forEach((route) => {
    if (route?.shareImageRef) referencedIds.add(route.shareImageRef);
  });
  const media = input.media.map(parseMediaDraft)
    .filter((asset) => referencedIds.has(asset.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  return parseContentSnapshot({
    schemaVersion: CONTENT_SCHEMA_VERSION,
    services,
    projects,
    pages,
    businessDetails: parseBusinessDetailsDraft(input.businessDetails),
    seo,
    media,
  });
}

async function assertReferencedMediaExists(
  bucket: Bucket,
  snapshot: ContentSnapshot,
): Promise<void> {
  const byId = new Map(snapshot.media.map((asset) => [asset.id, asset]));
  const referencedIds = mediaReferences(snapshot);
  const availableMediaIds: string[] = [];
  const missing: string[] = [];
  await Promise.all(referencedIds.map(async (id) => {
    const asset = byId.get(id);
    if (!asset) {
      missing.push(id);
      return;
    }
    const [exists] = await bucket.file(asset.storagePath).exists();
    if (exists) availableMediaIds.push(id);
    else missing.push(id);
  }));

  const issues = collectDraftPreviewIssues({
    services: snapshot.services,
    projects: snapshot.projects,
    pages: Object.fromEntries(snapshot.pages.map((page) => [page.pageId, page] as const)),
    businessDetails: snapshot.businessDetails,
    seo: snapshot.seo,
    media: snapshot.media,
    availableMediaIds,
  }).filter((issue) => issue.blocking);
  if (missing.length > 0) issues.push({
    id: 'missing-media',
    scope: 'Media',
    message: `Referenced media is missing or archived: ${missing.sort().join(', ')}.`,
    blocking: true,
    href: '/admin/media',
  });
  if (issues.length > 0) {
    throw new ReleaseValidationError(issues.map(({ scope, message }) => `${scope}: ${message}`));
  }
}

export async function createPublishRelease(
  firestore: Firestore,
  bucket: Bucket,
  actor: AdminActor | undefined,
  requestId: string,
  now = new Date(),
): Promise<{ release: ReleaseRecord; duplicate: boolean }> {
  assertAdmin(actor);
  const releaseId = sortableReleaseId(now);
  const releaseRef = firestore.collection(releaseCollection).doc(releaseId);
  const lockRef = firestore.doc(publishLockPath);
  const requestRef = firestore.doc(
    `${publishLockPath}/requests/${requestDocumentId(actor.uid, requestId)}`,
  );

  const result = await firestore.runTransaction(async (transaction) => {
    const [lock, request] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(requestRef),
    ]);
    if (request.exists) {
      const existingReleaseId = request.get('releaseId');
      if (typeof existingReleaseId !== 'string') {
        throw new ReleaseRecordError('The stored publish request is invalid.');
      }
      const existing = await transaction.get(firestore.doc(`${releaseCollection}/${existingReleaseId}`));
      if (!existing.exists) throw new ReleaseRecordError('The idempotent release record is missing.');
      return { release: parseReleaseRecord(existing.data()), duplicate: true };
    }
    if (lock.exists) throw new ReleaseInProgressError();

    const [servicesQuery, projectsQuery, pagesQuery, mediaQuery, businessDetailsDoc, seoDoc] =
      await Promise.all([
        transaction.get(firestore.collection(DRAFT_COLLECTION_PATHS.services)),
        transaction.get(firestore.collection(DRAFT_COLLECTION_PATHS.projects)),
        transaction.get(firestore.collection(DRAFT_COLLECTION_PATHS.pages)),
        transaction.get(firestore.collection(DRAFT_COLLECTION_PATHS.media)),
        transaction.get(firestore.doc('drafts/settings/records/businessDetails')),
        transaction.get(firestore.doc('drafts/settings/records/seo')),
      ]);
    if (!businessDetailsDoc.exists || !seoDoc.exists) {
      throw new ReleaseValidationError([
        'Business details and SEO drafts must both be saved before publishing.',
      ]);
    }

    const rawPages = parsedDocuments(
      pagesQuery.docs,
      parsePageDraft,
      (page) => page.pageId,
      'pageId',
    );
    if (rawPages.some((page) => !PAGE_IDS.includes(page.pageId as PageId))) {
      throw new ContentValidationError('pages', 'contains an unsupported page');
    }
    const rawMedia = parsedDocuments(mediaQuery.docs, parseMediaDraft, (asset) => asset.id, 'id');
    const snapshot = createSnapshot({
      services: parsedDocuments(
        servicesQuery.docs,
        parseServiceDraft,
        (service) => service.id,
        'id',
      ),
      projects: parsedDocuments(
        projectsQuery.docs,
        parseProjectDraft,
        (project) => project.id,
        'id',
      ),
      pages: rawPages,
      businessDetails: businessDetailsDoc.data(),
      seo: seoDoc.data(),
      media: rawMedia,
    });
    const release = parseReleaseRecord({
      schemaVersion: CONTENT_SCHEMA_VERSION,
      id: releaseId,
      createdAt: now.toISOString(),
      completedAt: null,
      createdBy: actor.uid,
      snapshot,
      mediaRefs: mediaReferences(snapshot),
      status: 'queued',
      hostVersionId: null,
      buildId: null,
      failure: null,
      rollbackOf: null,
    });

    transaction.create(releaseRef, release);
    transaction.create(requestRef, { releaseId, createdAt: now.toISOString() });
    transaction.create(lockRef, { releaseId, createdAt: now.toISOString() });
    return { release, duplicate: false };
  });

  if (!result.duplicate) {
    try {
      await assertReferencedMediaExists(bucket, result.release.snapshot);
    } catch (error) {
      await finishRelease(firestore, result.release.id, {
        status: 'failed',
        failure: {
          code: error instanceof ReleaseValidationError ? 'invalid_media' : 'media_check_failed',
          message: error instanceof Error ? error.message : 'Referenced media could not be checked.',
        },
      });
      throw error;
    }
  }
  return result;
}

export async function createRollbackRelease(
  firestore: Firestore,
  bucket: Bucket,
  actor: AdminActor | undefined,
  targetId: string,
  requestId: string,
  now = new Date(),
): Promise<{ release: ReleaseRecord; duplicate: boolean }> {
  assertAdmin(actor);
  const releaseId = sortableReleaseId(now);
  const releaseRef = firestore.collection(releaseCollection).doc(releaseId);
  const targetRef = firestore.doc(`${releaseCollection}/${targetId}`);
  const lockRef = firestore.doc(publishLockPath);
  const requestRef = firestore.doc(
    `${publishLockPath}/requests/${requestDocumentId(actor.uid, requestId)}`,
  );

  const result = await firestore.runTransaction(async (transaction) => {
    const [lock, request, target] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(requestRef),
      transaction.get(targetRef),
    ]);
    if (request.exists) {
      const existingReleaseId = request.get('releaseId');
      if (typeof existingReleaseId !== 'string') {
        throw new ReleaseRecordError('The stored rollback request is invalid.');
      }
      const existing = await transaction.get(firestore.doc(`${releaseCollection}/${existingReleaseId}`));
      if (!existing.exists) throw new ReleaseRecordError('The idempotent rollback record is missing.');
      return { release: parseReleaseRecord(existing.data()), duplicate: true };
    }
    if (lock.exists) throw new ReleaseInProgressError();
    if (!target.exists) throw new ReleaseNotFoundError();
    const previous = parseReleaseRecord(target.data());
    if (previous.status !== 'live') {
      throw new ReleaseRecordError('Only a previously published release can be restored.');
    }
    const release = parseReleaseRecord({
      ...previous,
      id: releaseId,
      createdAt: now.toISOString(),
      completedAt: null,
      createdBy: actor.uid,
      status: 'rollback',
      hostVersionId: null,
      buildId: null,
      failure: null,
      rollbackOf: previous.id,
    });

    transaction.create(releaseRef, release);
    transaction.create(requestRef, { releaseId, createdAt: now.toISOString() });
    transaction.create(lockRef, { releaseId, createdAt: now.toISOString() });
    return { release, duplicate: false };
  });
  if (!result.duplicate) {
    try {
      await assertReferencedMediaExists(bucket, result.release.snapshot);
    } catch (error) {
      await finishRelease(firestore, result.release.id, {
        status: 'failed',
        failure: {
          code: error instanceof ReleaseValidationError ? 'invalid_media' : 'media_check_failed',
          message: error instanceof Error ? error.message : 'Referenced media could not be checked.',
        },
      });
      throw error;
    }
  }
  return result;
}

export async function getRelease(
  firestore: Firestore,
  id: string,
): Promise<ReleaseRecord> {
  const document = await firestore.doc(`${releaseCollection}/${id}`).get();
  if (!document.exists) throw new ReleaseNotFoundError();
  return parseReleaseRecord(document.data());
}

export async function listReleases(firestore: Firestore): Promise<ReleaseRecord[]> {
  const snapshot = await firestore.collection(releaseCollection)
    .orderBy('createdAt', 'desc')
    .limit(releaseLimit)
    .get();
  return snapshot.docs.map((document) => {
    const release = parseReleaseRecord(document.data());
    if (release.id !== document.id) {
      throw new ContentValidationError('id', 'does not match its release document id');
    }
    return release;
  });
}

export async function setReleaseBuildId(
  firestore: Firestore,
  id: string,
  buildId: string,
): Promise<void> {
  const reference = firestore.doc(`${releaseCollection}/${id}`);
  await firestore.runTransaction(async (transaction) => {
    const document = await transaction.get(reference);
    if (!document.exists) throw new ReleaseNotFoundError();
    const release = parseReleaseRecord(document.data());
    if (release.status === 'live' || release.status === 'failed') {
      throw new ReleaseRecordError('A completed release cannot be assigned a build.');
    }
    if (release.buildId && release.buildId !== buildId) {
      throw new ReleaseRecordError('The release is already associated with a different build.');
    }
    if (release.buildId === buildId) return;
    transaction.update(reference, { buildId });
  });
}

export async function setReleaseStatus(
  firestore: Firestore,
  id: string,
  status: 'building' | 'deploying',
): Promise<void> {
  const reference = firestore.doc(`${releaseCollection}/${id}`);
  await firestore.runTransaction(async (transaction) => {
    const document = await transaction.get(reference);
    if (!document.exists) throw new ReleaseNotFoundError();
    const release = parseReleaseRecord(document.data());
    const allowedTransitions: Partial<Record<ReleaseRecord['status'], string[]>> = {
      queued: ['building'],
      rollback: ['building'],
      building: ['deploying'],
    };
    if (!allowedTransitions[release.status]?.includes(status)) {
      throw new ReleaseRecordError(
        `Release cannot transition from ${release.status} to ${status}.`,
      );
    }
    transaction.update(reference, { status });
  });
}

export async function finishRelease(
  firestore: Firestore,
  id: string,
  result:
    | { status: 'live'; hostVersionId: string }
    | { status: 'failed'; failure: NonNullable<ReleaseRecord['failure']> },
  now = new Date(),
): Promise<void> {
  const reference = firestore.doc(`${releaseCollection}/${id}`);
  const lockRef = firestore.doc(publishLockPath);
  await firestore.runTransaction(async (transaction) => {
    const [document, lock] = await Promise.all([
      transaction.get(reference),
      transaction.get(lockRef),
    ]);
    if (!document.exists) throw new ReleaseNotFoundError();
    const release = parseReleaseRecord(document.data());
    if (release.status === 'live' || release.status === 'failed') {
      if (release.status === result.status) return;
      throw new ReleaseRecordError('A completed release cannot change its result.');
    }
    if (result.status === 'live' && release.status !== 'deploying') {
      throw new ReleaseRecordError('A release must be deploying before it can be marked live.');
    }
    transaction.update(reference, result.status === 'live'
      ? {
          status: 'live',
          hostVersionId: result.hostVersionId,
          completedAt: now.toISOString(),
          failure: null,
        }
      : {
          status: 'failed',
          completedAt: now.toISOString(),
          failure: result.failure,
        });
    if (lock.exists && lock.get('releaseId') === id) transaction.delete(lockRef);
  });
}

export function getReleaseMedia(snapshot: ContentSnapshot): MediaDraft[] {
  const ids = new Set(mediaReferences(snapshot));
  return snapshot.media.filter((asset) => ids.has(asset.id));
}
