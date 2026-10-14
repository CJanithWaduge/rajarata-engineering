/**
 * Admin navigation model (Phase 11, Step A11.1).
 *
 * Kept in `lib` so both the navigation rail and the breadcrumb in the admin
 * layout resolve section labels from one list. The information architecture
 * follows the approved DESIGN.md order: Dashboard, Services, Projects, Media
 * Library, Site Content, Publishing History.
 *
 * These hrefs are code-controlled, not CMS-editable — DESIGN.md keeps allowed
 * destinations out of administrator reach.
 */
export interface AdminNavItem {
  label: string;
  href: string;
  icon: string;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: 'dashboard' },
  { label: 'Services', href: '/admin/services', icon: 'electrical_services' },
  { label: 'Projects', href: '/admin/projects', icon: 'engineering' },
  { label: 'Media Library', href: '/admin/media', icon: 'perm_media' },
  { label: 'Site Content', href: '/admin/content', icon: 'edit_document' },
  { label: 'Publishing History', href: '/admin/history', icon: 'history' },
];

/** Exact match for `/admin`, prefix match for everything nested beneath it. */
export function isAdminNavActive(href: string, path: string): boolean {
  if (href === '/admin') return path === '/admin';
  return path === href || path.startsWith(`${href}/`);
}

/**
 * Breadcrumb trail for the top context bar. Returns the matched section label
 * plus the page's own label; the shell never invents deeper levels than the
 * navigation actually has.
 */
export function adminBreadcrumb(path: string, pageLabel: string): string[] {
  const section = ADMIN_NAV.find((item) => isAdminNavActive(item.href, path));
  if (!section) return ['Admin', pageLabel];
  if (section.label === pageLabel) return ['Admin', section.label];
  return ['Admin', section.label, pageLabel];
}
