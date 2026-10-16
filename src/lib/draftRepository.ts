import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  DRAFT_COLLECTION_PATHS,
  ContentValidationError,
  draftDocumentPath,
  parseBusinessDetailsDraft,
  parseMediaDraft,
  parsePageDraft,
  parseProjectDraft,
  parseSeoDraft,
  parseServiceDraft,
  type BusinessDetailsDraft,
  type PageDraft,
  type ProjectDraft,
  type SeoDraft,
  type ServiceDraft,
} from './contentModel.ts';

export interface AdminActor {
  uid: string;
  admin: true;
}

export class DraftConflictError extends Error {
  constructor(message = 'The draft changed since it was loaded. Reload before saving.') {
    super(message);
    this.name = 'DraftConflictError';
  }
}

export class DraftNotFoundError extends Error {
  constructor() {
    super('The requested draft does not exist.');
    this.name = 'DraftNotFoundError';
  }
}

function assertAdmin(actor: AdminActor | undefined): asserts actor is AdminActor {
  if (!actor || actor.admin !== true || !actor.uid) {
    throw new Error('An authenticated administrator is required.');
  }
}

function sorted<T extends { id: string; order: number }>(records: T[]): T[] {
  return records.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function nextUpdatedAt(previous: unknown): string {
  const previousTime = typeof previous === 'string' ? Date.parse(previous) : Number.NaN;
  return new Date(Math.max(Date.now(), Number.isNaN(previousTime) ? 0 : previousTime + 1)).toISOString();
}

async function assertMediaReference(
  transaction: Transaction,
  firestore: Firestore,
  id: string | null,
  previousId: string | null,
): Promise<void> {
  if (id === null) return;
  const reference = firestore.doc(draftDocumentPath('media', id));
  const document = await transaction.get(reference);
  if (!document.exists) {
    throw new ContentValidationError('imageRef', 'must refer to an existing media asset');
  }
  const media = parseMediaDraft(document.data());
  if (media.id !== document.id) {
    throw new ContentValidationError('imageRef', 'does not match its media document');
  }
  if (media.archived && id !== previousId) {
    throw new ContentValidationError('imageRef', 'cannot select an archived media asset');
  }
}

export async function listServiceDrafts(
  firestore: Firestore,
  actor: AdminActor | undefined,
): Promise<ServiceDraft[]> {
  assertAdmin(actor);
  const snapshot = await firestore.collection(DRAFT_COLLECTION_PATHS.services).get();
  return sorted(snapshot.docs.map((document) => {
    const value = parseServiceDraft(document.data());
    if (value.id !== document.id) {
      throw new ContentValidationError('id', 'does not match its Firestore document id');
    }
    return value;
  }));
}

export async function getServiceDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  id: string,
): Promise<ServiceDraft> {
  assertAdmin(actor);
  const document = await firestore.doc(draftDocumentPath('services', id)).get();
  if (!document.exists) throw new DraftNotFoundError();
  const value = parseServiceDraft(document.data());
  if (value.id !== document.id) {
    throw new ContentValidationError('id', 'does not match its Firestore document id');
  }
  return value;
}

export async function saveServiceDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  value: unknown,
  expectedUpdatedAt: string | null,
): Promise<ServiceDraft> {
  assertAdmin(actor);
  const parsed = parseServiceDraft(value);
  const reference = firestore.doc(draftDocumentPath('services', parsed.id));
  let saved: ServiceDraft = parsed;

  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (expectedUpdatedAt === null ? existing.exists : !existing.exists) {
      throw new DraftConflictError();
    }
    if (existing.exists && existing.get('updatedAt') !== expectedUpdatedAt) {
      throw new DraftConflictError();
    }
    const previous = existing.exists ? parseServiceDraft(existing.data()) : undefined;
    await assertMediaReference(transaction, firestore, parsed.imageRef, previous?.imageRef ?? null);
    const updated = { ...parsed, updatedAt: nextUpdatedAt(existing.get('updatedAt')) };
    saved = updated;
    transaction.set(reference, updated);
  });

  return saved;
}

export async function setServiceDraftArchived(
  firestore: Firestore,
  actor: AdminActor | undefined,
  id: string,
  archived: boolean,
  expectedUpdatedAt: string,
): Promise<ServiceDraft> {
  assertAdmin(actor);
  const reference = firestore.doc(draftDocumentPath('services', id));
  return firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (!existing.exists || existing.get('updatedAt') !== expectedUpdatedAt) {
      throw new DraftConflictError();
    }
    const current = parseServiceDraft(existing.data());
    const updated = { ...current, archived, updatedAt: nextUpdatedAt(current.updatedAt) };
    transaction.set(reference, updated);
    return updated;
  });
}

export async function listProjectDrafts(
  firestore: Firestore,
  actor: AdminActor | undefined,
): Promise<ProjectDraft[]> {
  assertAdmin(actor);
  const snapshot = await firestore.collection(DRAFT_COLLECTION_PATHS.projects).get();
  return sorted(snapshot.docs.map((document) => {
    const value = parseProjectDraft(document.data());
    if (value.id !== document.id) {
      throw new ContentValidationError('id', 'does not match its Firestore document id');
    }
    return value;
  }));
}

export async function getProjectDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  id: string,
): Promise<ProjectDraft> {
  assertAdmin(actor);
  const document = await firestore.doc(draftDocumentPath('projects', id)).get();
  if (!document.exists) throw new DraftNotFoundError();
  const value = parseProjectDraft(document.data());
  if (value.id !== document.id) {
    throw new ContentValidationError('id', 'does not match its Firestore document id');
  }
  return value;
}

