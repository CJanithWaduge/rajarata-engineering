import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  DraftConflictError,
  saveServiceDraft,
} from '../src/lib/draftRepository.ts';
import {
  createMediaDraft,
  listMediaDrafts,
  updateMediaDraft,
} from '../src/lib/mediaRepository.ts';
import { inspectImage, safeMediaFilename } from '../src/lib/mediaFile.ts';
import { CONTENT_SCHEMA_VERSION } from '../src/lib/contentModel.ts';

const projectId = 'demo-rajarata-engineering';
const actor = { uid: 'media-emulator-admin', admin: true };
const marker = `media-test-${Date.now()}`;

let app;
let firestore;
let bucket;

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore emulator is required.');
  assert.ok(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage emulator is required.');
  app = initializeApp({ projectId }, `media-repository-${process.pid}`);
  firestore = getFirestore(app);
  bucket = getStorage(app).bucket(`${projectId}.appspot.com`);
});

after(async () => {
  await app?.delete();
});

test('image validation enforces the approved MIME signature and dimensions', () => {
  assert.deepEqual(inspectImage(pngHeader(640, 480), 'image/png'), {
    contentType: 'image/png',
    width: 640,
    height: 480,
  });
  assert.throws(() => inspectImage(pngHeader(1, 1), 'image/jpeg'), /does not match the image file signature/);
  assert.throws(
    () => inspectImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'),
    /incomplete/,
  );
  assert.equal(safeMediaFilename('../../Panel shot.PNG', 'image/png'), 'panel-shot.png');
});

test('media uploads persist private objects, metadata, alt edits, and safe archive/restore', async () => {
  const bytes = pngHeader(320, 200);
  const media = await createMediaDraft(firestore, bucket, actor, {
    originalName: '../../Switchboard panel.png',
    alt: 'A switchboard panel in the workshop',
    contentType: 'image/png',
    bytes,
  });

  assert.match(media.id, /^asset-[a-f0-9]{32}$/);
  assert.equal(media.filename, 'switchboard-panel.png');
  assert.equal(media.storagePath, `media/drafts/${media.id}/${media.filename}`);
  assert.equal(media.bytes, bytes.byteLength);
  assert.equal(media.width, 320);
  assert.equal(media.height, 200);
  const file = bucket.file(media.storagePath);
  assert.equal((await file.exists())[0], true);
  assert.deepEqual((await file.download())[0], Buffer.from(bytes));

  const serviceId = `${marker}-service`;
  const service = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: serviceId,
    order: 0,
    category: '',
    title: 'Media reference test',
    summary: '',
    body: '',
    scope: '',
    suitability: [],
    imageRef: media.id,
    archived: false,
    updatedAt: new Date().toISOString(),
  };
  await saveServiceDraft(firestore, actor, service, null);

  const listed = await listMediaDrafts(firestore, actor);
  assert.deepEqual(listed.find(({ id }) => id === media.id)?.usedBy, [
    `Service: ${service.title}`,
  ]);

  const edited = await updateMediaDraft(firestore, actor, media.id, media.updatedAt, {
    alt: 'Updated switchboard panel description',
  });
  assert.equal(edited.alt, 'Updated switchboard panel description');
  await assert.rejects(
    updateMediaDraft(firestore, actor, media.id, media.updatedAt, { archived: true }),
    DraftConflictError,
  );

  const archived = await updateMediaDraft(firestore, actor, media.id, edited.updatedAt, {
    archived: true,
  });
  assert.equal(archived.archived, true);
  assert.equal((await bucket.file(archived.storagePath).exists())[0], true);
  await assert.rejects(
    saveServiceDraft(
      firestore,
      actor,
      { ...service, id: `${marker}-new-service`, imageRef: media.id },
      null,
    ),
    /archived media asset/,
  );

  const restored = await updateMediaDraft(firestore, actor, media.id, archived.updatedAt, {
    archived: false,
  });
  assert.equal(restored.archived, false);
});
