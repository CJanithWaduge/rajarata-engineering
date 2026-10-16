import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTENT_SCHEMA_VERSION,
  ContentValidationError,
  draftDocumentPath,
  migrateLegacyBusinessDetails,
  parseBusinessDetailsDraft,
  parsePageDraft,
  parseProjectDraft,
  parseReleaseRecord,
  parseServiceDraft,
} from '../src/lib/contentModel.ts';

const updatedAt = '2026-10-15T10:00:00.000Z';

function service(overrides = {}) {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: 'service-01',
    order: 0,
    category: 'LV Distribution',
    title: '',
    summary: '',
    body: '',
    scope: '',
    suitability: [],
    imageRef: null,
    archived: false,
    updatedAt,
    ...overrides,
  };
}

test('service draft parser accepts incomplete drafts without inventing content', () => {
  assert.equal(parseServiceDraft(service()).title, '');
});

test('service draft parser rejects unsupported schema versions and unstable ids', () => {
  assert.throws(
    () => parseServiceDraft(service({ schemaVersion: 2 })),
    (error) => error instanceof ContentValidationError && error.field === 'schemaVersion',
  );
  assert.throws(
    () => parseServiceDraft(service({ id: 'Service 01' })),
    (error) => error instanceof ContentValidationError && error.field === 'id',
  );
});

test('draft document paths use valid collection/document segment pairs', () => {
  assert.equal(
    draftDocumentPath('services', 'service-01'),
    'drafts/services/records/service-01',
  );
  assert.throws(() => draftDocumentPath('services', 'Invalid ID'));
});

test('project draft parser rejects invalid years and validates optional facts', () => {
  const valid = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: 'project-01',
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
    updatedAt,
  };
  assert.equal(parseProjectDraft(valid).year, null);
  assert.throws(
    () => parseProjectDraft({ ...valid, year: 1800 }),
    (error) => error instanceof ContentValidationError && error.field === 'year',
  );
});

test('page drafts reject unknown sections, fields, and external CTA targets', () => {
  const page = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    pageId: 'home',
    sections: { hero: { heading: 'Heading', ctaTarget: '/contact' } },
    updatedAt,
  };
  assert.equal(parsePageDraft(page).sections.hero.heading, 'Heading');
  assert.throws(() => parsePageDraft({
    ...page,
    sections: { hero: { heading: 'Heading', html: '<b>unsafe</b>' } },
  }));
  assert.throws(() => parsePageDraft({
    ...page,
    sections: { unreviewed: { heading: 'Heading' } },
  }));
  assert.throws(() => parsePageDraft({
    ...page,
    sections: { hero: { ctaTarget: 'https://example.com' } },
  }));
});

test('legacy footer settings migrate into the versioned business-details schema', () => {
  const migrated = migrateLegacyBusinessDetails({
    address: 'Verified address',
    phone: '+94770000000',
    email: 'office@example.lk',
    hours: 'Weekdays',
    whatsapp: '',
  }, updatedAt);
  assert.equal(migrated.schemaVersion, CONTENT_SCHEMA_VERSION);
  assert.equal(migrated.address, 'Verified address');
  assert.equal(migrated.updatedAt, updatedAt);
});

test('business-details parser rejects invalid email addresses', () => {
  assert.throws(
    () => parseBusinessDetailsDraft({
      schemaVersion: CONTENT_SCHEMA_VERSION,
      address: '',
      phone: '',
      email: 'not-an-email',
      hours: '',
      whatsapp: '',
      updatedAt,
    }),
    (error) => error instanceof ContentValidationError && error.field === 'email',
  );
});

test('release parser accepts sortable numeric-prefix ids and rejects unknown states', () => {
  const release = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: '20261015-1349-abc123',
    createdAt: updatedAt,
    createdBy: 'admin-uid',
    snapshot: {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      services: [],
      projects: [],
      pages: [],
      businessDetails: {
        schemaVersion: CONTENT_SCHEMA_VERSION,
        address: '',
        phone: '',
        email: '',
        hours: '',
        whatsapp: '',
        updatedAt,
      },
      seo: { schemaVersion: CONTENT_SCHEMA_VERSION, routes: {}, updatedAt },
      media: [],
    },
    mediaRefs: [],
    status: 'queued',
    hostVersionId: null,
    buildId: null,
    failure: null,
    rollbackOf: null,
  };
  assert.equal(parseReleaseRecord(release).id, release.id);
  assert.throws(() => parseReleaseRecord({ ...release, status: 'complete' }));
});