export async function getPageDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  id: string,
): Promise<PageDraft> {
  assertAdmin(actor);
  const document = await firestore.doc(draftDocumentPath('pages', id)).get();
  if (!document.exists) throw new DraftNotFoundError();
  const value = parsePageDraft(document.data());
  if (value.pageId !== document.id) {
    throw new ContentValidationError('pageId', 'does not match its Firestore document id');
  }
  return value;
}

export async function getBusinessDetailsDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
): Promise<BusinessDetailsDraft> {
  assertAdmin(actor);
  const document = await firestore.doc('drafts/settings/records/businessDetails').get();
  if (!document.exists) throw new DraftNotFoundError();
  return parseBusinessDetailsDraft(document.data());
}

export async function getSeoDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
): Promise<SeoDraft> {
  assertAdmin(actor);
  const document = await firestore.doc(draftDocumentPath('settings', 'seo')).get();
  if (!document.exists) throw new DraftNotFoundError();
  return parseSeoDraft(document.data());
}

export async function saveProjectDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  value: unknown,
  expectedUpdatedAt: string | null,
): Promise<ProjectDraft> {
  assertAdmin(actor);
  const parsed = parseProjectDraft(value);
  const reference = firestore.doc(draftDocumentPath('projects', parsed.id));
  let saved: ProjectDraft = parsed;

  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (expectedUpdatedAt === null ? existing.exists : !existing.exists) {
      throw new DraftConflictError();
    }
    if (existing.exists && existing.get('updatedAt') !== expectedUpdatedAt) {
      throw new DraftConflictError();
    }
    const previous = existing.exists ? parseProjectDraft(existing.data()) : undefined;
    await assertMediaReference(transaction, firestore, parsed.imageRef, previous?.imageRef ?? null);
    const updated = { ...parsed, updatedAt: nextUpdatedAt(existing.get('updatedAt')) };
    saved = updated;
    transaction.set(reference, updated);
  });

  return saved;
}

export async function setProjectDraftArchived(
  firestore: Firestore,
  actor: AdminActor | undefined,
  id: string,
  archived: boolean,
  expectedUpdatedAt: string,
): Promise<ProjectDraft> {
  assertAdmin(actor);
  const reference = firestore.doc(draftDocumentPath('projects', id));
  return firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (!existing.exists || existing.get('updatedAt') !== expectedUpdatedAt) {
      throw new DraftConflictError();
    }
    const current = parseProjectDraft(existing.data());
    const updated = { ...current, archived, updatedAt: nextUpdatedAt(current.updatedAt) };
    transaction.set(reference, updated);
    return updated;
  });
}

async function saveSingleton<T>(
  firestore: Firestore,
  actor: AdminActor | undefined,
  path: string,
  value: unknown,
  expectedUpdatedAt: string | null,
  parse: (input: unknown) => T,
): Promise<T> {
  assertAdmin(actor);
  const parsed = parse(value);
  const reference = firestore.doc(path);
  let saved = parsed;

  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (expectedUpdatedAt === null ? existing.exists : !existing.exists) {
      throw new DraftConflictError();
    }
    if (existing.exists && existing.get('updatedAt') !== expectedUpdatedAt) {
      throw new DraftConflictError();
    }
    const updated = { ...parsed, updatedAt: nextUpdatedAt(existing.get('updatedAt')) };
    saved = updated as T;
    transaction.set(reference, updated);
  });

  return saved as T;
}

export function savePageDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  value: unknown,
  expectedUpdatedAt: string | null,
): Promise<PageDraft> {
  const parsed = parsePageDraft(value);
  return saveSingleton(
    firestore,
    actor,
    draftDocumentPath('pages', parsed.pageId),
    parsed,
    expectedUpdatedAt,
    parsePageDraft,
  );
}

export function saveBusinessDetailsDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  value: unknown,
  expectedUpdatedAt: string | null,
): Promise<BusinessDetailsDraft> {
  return saveSingleton(
    firestore,
    actor,
    'drafts/settings/records/businessDetails',
    value,
    expectedUpdatedAt,
    parseBusinessDetailsDraft,
  );
}

export async function saveSeoDraft(
  firestore: Firestore,
  actor: AdminActor | undefined,
  value: unknown,
  expectedUpdatedAt: string | null,
): Promise<SeoDraft> {
  assertAdmin(actor);
  const parsed = parseSeoDraft(value);
  const reference = firestore.doc(draftDocumentPath('settings', 'seo'));
  let saved = parsed;

  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (expectedUpdatedAt === null ? existing.exists : !existing.exists) {
      throw new DraftConflictError();
    }
    if (existing.exists && existing.get('updatedAt') !== expectedUpdatedAt) {
      throw new DraftConflictError();
    }
    const previous = existing.exists ? parseSeoDraft(existing.data()) : undefined;
    for (const [route, metadata] of Object.entries(parsed.routes)) {
      await assertMediaReference(
        transaction,
        firestore,
        metadata.shareImageRef,
        previous?.routes[route as keyof SeoDraft['routes']]?.shareImageRef ?? null,
      );
    }
    saved = { ...parsed, updatedAt: nextUpdatedAt(existing.get('updatedAt')) };
    transaction.set(reference, saved);
  });

  return saved;
}
