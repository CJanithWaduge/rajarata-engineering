import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { createServer } from 'node:net';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  CONTENT_SCHEMA_VERSION,
  draftDocumentPath,
  parseMediaDraft,
} from '../src/lib/contentModel.ts';
import { createMediaDraft } from '../src/lib/mediaRepository.ts';
import {
  collectDraftPreviewIssues,
  loadDraftPreview,
} from '../src/lib/draftPreview.ts';
import {
  savePageDraft,
  saveProjectDraft,
  saveSeoDraft,
  saveServiceDraft,
} from '../src/lib/draftRepository.ts';

const projectId = 'demo-rajarata-engineering';
const suffix = Date.now().toString();
const contentMarker = `private-preview-${suffix}`;
const adminEmail = `preview-admin-${suffix}@example.test`;
const memberEmail = `preview-member-${suffix}@example.test`;
const password = `Preview-${suffix}-safe`;
const adminActor = { uid: '', admin: true };
const timestamp = new Date().toISOString();
const missingMediaId = `asset-missing${suffix}`;
const serviceId = `preview-service-${suffix}`;
const projectRecordId = `preview-project-${suffix}`;

let app;
let auth;
let firestore;
let bucket;
let adminUser;
let image;
let serverProcess;
let serverUrl;
let baseUrl;
let adminCookie;
let memberCookie;
let stdout = '';
let stderr = '';

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function reservePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port.');
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function signIn(email) {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=preview-test-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  assert.equal(typeof payload.idToken, 'string');
  return payload.idToken;
}

async function exchangeForSession(idToken) {
  const response = await fetch(new URL('/admin/session', serverUrl), {
    method: 'POST',
    headers: {
      Origin: serverUrl.origin,
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'preauth',
    },
    body: JSON.stringify({ idToken }),
  });
  assert.equal(response.status, 200, await response.text());
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie?.startsWith('__session='));
  return setCookie.split(';', 1)[0];
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Astro preview server exited (${serverProcess.exitCode}).\n${stdout}\n${stderr}`);
    }
    try {
      const response = await fetch(new URL('/admin/login', serverUrl), { redirect: 'manual' });
      if (response.status === 200) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Astro preview server did not become ready.\n${stdout}\n${stderr}`);
}

before(async () => {
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Auth emulator is required.');
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Firestore emulator is required.');
  assert.ok(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 'Storage emulator is required.');

  app = initializeApp({ projectId }, `draft-preview-${process.pid}`);
  auth = getAuth(app);
  firestore = getFirestore(app);
  bucket = getStorage(app).bucket(`${projectId}.appspot.com`);

  adminUser = await auth.createUser({ email: adminEmail, password });
  await auth.setCustomUserClaims(adminUser.uid, { admin: true });
  adminActor.uid = adminUser.uid;
  await auth.createUser({ email: memberEmail, password });

  image = await createMediaDraft(firestore, bucket, adminActor, {
    originalName: 'preview-image.png',
    alt: 'Test image for a protected preview',
    contentType: 'image/png',
    bytes: pngHeader(48, 32),
  });

  const missingAsset = parseMediaDraft({
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: missingMediaId,
    filename: 'missing.png',
    alt: 'Missing emulator object',
    width: 48,
    height: 32,
    contentType: 'image/png',
    bytes: 24,
    storagePath: `media/drafts/${missingMediaId}/missing.png`,
    archived: false,
    updatedAt: timestamp,
  });
  await firestore.doc(draftDocumentPath('media', missingMediaId)).create(missingAsset);

  await saveServiceDraft(firestore, adminActor, {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: serviceId,
    order: 0,
    category: 'Preview test',
    title: contentMarker,
    summary: '',
    body: 'Saved service body for the protected preview.',
    scope: '',
    suitability: [],
    imageRef: missingMediaId,
    archived: false,
    updatedAt: timestamp,
  }, null);

  await saveProjectDraft(firestore, adminActor, {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: projectRecordId,
    order: 0,
    category: 'Preview test',
    title: 'Protected preview project',
    summary: 'Saved project summary.',
    specifications: '',
    location: '',
    year: null,
    reference: '',
    clientName: null,
    imageRef: image.id,
    altText: '',
    featured: false,
    archived: false,
    updatedAt: timestamp,
  }, null);

  await savePageDraft(firestore, adminActor, {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    pageId: 'home',
    sections: { hero: { heading: contentMarker, intro: 'Visible only inside the private preview.' } },
    updatedAt: timestamp,
  }, null);

  await saveSeoDraft(firestore, adminActor, {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    routes: {
      home: {
        title: 'Private preview SEO title',
        description: 'Too short.',
        shareImageRef: missingMediaId,
      },
    },
    updatedAt: timestamp,
  }, null);

  const port = await reservePort();
  serverUrl = new URL(`http://127.0.0.1:${port}`);
  baseUrl = serverUrl.origin;
  const astroCli = fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url));
  serverProcess = spawn(
    process.execPath,
    [astroCli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        FIREBASE_PROJECT_ID: projectId,
        ADMIN_PUBLIC_ORIGINS: baseUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  serverProcess.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  serverProcess.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  await waitForServer();

  adminCookie = await exchangeForSession(await signIn(adminEmail));
  const memberIdToken = await signIn(memberEmail);
  const memberSession = await auth.createSessionCookie(memberIdToken, { expiresIn: 5 * 60 * 1000 });
  memberCookie = `__session=${memberSession}`;
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
  }
  await app?.delete();
});

