/**
 * Site-wide business details, sourced from Firestore.
 *
 * Why a client-side fetch rather than a build-time read: the site is a static
 * build served from Firebase Hosting (see AGENTS.md). Anything read during
 * `astro build` is frozen into dist/ and cannot change until a rebuild. That
 * would mean an admin edit only goes live after a commit and a deploy, which
 * defeats the point of having an admin panel at all.
 *
 * This uses the Firestore REST endpoint rather than the JS SDK. The whole
 * point is a single GET for four strings of copy, and the SDK would add
 * ~30KB to a site that currently ships almost no JavaScript.
 *
 * Security model: the four values here are already published on the page, so
 * reading them publicly exposes nothing new. Firestore rules allow reads on
 * `siteSettings/public` only — everything else requires auth. See
 * firestore.rules.
 *
 * If credentials are absent or the request fails, the footer keeps whatever
 * was rendered at build time. Same fallback principle AGENTS.md requires for
 * image URLs: a missing asset degrades to a placeholder, not a broken layout.
 */

export interface SiteSettings {
  address: string;
  phone: string;
  email: string;
  hours: string;
  /** Digits only, no `+` or spaces — e.g. `94771234567`. Builds the wa.me URL. */
  whatsapp: string;
}

/**
 * Rendered into the footer at build time. These are the values that show if
 * Firestore is unreachable, so they need to be presentable on their own.
 * Must match the copy baked into Footer.astro.
 */
export const DEFAULT_SETTINGS: SiteSettings = {
  address: 'Rajarata Engineering, Anuradhapura',
  phone: '+94 77 XXX XXXX',
  email: 'contact@rajarata.lk',
  hours: 'Mon – Fri, 8:00 – 17:30',
  whatsapp: '',
};

// Vite replaces these at build time. Unset in local dev unless a .env exists,
// which is exactly why the fallback exists.
const PROJECT_ID = import.meta.env.PUBLIC_FIREBASE_PROJECT_ID;
const API_KEY = import.meta.env.PUBLIC_FIREBASE_API_KEY;

const DOC_PATH = 'siteSettings/public';

/**
 * Firestore returns every value wrapped in a typed envelope
 * (`{"stringValue": "..."}`). Unwrap the few shapes we accept.
 */
function unwrap(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;

  if (typeof record.stringValue === 'string') return record.stringValue;
  // Read timestamps and numbers as text rather than silently dropping them.
  if (typeof record.timestampValue === 'string') return record.timestampValue;
  if (typeof record.doubleValue === 'number') return String(record.doubleValue);
  if (typeof record.integerValue === 'string') return record.integerValue;

  return undefined;
}

function pick(raw: Record<string, unknown>, key: keyof SiteSettings): string | undefined {
  const field = raw[key];
  if (!field || typeof field !== 'object') return undefined;
  return unwrap(field);
}

/**
 * Fetches settings, merging over the defaults so a partially-filled document
 * does not blank out fields the admin has not touched yet.
 *
 * Returns null when the fetch cannot be made or the document is absent —
 * callers should treat that as "keep the baked markup", not as an error.
 */
export async function fetchSiteSettings(): Promise<SiteSettings | null> {
  if (!PROJECT_ID || !API_KEY) return null;

  const endpoint =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${DOC_PATH}`;

  try {
    const response = await fetch(endpoint, {
      headers: { 'x-goog-api-key': API_KEY },
    });

    // 404 means the document was never created. Not an error worth throwing
    // over — the admin panel may simply not have run yet.
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      fields?: Record<string, unknown>;
    };

    const fields = payload.fields;
    if (!fields) return null;

    const merged: SiteSettings = { ...DEFAULT_SETTINGS };
    let found = false;

    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SiteSettings)[]) {
      const value = pick(fields, key);
      if (value !== undefined) {
        merged[key] = value;
        found = true;
      }
    }

    return found ? merged : null;
  } catch {
    // Offline, DNS failure, CORS, malformed JSON — all mean the same thing
    // here: keep what was already rendered.
    return null;
  }
}

/** wa.me links need the number with no `+`, spaces, or dashes. */
function whatsappHref(number: string): string | null {
  const digits = number.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : null;
}

/**
 * Applies settings to the footer.
 *
 * Elements opt in via `data-site-field="<key>"`. Text targets get their
 * content replaced; `data-site-href` targets additionally get a rebuilt URL
 * (tel:, mailto:, wa.me), so an admin editing the phone number in Firestore
 * does not have to remember to edit the link separately.
 *
 * Set `data-site-text="false"` on a target whose text must not be touched.
 * The WhatsApp button is the case that matters: its visible content is an
 * icon plus the label "WhatsApp Direct", and only its href should change.
 * Assigning textContent there would destroy both children.
 */
export function hydrateSiteSettings(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-site-field]');
  if (targets.length === 0) return;

  void fetchSiteSettings().then((settings) => {
    if (!settings) return;

    for (const el of targets) {
      const key = el.dataset.siteField as keyof SiteSettings | undefined;
      if (!key) continue;

      const value = settings[key];
      if (!value) continue;

      if (el.dataset.siteText !== 'false') {
        el.textContent = value;
      }

      const hrefKind = el.dataset.siteHref;
      if (!hrefKind) continue;

      if (hrefKind === 'tel') {
        el.setAttribute('href', `tel:${value.replace(/\s/g, '')}`);
      } else if (hrefKind === 'mailto') {
        el.setAttribute('href', `mailto:${value}`);
      } else if (hrefKind === 'whatsapp') {
        const href = whatsappHref(value);
        if (href) el.setAttribute('href', href);
      }
    }
  });
}