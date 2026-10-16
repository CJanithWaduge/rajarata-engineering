export const CONTENT_SCHEMA_VERSION = 1 as const;
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MEDIA_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const PAGE_IDS = ['home', 'services', 'projects', 'about', 'contact'] as const;
export type PageId = (typeof PAGE_IDS)[number];

export type SeoRoute = PageId;

export const DRAFT_COLLECTION_PATHS = {
  services: 'drafts/services/records',
  projects: 'drafts/projects/records',
  pages: 'drafts/pages/records',
  settings: 'drafts/settings/records',
  media: 'drafts/media/records',
} as const;

export function draftDocumentPath(
  collection: keyof typeof DRAFT_COLLECTION_PATHS,
  id: string,
): string {
  if (!/^[a-z][a-z0-9-]{0,62}[a-z0-9]$/.test(id)) {
    throw new ContentValidationError('id', 'must be a stable lowercase slug');
  }
  return `${DRAFT_COLLECTION_PATHS[collection]}/${id}`;
}

export interface ServiceDraft {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  id: string;
  order: number;
  category: string;
  title: string;
  summary: string;
  body: string;
  scope: string;
  suitability: string[];
  imageRef: string | null;
  archived: boolean;
  updatedAt: string;
}

export interface ProjectDraft {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  id: string;
  order: number;
  category: string;
  title: string;
  summary: string;
  specifications: string;
  location: string;
  year: number | null;
  reference: string;
  clientName: string | null;
  imageRef: string | null;
  altText: string;
  featured: boolean;
  archived: boolean;
  updatedAt: string;
}

export interface PageSectionDraft {
  heading?: string;
  intro?: string;
  body?: string;
  label?: string;
  ctaLabel?: string;
  ctaTarget?: string;
  items?: string[];
}

export interface PageDraft {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  pageId: PageId;
  sections: Record<string, PageSectionDraft>;
  updatedAt: string;
}

export interface BusinessDetailsDraft {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  address: string;
  phone: string;
  email: string;
  hours: string;
  whatsapp: string;
  updatedAt: string;
}

export interface SeoMetadata {
  title: string;
  description: string;
  shareImageRef: string | null;
}

export interface SeoDraft {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  routes: Partial<Record<SeoRoute, SeoMetadata>>;
  updatedAt: string;
}

export interface MediaDraft {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  id: string;
  filename: string;
  alt: string;
  width: number;
  height: number;
  contentType: (typeof MEDIA_CONTENT_TYPES)[number];
  bytes: number;
  storagePath: string;
  archived: boolean;
  updatedAt: string;
}

export interface ContentSnapshot {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  services: ServiceDraft[];
  projects: ProjectDraft[];
  pages: PageDraft[];
  businessDetails: BusinessDetailsDraft;
  seo: SeoDraft;
  media: MediaDraft[];
}

export type ReleaseStatus =
  | 'queued'
  | 'snapshotting'
  | 'building'
  | 'deploying'
  | 'live'
  | 'failed'
  | 'rollback';

export interface ReleaseRecord {
  schemaVersion: typeof CONTENT_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  completedAt: string | null;
  createdBy: string;
  snapshot: ContentSnapshot;
  mediaRefs: string[];
  status: ReleaseStatus;
  hostVersionId: string | null;
  buildId: string | null;
  failure: { code: string; message: string } | null;
  rollbackOf: string | null;
}

export class ContentValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'ContentValidationError';
    this.field = field;
  }
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown, field: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContentValidationError(field, 'must be an object');
  }
  return value as RecordValue;
}

function asString(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ContentValidationError(field, `must be text of at most ${maxLength} characters`);
  }
  return value;
}

function asId(value: unknown, field: string): string {
  const id = asString(value, field, 64);
  if (!/^[a-z][a-z0-9-]{0,62}[a-z0-9]$/.test(id)) {
    throw new ContentValidationError(field, 'must be a stable lowercase slug');
  }
  return id;
}

function asReleaseId(value: unknown): string {
  const id = asString(value, 'id', 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(id)) {
    throw new ContentValidationError('id', 'must be a stable release identifier');
  }
  return id;
}