test('preview snapshot renders real draft fields and diagnoses missing media', async () => {
  const snapshot = await loadDraftPreview(firestore, bucket, adminActor);
  assert.equal(snapshot.pages.home?.sections.hero?.heading, contentMarker);
  assert.equal(snapshot.services.find(({ id }) => id === serviceId)?.title, contentMarker);
  assert.equal(snapshot.availableMediaIds.includes(image.id), true);
  assert.equal(snapshot.availableMediaIds.includes(missingMediaId), false);

  const issues = collectDraftPreviewIssues(snapshot);
  assert.ok(issues.some((issue) => issue.scope.startsWith('Service') &&
    issue.message === 'Short card summary is empty.' &&
    issue.href === `/admin/services/edit?id=${serviceId}#summary`));
  assert.ok(issues.some((issue) => issue.message.includes('referenced image') &&
    issue.href === `/admin/services/edit?id=${serviceId}#imageRef`));
  assert.ok(issues.some((issue) => issue.scope === 'SEO · home' &&
    issue.message.includes('social preview image')));
  await assert.rejects(loadDraftPreview(firestore, bucket, undefined), /authenticated administrator/);
});

test('SSR preview, draft data, and image bytes require a verified admin session', async () => {
  const anonymousPreview = await fetch(new URL('/admin/preview?page=home', serverUrl), {
    redirect: 'manual',
  });
  assert.equal(anonymousPreview.status, 302);
  assert.match(anonymousPreview.headers.get('location') ?? '', /\/admin\/login/);
  assert.match(anonymousPreview.headers.get('cache-control') ?? '', /no-store/);
  assert.match(anonymousPreview.headers.get('x-robots-tag') ?? '', /noindex/);

  const memberPreview = await fetch(new URL('/admin/preview?page=home', serverUrl), {
    headers: { Cookie: memberCookie },
    redirect: 'manual',
  });
  assert.equal(memberPreview.status, 403);
  assert.match(memberPreview.headers.get('cache-control') ?? '', /no-store/);
  assert.match(memberPreview.headers.get('x-robots-tag') ?? '', /noindex/);
  assert.equal((await memberPreview.text()).includes(contentMarker), false);

  const adminPreview = await fetch(new URL('/admin/preview?page=home', serverUrl), {
    headers: { Cookie: adminCookie },
  });
  const html = await adminPreview.text();
  assert.equal(adminPreview.status, 200);
  assert.match(adminPreview.headers.get('cache-control') ?? '', /no-store/);
  assert.match(adminPreview.headers.get('x-robots-tag') ?? '', /noindex/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, new RegExp(contentMarker));
  assert.match(html, /Draft preview — not published/);
  assert.match(html, /The referenced image or its stored file is missing/);
  assert.match(html, new RegExp(`/admin/services/edit\\?id=${serviceId}#summary`));

  const servicesPage = await fetch(new URL(`/admin/preview?page=services&id=${serviceId}`, serverUrl), {
    headers: { Cookie: adminCookie },
  });
  const servicesHtml = await servicesPage.text();
  assert.equal(servicesPage.status, 200);
  assert.match(servicesHtml, new RegExp(contentMarker));
  assert.match(servicesHtml, new RegExp(`id="service-${serviceId}"`));
  assert.match(servicesHtml, /No summary saved\./);

  const projectsPage = await fetch(new URL(`/admin/preview?page=projects&id=${projectRecordId}`, serverUrl), {
    headers: { Cookie: adminCookie },
  });
  const projectsHtml = await projectsPage.text();
  assert.equal(projectsPage.status, 200);
  assert.match(projectsHtml, /Protected preview project/);
  assert.match(projectsHtml, new RegExp(`/admin/api/media\\?id=${image.id}&amp;image=1`));
  assert.match(projectsHtml, /Test image for a protected preview/);

  const draftUrl = new URL('/admin/api/drafts?kind=services', serverUrl);
  const anonymousDrafts = await fetch(draftUrl, { redirect: 'manual' });
  assert.equal(anonymousDrafts.status, 302);
  const memberDrafts = await fetch(draftUrl, {
    headers: { Cookie: memberCookie },
    redirect: 'manual',
  });
  assert.equal(memberDrafts.status, 403);
  assert.equal((await memberDrafts.text()).includes(contentMarker), false);
  const adminDrafts = await fetch(draftUrl, { headers: { Cookie: adminCookie } });
  assert.equal(adminDrafts.status, 200);
  assert.match(adminDrafts.headers.get('cache-control') ?? '', /no-store/);
  assert.match(await adminDrafts.text(), new RegExp(contentMarker));

  const imageUrl = new URL(`/admin/api/media?id=${image.id}&image=1`, serverUrl);
  const anonymousImage = await fetch(imageUrl, { redirect: 'manual' });
  assert.equal(anonymousImage.status, 302);
  const memberImage = await fetch(imageUrl, {
    headers: { Cookie: memberCookie },
    redirect: 'manual',
  });
  assert.equal(memberImage.status, 403);
  const adminImage = await fetch(imageUrl, { headers: { Cookie: adminCookie } });
  assert.equal(adminImage.status, 200);
  assert.equal(adminImage.headers.get('content-type'), 'image/png');
  assert.match(adminImage.headers.get('cache-control') ?? '', /no-store/);
  assert.deepEqual(new Uint8Array(await adminImage.arrayBuffer()), pngHeader(48, 32));
});

test('public static output contains no Admin preview HTML or draft data', async () => {
  const root = fileURLToPath(new URL('../dist/client', import.meta.url));
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else files.push(path);
    }
  };
  await visit(root);
  assert.ok(files.length > 0, 'Public static HTML should be generated.');
  assert.equal(files.some((path) => /[\\/]admin[\\/]/.test(path)), false);
});
