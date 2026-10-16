import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
} from 'firebase/storage';

const projectId = 'demo-rajarata-engineering';
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
assert.ok(emulator, 'Run this test with the Firestore and Storage emulators.');

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: emulator.split(':')[0],
      port: Number(emulator.split(':')[1]),
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
    storage: {
      host: process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(':')[0] ?? '127.0.0.1',
      port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(':')[1] ?? 9199),
      rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8'),
    },
  });

  await environment.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(
      ref(context.storage(), 'media/published/release-1/panel.jpg'),
      new Uint8Array([1, 2, 3]),
      { contentType: 'image/jpeg' },
    );
    await uploadBytes(
      ref(context.storage(), 'media/drafts/draft-1/panel.jpg'),
      new Uint8Array([4, 5, 6]),
      { contentType: 'image/jpeg' },
    );
  });
});

after(async () => {
  await environment?.cleanup();
});

test('anonymous Firestore access is denied', async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'siteSettings/public')));
  await assertFails(getDoc(doc(db, 'drafts/home')));
  await assertFails(getDoc(doc(db, 'releases/release-1')));
});

test('signed-in non-admins cannot access protected Firestore documents', async () => {
  const db = environment.authenticatedContext('member-1').firestore();
  await assertFails(getDoc(doc(db, 'siteSettings/public')));
  await assertFails(getDoc(doc(db, 'drafts/home')));
  await assertFails(setDoc(doc(db, 'drafts/home'), { heading: 'not allowed' }));
  await assertFails(setDoc(doc(db, 'releases/release-1'), { status: 'live' }));
});

test('admin custom claims authorize Firestore access', async () => {
  const db = environment.authenticatedContext('admin-1', { admin: true }).firestore();
  await assertFails(setDoc(doc(db, 'drafts/home'), { heading: 'client writes are not allowed' }));
  await assertSucceeds(getDoc(doc(db, 'drafts/home')));
  await assertFails(getDoc(doc(db, 'siteSettings/public')));
  await assertFails(setDoc(doc(db, 'releases/release-1'), { status: 'live' }));
});

test('published media is public read-only while draft media is admin-only', async () => {
  const anonymousStorage = environment.unauthenticatedContext().storage();
  const nonAdminStorage = environment.authenticatedContext('member-1').storage();
  const adminStorage = environment.authenticatedContext('admin-1', { admin: true }).storage();

  await assertSucceeds(getBytes(ref(anonymousStorage, 'media/published/release-1/panel.jpg')));
  await assertFails(getBytes(ref(anonymousStorage, 'media/drafts/draft-1/panel.jpg')));
  await assertFails(getBytes(ref(nonAdminStorage, 'media/drafts/draft-1/panel.jpg')));
  await assertSucceeds(getBytes(ref(adminStorage, 'media/drafts/draft-1/panel.jpg')));
  await assertSucceeds(
    uploadBytes(
      ref(adminStorage, 'media/drafts/draft-1/second.jpg'),
      new Uint8Array([7, 8, 9]),
      { contentType: 'image/jpeg' },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(adminStorage, 'media/drafts/draft-1/script.jpg'),
      new Uint8Array([7, 8, 9]),
      { contentType: 'text/html' },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(adminStorage, 'media/drafts/draft-1/oversized.jpg'),
      new Uint8Array(10 * 1024 * 1024 + 1),
      { contentType: 'image/jpeg' },
    ),
  );
  await assertFails(deleteObject(ref(adminStorage, 'media/drafts/draft-1/panel.jpg')));
  await assertFails(
    uploadBytes(
      ref(adminStorage, 'media/published/release-1/forbidden.jpg'),
      new Uint8Array([1]),
      { contentType: 'image/jpeg' },
    ),
  );
  await assertFails(getBytes(ref(anonymousStorage, 'unlisted/file.jpg')));
});