function asInteger(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new ContentValidationError(field, `must be an integer of at least ${minimum}`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new ContentValidationError(field, 'must be a boolean');
  return value;
}

function asNullableString(value: unknown, field: string, maxLength = 10_000): string | null {
  return value === null ? null : asString(value, field, maxLength);
}

function asIsoDate(value: unknown, field: string): string {
  const date = asString(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) ||
      Number.isNaN(Date.parse(date))) {
    throw new ContentValidationError(field, 'must be an ISO-8601 UTC timestamp');
  }
  return date;
}

function asStringArray(value: unknown, field: string, itemLimit = 200): string[] {
  if (!Array.isArray(value) || value.length > itemLimit) {
    throw new ContentValidationError(field, `must be an array with at most ${itemLimit} items`);
  }
  return value.map((item, index) => asString(item, `${field}[${index}]`, 2_000));
}

function asArray(value: unknown, field: string, itemLimit = 1_000): unknown[] {
  if (!Array.isArray(value) || value.length > itemLimit) {
    throw new ContentValidationError(field, `must be an array with at most ${itemLimit} items`);
  }
  return value;
}

function checkVersion(record: RecordValue): void {
  if (record.schemaVersion !== CONTENT_SCHEMA_VERSION) {
    throw new ContentValidationError('schemaVersion', 'is missing or unsupported');
  }
}

export function parseServiceDraft(value: unknown): ServiceDraft {
  const record = asRecord(value, 'service');
  checkVersion(record);
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: asId(record.id, 'id'),
    order: asInteger(record.order, 'order'),
    category: asString(record.category, 'category', 120),
    title: asString(record.title, 'title', 240),
    summary: asString(record.summary, 'summary', 2_000),
    body: asString(record.body, 'body'),
    scope: asString(record.scope, 'scope'),
    suitability: asStringArray(record.suitability, 'suitability'),
    imageRef: asNullableString(record.imageRef, 'imageRef', 64),
    archived: asBoolean(record.archived, 'archived'),
    updatedAt: asIsoDate(record.updatedAt, 'updatedAt'),
  };
}

export function parseProjectDraft(value: unknown): ProjectDraft {
  const record = asRecord(value, 'project');
  checkVersion(record);
  const year = record.year === null ? null : asInteger(record.year, 'year', 1900);
  if (year !== null && year > 9999) throw new ContentValidationError('year', 'is out of range');
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: asId(record.id, 'id'),
    order: asInteger(record.order, 'order'),
    category: asString(record.category, 'category', 120),
    title: asString(record.title, 'title', 240),
    summary: asString(record.summary, 'summary', 2_000),
    specifications: asString(record.specifications, 'specifications'),
    location: asString(record.location, 'location', 240),
    year,
    reference: asString(record.reference, 'reference', 240),
    clientName: asNullableString(record.clientName, 'clientName', 240),
    imageRef: asNullableString(record.imageRef, 'imageRef', 64),
    altText: asString(record.altText, 'altText', 500),
    featured: asBoolean(record.featured, 'featured'),
    archived: asBoolean(record.archived, 'archived'),
    updatedAt: asIsoDate(record.updatedAt, 'updatedAt'),
  };
}

const sectionsByPage: Record<PageId, readonly string[]> = {
  home: ['hero', 'trustStrip', 'about', 'services', 'whyChoose', 'projects', 'cta'],
  services: ['hero', 'directory', 'process', 'cta'],
  projects: ['hero', 'portfolio', 'trackRecord', 'cta'],
  about: ['hero', 'heritage', 'visionMission', 'pillars', 'methodology', 'industries', 'cta'],
  contact: ['hero', 'emergency', 'operationalDesks', 'quotation', 'visitorInformation'],
};
const pageSectionFields = new Set([
  'heading', 'intro', 'body', 'label', 'ctaLabel', 'ctaTarget', 'items',
]);
const allowedCtaTargets = new Set(['/', '/services', '/projects', '/about-us', '/contact']);

