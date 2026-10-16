import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  DraftConflictError,
  DraftNotFoundError,
  getProjectDraft,
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
} from '../src/lib/draftRepository.ts';
import { CONTENT_SCHEMA_VERSION } from '../src/lib/contentModel.ts';

const projectId = 'demo-rajarata-engineering';
const actor = { uid: 'emulator-admin', admin: true };
const timestamp = '2026-10-15T10:00:00.000Z';
const marker = `repo-test-${Date.now()}`;

let app;
let firestore;

function service(id, order) {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id,
    order,
    category: '',
    title: '',
    summary: '',
    body: '',
    scope: '',
    suitability: [],
    imageRef: null,
    archived: false,
    updatedAt: timestamp,
  };
}

function project(id) {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id,
    order: 0,
    category: '',
    title: '',
    summary: '',
    specifications: '',
    location: '',
    year: null,
    reference: '',
    clientName: null,
    imageRef: null,
    altText: '',
    featured: false,
    archived: false,
    updatedAt: timestamp,
  };
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore emulator is required.');
  app = initializeApp({ projectId }, `draft-repository-${process.pid}`);
  firestore = getFirestore(app);
});

after(async () => {
  await app?.delete();
});

test('repository requires a verified admin actor', async () => {
  await assert.rejects(listServiceDrafts(firestore, undefined), /authenticated administrator/);
  await assert.rejects(listProjectDrafts(firestore, { uid: 'member', admin: false }), /authenticated administrator/);
});

test('service drafts support create, ordered listing, optimistic updates, and archive/restore', async () => {
  const firstId = `${marker}-b`;
  const secondId = `${marker}-a`;
  const first = await saveServiceDraft(firestore, actor, service(firstId, 2), null);
  await saveServiceDraft(firestore, actor, service(secondId, 1), null);
  assert.deepEqual((await listServiceDrafts(firestore, actor)).slice(0, 2).map(({ id }) => id), [
    secondId,
    firstId,
  ]);
  assert.equal((await getServiceDraft(firestore, actor, firstId)).id, firstId);

  const changed = await saveServiceDraft(
    firestore,
    actor,
    { ...first, title: 'Saved only as a draft' },
    first.updatedAt,
  );
  assert.equal(changed.title, 'Saved only as a draft');
  await assert.rejects(
    saveServiceDraft(firestore, actor, first, first.updatedAt),
    DraftConflictError,
  );
  const marked = await saveServiceDraft(
    firestore,
    actor,
    { ...first, scope: marker },
    changed.updatedAt,
  );
  const build = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url)), 'build'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      env: {
        ...process.env,
        FIREBASE_PROJECT_ID: projectId,
      },
      timeout: 120_000,
    },
  );
  assert.equal(
    build.status,
    0,
    build.error ? String(build.error) : `${build.stdout}\n${build.stderr}`,
  );
  const outputFiles = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else outputFiles.push(path);
    }
  };
  await visit(fileURLToPath(new URL('../dist/client', import.meta.url)));
  assert.ok(outputFiles.length > 0, 'Static public HTML should be generated.');
  for (const path of outputFiles) {
    const contents = await readFile(path, 'utf8');
    assert.equal(contents.includes(marker), false, `Draft content leaked into ${path}`);
    assert.equal(contents.includes(firstId), false, `Draft identifier leaked into ${path}`);
  }

  const archived = await setServiceDraftArchived(firestore, actor, firstId, true, marked.updatedAt);
  assert.equal(archived.archived, true);
  const restored = await setServiceDraftArchived(firestore, actor, firstId, false, archived.updatedAt);
  assert.equal(restored.archived, false);
  await assert.rejects(getServiceDraft(firestore, actor, `${marker}-missing`), DraftNotFoundError);
});

test('project drafts persist without inventing project facts', async () => {
  const id = `${marker}-project`;
  const created = await saveProjectDraft(firestore, actor, project(id), null);
  assert.equal(created.year, null);
  assert.equal(created.clientName, null);
  const archived = await setProjectDraftArchived(firestore, actor, id, true, created.updatedAt);
  assert.equal(archived.archived, true);
  assert.equal((await getProjectDraft(firestore, actor, id)).archived, true);
});

test('page, business-details, and SEO drafts are versioned emulator writes', async () => {
  const page = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    pageId: 'home',
    sections: { hero: { heading: marker } },
    updatedAt: timestamp,
  };
  const savedPage = await savePageDraft(firestore, actor, page, null);
  assert.equal(savedPage.sections.hero.heading, marker);

  const businessDetails = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    address: '',
    phone: '',
    email: '',
    hours: '',
    whatsapp: '',
    updatedAt: timestamp,
  };
  assert.equal(
    (await saveBusinessDetailsDraft(firestore, actor, businessDetails, null)).email,
    '',
  );

  const seo = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    routes: {},
    updatedAt: timestamp,
  };
  assert.deepEqual((await saveSeoDraft(firestore, actor, seo, null)).routes, {});
});
