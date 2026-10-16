import type { Bucket } from '@google-cloud/storage';
import type { Firestore } from 'firebase-admin/firestore';
import {
  PAGE_IDS,
  type BusinessDetailsDraft,
  type MediaDraft,
  type PageDraft,
  type PageId,
  type ProjectDraft,
  type SeoDraft,
  type ServiceDraft,
} from './contentModel.ts';
import {
  DraftNotFoundError,
  getBusinessDetailsDraft,
  getPageDraft,
  getSeoDraft,
  listProjectDrafts,
  listServiceDrafts,
  type AdminActor,
} from './draftRepository.ts';
import { listMediaDrafts } from './mediaRepository.ts';

export interface DraftPreviewSnapshot {
  services: ServiceDraft[];
  projects: ProjectDraft[];
  pages: Partial<Record<PageId, PageDraft>>;
  businessDetails?: BusinessDetailsDraft;
  seo?: SeoDraft;
  media: MediaDraft[];
  availableMediaIds: string[];
}

export interface DraftPreviewIssue {
  id: string;
  scope: string;
  message: string;
  blocking: boolean;
  href: string;
}

async function optional<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof DraftNotFoundError) return undefined;
    throw error;
  }
}

export async function loadDraftPreview(
  firestore: Firestore,
  bucket: Bucket,
  actor: AdminActor | undefined,
): Promise<DraftPreviewSnapshot> {
  if (!actor?.uid || actor.admin !== true) {
    throw new Error('An authenticated administrator is required.');
  }

  const [services, projects, mediaItems, businessDetails, seo, pageEntries] = await Promise.all([
    listServiceDrafts(firestore, actor),
    listProjectDrafts(firestore, actor),
    listMediaDrafts(firestore, actor),
    optional(() => getBusinessDetailsDraft(firestore, actor)),
    optional(() => getSeoDraft(firestore, actor)),
    Promise.all(PAGE_IDS.map(async (pageId) => [
      pageId,
      await optional(() => getPageDraft(firestore, actor, pageId)),
    ] as const)),
  ]);

  const media = mediaItems.map(({ usedBy: _usedBy, ...asset }) => asset);
  const mediaById = new Map(media.map((asset) => [asset.id, asset]));
  const referencedIds = new Set<string>();
  services.forEach(({ imageRef }) => { if (imageRef) referencedIds.add(imageRef); });
  projects.forEach(({ imageRef }) => { if (imageRef) referencedIds.add(imageRef); });
  Object.values(seo?.routes ?? {}).forEach((route) => {
    if (route?.shareImageRef) referencedIds.add(route.shareImageRef);
  });

  const availableMediaIds: string[] = [];
  await Promise.all([...referencedIds].map(async (id) => {
    const asset = mediaById.get(id);
    if (!asset) return;
    const [exists] = await bucket.file(asset.storagePath).exists();
    if (exists) availableMediaIds.push(id);
  }));

  return {
    services,
    projects,
    pages: Object.fromEntries(pageEntries.filter((entry): entry is readonly [PageId, PageDraft] =>
      entry[1] !== undefined,
    )),
    businessDetails,
    seo,
    media,
    availableMediaIds,
  };
}

function recordHref(kind: 'services' | 'projects', id: string, field: string): string {
  return `/admin/${kind}/edit?id=${encodeURIComponent(id)}#${encodeURIComponent(field)}`;
}

export function collectDraftPreviewIssues(
  snapshot: DraftPreviewSnapshot,
): DraftPreviewIssue[] {
  const issues: DraftPreviewIssue[] = [];
  const mediaById = new Map(snapshot.media.map((asset) => [asset.id, asset]));
  const availableMediaIds = new Set(snapshot.availableMediaIds);

  const add = (
    id: string,
    scope: string,
    message: string,
    blocking: boolean,
    href: string,
  ) => issues.push({ id, scope, message, blocking, href });

  for (const service of snapshot.services) {
    if (service.archived) continue;
    if (!service.title.trim()) {
      add(`service-${service.id}-title`, `Service · ${service.id}`, 'Service name is empty.', true,
        recordHref('services', service.id, 'title'));
    }
    if (!service.summary.trim()) {
      add(`service-${service.id}-summary`, `Service · ${service.title || service.id}`,
        'Short card summary is empty.', true, recordHref('services', service.id, 'summary'));
    }
    if (service.imageRef) {
      const asset = mediaById.get(service.imageRef);
      if (!asset || !availableMediaIds.has(service.imageRef)) {
        add(`service-${service.id}-image`, `Service · ${service.title || service.id}`,
          'The referenced image or its stored file is missing.', true,
          recordHref('services', service.id, 'imageRef'));
      }
    }
  }

  for (const project of snapshot.projects) {
    if (project.archived) continue;
    if (!project.title.trim()) {
      add(`project-${project.id}-title`, `Project · ${project.id}`, 'Project title is empty.', true,
        recordHref('projects', project.id, 'title'));
    }
    if (!project.summary.trim()) {
      add(`project-${project.id}-summary`, `Project · ${project.title || project.id}`,
        'Portfolio summary is empty.', true, recordHref('projects', project.id, 'summary'));
    }
    if (project.imageRef) {
      const asset = mediaById.get(project.imageRef);
      if (!asset || !availableMediaIds.has(project.imageRef)) {
        add(`project-${project.id}-image`, `Project · ${project.title || project.id}`,
          'The referenced image or its stored file is missing.', true,
          recordHref('projects', project.id, 'imageRef'));
      }
      if (!project.altText.trim() && !asset?.alt.trim()) {
        add(`project-${project.id}-alt`, `Project · ${project.title || project.id}`,
          'The selected image has no usable alt text.', true,
          recordHref('projects', project.id, 'altText'));
      }
    }
  }

  for (const pageId of PAGE_IDS) {
    const metadata = snapshot.seo?.routes[pageId];
    if (metadata?.description.trim() && metadata.description.trim().length < 70) {
      add(`seo-${pageId}-description`, `SEO · ${pageId}`,
        'Meta description is shorter than the recommended search-result length.', false,
        '/admin/content#seo');
    }
    const imageRef = metadata?.shareImageRef;
    if (imageRef && (!mediaById.has(imageRef) || !availableMediaIds.has(imageRef))) {
      add(`seo-${pageId}-image`, `SEO · ${pageId}`,
        'The social preview image or its stored file is missing.', true,
        `/admin/content#seo`);
    }
  }

  return issues;
}