function parsePageSection(value: unknown, field: string): PageSectionDraft {
  const record = asRecord(value, field);
  for (const key of Object.keys(record)) {
    if (!pageSectionFields.has(key)) throw new ContentValidationError(`${field}.${key}`, 'is not allowed');
  }
  const section: PageSectionDraft = {};
  for (const key of ['heading', 'intro', 'body', 'label', 'ctaLabel'] as const) {
    if (key in record) section[key] = asString(record[key], `${field}.${key}`);
  }
  if ('ctaTarget' in record) {
    const target = asString(record.ctaTarget, `${field}.ctaTarget`, 120);
    if (!allowedCtaTargets.has(target) && !/^\/services#service-\d{2}$/.test(target)) {
      throw new ContentValidationError(`${field}.ctaTarget`, 'must be an approved internal route');
    }
    section.ctaTarget = target;
  }
  if ('items' in record) section.items = asStringArray(record.items, `${field}.items`);
  return section;
}

export function parsePageDraft(value: unknown): PageDraft {
  const record = asRecord(value, 'page');
  checkVersion(record);
  if (typeof record.pageId !== 'string' || !PAGE_IDS.includes(record.pageId as PageId)) {
    throw new ContentValidationError('pageId', 'is not an editable public page');
  }
  const pageId = record.pageId as PageId;
  const sectionsRecord = asRecord(record.sections, 'sections');
  const sections: Record<string, PageSectionDraft> = {};
  for (const [sectionId, section] of Object.entries(sectionsRecord)) {
    if (!sectionsByPage[pageId].includes(sectionId)) {
      throw new ContentValidationError(`sections.${sectionId}`, 'is not defined for this page');
    }
    sections[sectionId] = parsePageSection(section, `sections.${sectionId}`);
  }
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    pageId,
    sections,
    updatedAt: asIsoDate(record.updatedAt, 'updatedAt'),
  };
}

export function parseBusinessDetailsDraft(value: unknown): BusinessDetailsDraft {
  const record = asRecord(value, 'businessDetails');
  checkVersion(record);
  const email = asString(record.email, 'email', 320);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ContentValidationError('email', 'must be a valid email address or empty');
  }
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    address: asString(record.address, 'address', 500),
    phone: asString(record.phone, 'phone', 80),
    email,
    hours: asString(record.hours, 'hours', 500),
    whatsapp: asString(record.whatsapp, 'whatsapp', 80),
    updatedAt: asIsoDate(record.updatedAt, 'updatedAt'),
  };
}

function parseSeoMetadata(value: unknown, field: string): SeoMetadata {
  const record = asRecord(value, field);
  return {
    title: asString(record.title, `${field}.title`, 240),
    description: asString(record.description, `${field}.description`, 1_000),
    shareImageRef: asNullableString(record.shareImageRef, `${field}.shareImageRef`, 64),
  };
}

export function parseSeoDraft(value: unknown): SeoDraft {
  const record = asRecord(value, 'seo');
  checkVersion(record);
  const routeRecord = asRecord(record.routes, 'routes');
  const routes: Partial<Record<SeoRoute, SeoMetadata>> = {};
  for (const [route, metadata] of Object.entries(routeRecord)) {
    if (!PAGE_IDS.includes(route as PageId)) {
      throw new ContentValidationError(`routes.${route}`, 'is not an approved public route');
    }
    routes[route as PageId] = parseSeoMetadata(metadata, `routes.${route}`);
  }
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    routes,
    updatedAt: asIsoDate(record.updatedAt, 'updatedAt'),
  };
}

