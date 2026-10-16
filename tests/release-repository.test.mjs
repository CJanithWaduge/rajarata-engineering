import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  CONTENT_SCHEMA_VERSION,
  parseReleaseRecord,
} from '../src/lib/contentModel.ts';
import {
  createPublishRelease,
  createRollbackRelease,
  finishRelease,
  getRelease,
  listReleases,
  ReleaseInProgressError,
  ReleaseRecordError,
  ReleaseValidationError,
  setReleaseBuildId,
  setReleaseStatus,
} from '../src/lib/releaseRepository.ts';

const projectId = 'demo-rajarata-engineering';
const actor = { uid: 'publishing-emulator-admin', admin: true };
const marker = `release-test-${Date.now()}`;
const bucketName = `${projectId}.appspot.com`;

let app;
let firestore;
let bucket;
let testQueue = Promise.resolve();

function serialTest(name, run) {
  test(name, () => {
    const current = testQueue.then(run);
    testQueue = current.catch(() => {});
    return current;
  });
}

function service(id, order, overrides = {}) {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id,
    order,
    category: 'LV Distribution',
    title: `Service ${id}`,
    summary: 'A validated summary for publication.',
    body: '',
    scope: '',
    suitability: [],
    imageRef: null,
    archived: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function emptyPage(pageId) {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    pageId,
    sections: {},
    updatedAt: new Date().toISOString(),
  };
}

async function seedRequiredDrafts() {
  const timestamp = new Date().toISOString();
  await Promise.all([
    firestore.doc('drafts/settings/records/businessDetails').set({
      schemaVersion: CONTENT_SCHEMA_VERSION,
      address: '',
      phone: '',
      email: '',
      hours: '',
      whatsapp: '',
      updatedAt: timestamp,
    }),
    firestore.doc('drafts/settings/records/seo').set({
      schemaVersion: CONTENT_SCHEMA_VERSION,
      routes: {},
      updatedAt: timestamp,
    }),
  ]);
}

async function completeBuild(releaseId, buildStartsBeforeId = false) {
  if (buildStartsBeforeId) await setReleaseStatus(firestore, releaseId, 'building');
  await setReleaseBuildId(firestore, releaseId, `build-${releaseId}`);
  if (!buildStartsBeforeId) await setReleaseStatus(firestore, releaseId, 'building');
  await setReleaseStatus(firestore, releaseId, 'deploying');
  await finishRelease(firestore, releaseId, {
    status: 'live',
    hostVersionId: `sites/${projectId}/versions/version-${releaseId}`,
  });
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore emulator is required.');
  assert.ok(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage emulator is required.');
  app = initializeApp({ projectId }, `release-repository-${process.pid}`);
  firestore = getFirestore(app);
  bucket = getStorage(app).bucket(bucketName);
});

after(async () => {
  await app?.delete();
});

afterEach(async () => {
  if (!firestore) return;
  const collections = [
    'drafts/services/records',
    'drafts/projects/records',
    'drafts/media/records',
  ];
  const snapshots = await Promise.all(
    collections.map((path) => firestore.collection(path).get()),
  );
  const documents = snapshots.flatMap((snapshot) =>
    snapshot.docs.filter(({ id }) => id.startsWith(marker)),
  );
  await Promise.all(documents.map((document) => document.ref.delete()));
});

serialTest('publish captures a stable snapshot, filters archived content, and is idempotent', async () => {
  await seedRequiredDrafts();
  await firestore.doc(`drafts/services/records/${marker}-active`).set(
    service(`${marker}-active`, 2),
  );
  await firestore.doc(`drafts/services/records/${marker}-archived`).set(
    service(`${marker}-archived`, 1, { archived: true }),
  );
  await firestore.doc(`drafts/pages/records/home`).set(emptyPage('home'));

  const requestId = `${marker}-publish-0001`;
  const created = await createPublishRelease(firestore, bucket, actor, requestId);
  assert.equal(created.duplicate, false);
  assert.deepEqual(created.release.snapshot.services.map(({ id }) => id), [`${marker}-active`]);
  assert.equal(created.release.status, 'queued');
  assert.equal(created.release.completedAt, null);
  assert.deepEqual(created.release.mediaRefs, []);
  assert.equal(
    (await firestore.doc(`releases/${created.release.id}`).get()).exists,
    true,
    created.release.id,
  );

  const duplicate = await createPublishRelease(firestore, bucket, actor, requestId);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.release.id, created.release.id);

  const inFlight = createPublishRelease(
    firestore,
    bucket,
    actor,
    `${marker}-publish-0002`,
  );
  await assert.rejects(inFlight, ReleaseInProgressError);
  assert.equal(
    (await firestore.doc(`releases/${created.release.id}`).get()).exists,
    true,
    `Release disappeared after the concurrent request: ${created.release.id}`,
  );
  assert.equal(await firestore.runTransaction(async (transaction) =>
    (await transaction.get(firestore.doc(`releases/${created.release.id}`))).exists,
  ), true);

  await completeBuild(created.release.id, true);
  const live = await getRelease(firestore, created.release.id);
  assert.equal(live.status, 'live');
  assert.ok(live.completedAt);
  assert.ok(live.hostVersionId);
  assert.equal((await firestore.doc('locks/publish').get()).exists, false);
});

serialTest('invalid content is recorded as failed and the publish lock is released', async () => {
  await seedRequiredDrafts();
  await firestore.doc(`drafts/services/records/${marker}-invalid`).set(
    service(`${marker}-invalid`, 0, { title: '', summary: '' }),
  );

  await assert.rejects(
    createPublishRelease(firestore, bucket, actor, `${marker}-invalid-0001`),
    ReleaseValidationError,
  );
  const releases = await listReleases(firestore);
  const failed = releases.find(({ snapshot }) =>
    snapshot.services.some(({ id }) => id === `${marker}-invalid`),
  );
  assert.equal(failed?.status, 'failed');
  assert.equal((await firestore.doc('locks/publish').get()).exists, false);
});

serialTest('rollback creates a new release from a retained published snapshot', async () => {
  await seedRequiredDrafts();
  await firestore.doc(`drafts/services/records/${marker}-rollback`).set(
    service(`${marker}-rollback`, 0),
  );
  const original = await createPublishRelease(
    firestore,
    bucket,
    actor,
    `${marker}-rollback-source`,
  );
  await completeBuild(original.release.id);

  await firestore.doc(`drafts/services/records/${marker}-later`).set(
    service(`${marker}-later`, 1),
  );
  const rollback = await createRollbackRelease(
    firestore,
    bucket,
    actor,
    original.release.id,
    `${marker}-rollback-request`,
  );
  assert.equal(rollback.release.status, 'rollback');
  assert.equal(rollback.release.rollbackOf, original.release.id);
  assert.deepEqual(rollback.release.snapshot, original.release.snapshot);
  assert.equal(rollback.release.id === original.release.id, false);

  await assert.rejects(
    setReleaseStatus(firestore, rollback.release.id, 'deploying'),
    (error) => error instanceof ReleaseRecordError,
  );
  await setReleaseStatus(firestore, rollback.release.id, 'building');
  await setReleaseStatus(firestore, rollback.release.id, 'deploying');
  await finishRelease(firestore, rollback.release.id, {
    status: 'live',
    hostVersionId: `sites/${projectId}/versions/rollback-${rollback.release.id}`,
  });

  const persisted = await getRelease(firestore, rollback.release.id);
  assert.equal(parseReleaseRecord(persisted).status, 'live');
  assert.equal(persisted.rollbackOf, original.release.id);
  assert.equal((await listReleases(firestore)).length >= 2, true);
});

serialTest('failed build records do not claim Hosting success and allow a deliberate retry', async () => {
  await seedRequiredDrafts();
  const requestId = `${marker}-failed-build`;
  const release = await createPublishRelease(firestore, bucket, actor, requestId);
  await setReleaseBuildId(firestore, release.release.id, `build-failed-${marker}`);
  await setReleaseStatus(firestore, release.release.id, 'building');
  await finishRelease(firestore, release.release.id, {
    status: 'failed',
    failure: { code: 'build_failed', message: 'The build failed before deployment.' },
  });

  const persisted = await getRelease(firestore, release.release.id);
  assert.equal(persisted.status, 'failed');
  assert.equal(persisted.hostVersionId, null);
  assert.equal((await firestore.doc('locks/publish').get()).exists, false);

  const retry = await createPublishRelease(
    firestore,
    bucket,
    actor,
    `${marker}-failed-build-retry`,
  );
  assert.notEqual(retry.release.id, release.release.id);
});