export function parseMediaDraft(value: unknown): MediaDraft {
  const record = asRecord(value, 'media');
  checkVersion(record);
  const contentType = record.contentType;
  if (!MEDIA_CONTENT_TYPES.includes(String(contentType) as (typeof MEDIA_CONTENT_TYPES)[number])) {
    throw new ContentValidationError('contentType', 'must be an approved raster image type');
  }
  const id = asId(record.id, 'id');
  const filename = asString(record.filename, 'filename', 120);
  if (!/^[a-z0-9][a-z0-9._-]*\.(jpg|png|webp)$/.test(filename)) {
    throw new ContentValidationError('filename', 'must be a safe image filename');
  }
  const storagePath = asString(record.storagePath, 'storagePath', 1_024);
  if (storagePath !== `media/drafts/${id}/${filename}`) {
    throw new ContentValidationError('storagePath', 'must identify a draft media object');
  }
  const bytes = asInteger(record.bytes, 'bytes', 1);
  if (bytes > MAX_MEDIA_BYTES) {
    throw new ContentValidationError('bytes', `must not exceed ${MAX_MEDIA_BYTES} bytes`);
  }
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id,
    filename,
    alt: asString(record.alt, 'alt', 500),
    width: asInteger(record.width, 'width', 1),
    height: asInteger(record.height, 'height', 1),
    contentType: contentType as MediaDraft['contentType'],
    bytes,
    storagePath,
    archived: asBoolean(record.archived, 'archived'),
    updatedAt: asIsoDate(record.updatedAt, 'updatedAt'),
  };
}

export function parseContentSnapshot(value: unknown): ContentSnapshot {
  const record = asRecord(value, 'snapshot');
  checkVersion(record);
  const services = asArray(record.services, 'services').map(parseServiceDraft);
  const projects = asArray(record.projects, 'projects').map(parseProjectDraft);
  const pages = asArray(record.pages, 'pages', PAGE_IDS.length).map(parsePageDraft);
  const media = asArray(record.media, 'media').map(parseMediaDraft);
  const assertUnique = (values: string[], field: string) => {
    if (new Set(values).size !== values.length) {
      throw new ContentValidationError(field, 'must not contain duplicate identifiers');
    }
  };
  assertUnique(services.map(({ id }) => id), 'services');
  assertUnique(projects.map(({ id }) => id), 'projects');
  assertUnique(pages.map(({ pageId }) => pageId), 'pages');
  assertUnique(media.map(({ id }) => id), 'media');

  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    services,
    projects,
    pages,
    businessDetails: parseBusinessDetailsDraft(record.businessDetails),
    seo: parseSeoDraft(record.seo),
    media,
  };
}

export function parseReleaseRecord(value: unknown): ReleaseRecord {
  const record = asRecord(value, 'release');
  checkVersion(record);
  const statuses: ReleaseStatus[] = [
    'queued', 'snapshotting', 'building', 'deploying', 'live', 'failed', 'rollback',
  ];
  if (typeof record.status !== 'string' || !statuses.includes(record.status as ReleaseStatus)) {
    throw new ContentValidationError('status', 'is not a supported release state');
  }
  let failure: ReleaseRecord['failure'] = null;
  if (record.failure !== null) {
    const failureRecord = asRecord(record.failure, 'failure');
    failure = {
      code: asString(failureRecord.code, 'failure.code', 120),
      message: asString(failureRecord.message, 'failure.message', 1_000),
    };
  }
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    id: asReleaseId(record.id),
    createdAt: asIsoDate(record.createdAt, 'createdAt'),
    completedAt: record.completedAt === null
      ? null
      : asIsoDate(record.completedAt, 'completedAt'),
    createdBy: asString(record.createdBy, 'createdBy', 128),
    snapshot: parseContentSnapshot(record.snapshot),
    mediaRefs: asStringArray(record.mediaRefs, 'mediaRefs', 1_000),
    status: record.status as ReleaseStatus,
    hostVersionId: asNullableString(record.hostVersionId, 'hostVersionId', 240),
    buildId: asNullableString(record.buildId, 'buildId', 240),
    failure,
    rollbackOf: asNullableString(record.rollbackOf, 'rollbackOf', 64),
  };
}

export function migrateLegacyBusinessDetails(
  value: unknown,
  updatedAt: string,
): BusinessDetailsDraft {
  const record = asRecord(value, 'legacyBusinessDetails');
  return parseBusinessDetailsDraft({
    schemaVersion: CONTENT_SCHEMA_VERSION,
    address: typeof record.address === 'string' ? record.address : '',
    phone: typeof record.phone === 'string' ? record.phone : '',
    email: typeof record.email === 'string' ? record.email : '',
    hours: typeof record.hours === 'string' ? record.hours : '',
    whatsapp: typeof record.whatsapp === 'string' ? record.whatsapp : '',
    updatedAt,
  });
}
