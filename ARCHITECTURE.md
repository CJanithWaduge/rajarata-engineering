# ARCHITECTURE.md

Full-stack architecture for the Rajarata Engineering website and CMS.

This file is the committed record of how the system is put together and *why*. It
supersedes the Phase 12 decision text in `IMPLEMENTATION.md`, which is a
local-only planning document. Where the two disagree, this file wins.

**Owner approval:** the Phase 12 decisions marked **APPROVED** below were
confirmed by the owner on 2026-10-14. Phase 13 implementation choices and
clarifications are recorded with their approval dates.

## Status legend

| Tag | Meaning |
| --- | --- |
| `implemented` | Exists in this checkout and builds today. |
| `approved` | Decided and agreed; implementation status is stated in the relevant section. |
| `planned` | Scheduled in `IMPLEMENTATION.md` Phases 13–19. Nothing built. |
| `open` | Needs a decision or a fact from the owner. Do not assume an answer. |

> The staging project ID is `rajarata-engineering-developer`; its Firebase/GCP
> resources have not been changed by this work. Phase 13 has added local SSR,
> Hosting, and Storage-rule configuration, but no Cloud Run service or Hosting
> release has been deployed. Production project and billing details remain open.

---

## 1. System overview

```mermaid
flowchart TB
  subgraph public["Public marketing site — 100% static"]
    V[Anonymous visitor] --> H[Firebase Hosting CDN]
    H -- "/ , /services , /about-us , /projects , /contact" --> D["dist/ release artifact<br/>baked HTML + tokens + media URLs"]
  end

  subgraph admin["Admin platform — local foundation implemented; staging not deployed"]
    AD[Administrator browser] --> H
    H -- "/admin/** rewrite (pinTag)" --> SSR["Admin SSR service<br/>session-cookie verified before render"]
    SSR --> AUTH[Firebase Auth]
    SSR --> FS[(Firestore)]
    SSR --> ST[(Cloud Storage)]
  end

  subgraph publish["Content publishing — local implementation; staging blocked"]
    SSR -- "authorized Publish" --> PIPE[Server-side publish pipeline]
    PIPE -- "freeze snapshot" --> FS
    PIPE -- "RELEASE_ID" --> BUILD["Astro build<br/>(reads one release doc)"]
    BUILD --> ART[(Release artifact bucket)]
    PIPE -- "deploy" --> H
  end
```

**Two delivery paths, one codebase.**

| Path | Content | Delivery |
| --- | --- | --- |
| Public site | Marketing pages, tokens, published media | Fully static `dist/client/` on Firebase Hosting's CDN |
| Admin platform | Editors, lists, media library, preview, publish, history | On-demand Astro app behind a Hosting rewrite, verified per request |

The public site is deliberately **not** server-rendered. It stays static so it
remains fast, crawlable, and cheap, and so Firebase Hosting serves it exactly as
it does today. Only `/admin/**` is dynamic.

---

## 2. Stack

Fixed. Do not substitute a layer without asking first.

| Layer | Choice | Status |
| --- | --- | --- |
| Front-end | Astro 7 + Tailwind CSS 4 (CSS-first `@theme`, no `tailwind.config.js`) | `implemented` |
| Admin dynamic rendering | Astro `@astrojs/node` standalone on Cloud Run, `asia-south1` for staging | `implemented` locally; not deployed |
| Database | Firebase Firestore | Authorization rules, audit/rate-limit use, and local versioned CMS schemas implemented; no CMS records or migrations deployed |
| Auth | Firebase Auth, admin-only via the `admin` custom claim | `implemented` locally; staging configuration and verification pending |
| Files | Firebase Storage with admin-only drafts and public published media | Rules and local Admin media management implemented; staging verification pending |
| Functions | Cloud Functions for contact form; server-side publishing pipeline | Contact callable implemented locally with configurable SMTP; not deployed or delivery-verified. Publishing staging pipeline remains blocked. |
| Hosting | Firebase Hosting — static `dist/client/` for public pages, rewrite for `/admin/**` | `implemented` locally; not deployed |
| CI/CD | GitHub Actions on merge to `main` for **code**; Cloud Build trigger for **content** | `approved`; local trigger client implemented, staging trigger not configured |

No client-side UI framework. Interactivity is progressive enhancement in small
TypeScript modules and inline `<script>` blocks. No `.astro` component may ship
an inline `<style>` block.

---

## 3. Front-end architecture

### 3.1 Layouts

| File | Role | Status |
| --- | --- | --- |
| `src/layouts/Base.astro` | Public document head: fonts, global styles, per-route title/meta, script bootstraps | `implemented` |
| `src/layouts/AdminLayout.astro` | Admin shell: rail/drawer navigation, breadcrumb, verified identity, `#admin-content` region | `implemented` |
| `src/layouts/AdminAuthLayout.astro` | Standalone shell for the sign-in screen | `implemented` |

The admin shell deliberately does **not** render the public marketing header or
footer. It reuses the brand, tokens, focus conventions, and Material Symbols only.

### 3.2 Pages

| Route | Source | Status |
| --- | --- | --- |
| `/` | `src/pages/index.astro` | `implemented` |
| `/services` | `src/pages/services.astro` | `implemented` |
| `/about-us` | `src/pages/about-us.astro` | `implemented` |
| `/projects` | `src/pages/projects.astro` | `implemented` |
| `/contact` | `src/pages/contact.astro` | `implemented` |
| `/admin` | `src/pages/admin/index.astro` (dashboard) | `implemented` as frontend |
| `/admin/login` | `src/pages/admin/login.astro` | `implemented` locally; Firebase configuration and staging verification pending |
| `/admin/services`, `/admin/services/edit` | list + editor | `implemented` as frontend |
| `/admin/projects`, `/admin/projects/edit` | list + editor | `implemented` as frontend |
| `/admin/content` | Home / About / Contact / Business Details / SEO editors | `implemented` as frontend |
| `/admin/media` | media library, upload, metadata, archive/restore | `implemented` locally; emulator-only until staging verification |
| `/admin/preview` | saved-draft preview and validation rail | `implemented` locally; emulator-only until staging verification |
| `/admin/history` | release history + rollback | connected to the local publishing API; staging pipeline not configured |

"Implemented as frontend" means the UI exists and is reviewed, but every
backend-dependent control is disabled or reports "not connected". The local
Phase 14 draft and Phase 15 media paths are exceptions: they are wired to
emulators only. The Phase 17 history UI and protected publishing API are wired
locally, but the Cloud Build trigger, Hosting deployer, and status-writing
pipeline are not configured. Publishing is not available in staging.

### 3.3 Components

```
src/components/
  ui/        Button, Card, Chip, Field        # presentational primitives, no data layer
  home/      Hero, TrustStrip, AboutIntro, ServicesGrid, WhyChoose,
             ProjectsSection, ProjectCard, ClosingCta
  services/  ServicesHero, ServicesDirectory, ServiceCard, EngineeringProcess, ServicesCta
  about/     AboutHero, EngineeringHeritage, VisionMission, CorePillars,
             ProjectMethodology, IndustriesServed, AboutCta
  projects/  ProjectsHero, ProjectPortfolio, ProjectCard, ProjectTrackRecord, ProjectsCta
  contact/   ContactHero, EmergencySupport, OperationalDesks,
             TechnicalQuotation, VisitorInformation
  admin/     AdminNav, AdminPageHeader, AdminField, FormSection, TagInput,
             EditorActionBar, StatusChip, RowActions, Panel, OverviewGrid,
             EmptyState, LoadingLines, Skeleton, AssetThumb, AdminNotice
```

Rules that hold across the whole tree:

- Section components are owned by one page and are never shared across pages.
- `ui/` primitives stay presentational. A primitive that imports content drags
  the data layer into every consumer.
- All styling is Tailwind utility classes. Design tokens live only in
  `src/styles/global.css`.

### 3.4 Design tokens

Single source: the `@theme` block in `src/styles/global.css`, ported from the
approved prototype design. Tailwind 4 is CSS-first, so there is no config file —
editing tokens happens in the stylesheet, which must begin with
`@import "tailwindcss";`.

Current tokens include the palette, type scale (`display-hero`, `headline-*`,
`title-*`, `body-*`, `label-*`), radii (`card` 18px, `control` 12px, `chip` 6px),
the three shadow levels, and one project-specific `@custom-variant backdrop
(&::backdrop)` so modal `<dialog>` scrims can be styled.

Components never hardcode hex values.

### 3.5 Client runtime

| Module | Purpose | Status |
| --- | --- | --- |
| `src/lib/scrollReveal.ts` | Viewport reveal, respects `prefers-reduced-motion`, content visible without JS | `implemented` |
| `src/lib/cardTilt.ts` | Progressive pointer interaction on cards | `implemented` |
| `src/lib/adminNav.ts` | Admin nav model, active-state resolution, breadcrumbs | `implemented` |
| `src/lib/adminEditor.ts` | Editor runtime: dirty tracking, validation surfacing, counters | `implemented` |
| `src/lib/adminMediaLibrary.ts` | Local preview, upload progress/cancel, metadata updates, archive/restore | `implemented` locally; emulator-only |
| `src/lib/adminMediaSelection.ts` | Protected asset previews and unavailable-image fallback in editors | `implemented` locally; emulator-only |
| `src/lib/draftPreview.ts` | Authorized saved-draft snapshot assembly and media/content diagnostics | `implemented` locally; emulator-only |
| `src/components/admin/DraftPreviewCanvas.astro` | Responsive saved-draft canvas for page, service, project, SEO, and business fields | `implemented` locally; emulator-only |
| Static footer content | Business details rendered into the build by `src/components/Footer.astro` | `implemented`; no public Firestore reads |

---

## 4. Admin platform architecture

### 4.1 Why the admin UI cannot be static

Firebase Hosting serves files to anyone who requests them. A static
`/admin/**` build is therefore public regardless of `noindex`, obscured URLs, or
client-side route guards. Client-side auth hides the UI *after* delivery, which
is not access control.

### 4.2 Approved delivery model — D1 `APPROVED`

```mermaid
sequenceDiagram
  participant B as Administrator browser
  participant H as Firebase Hosting
  participant S as Admin SSR service
  participant A as Firebase Auth

  B->>H: GET /admin/services  (Cookie: __session=…)
  H->>S: rewrite /admin/** (pinTag-pinned revision)
  S->>A: verifySessionCookie(cookie, checkRevoked: true)
  A-->>S: uid + claims
  alt admin claim present
    S-->>B: rendered admin HTML (no-store, noindex)
  else
    S-->>B: obstacle-free redirect to /admin/login
  end
```

- The **public site stays fully static**. Only `/admin/**` renders on demand.
- The admin service verifies a **Firebase Auth session cookie** server-side on
  every request and additionally requires `admin === true`. Nothing is rendered
  before that check passes.
- `/admin/preview` runs in the same service and loads genuine saved draft
  content through the versioned schema and protected media route. Its responsive
  canvas renders the CMS-managed fields present in schema v1 with the shared
  design system. Code-managed page sections are explicitly identified as
  unchanged; this preview is not a pixel-identical rendering of the eventual
  published release.
- Hosting rewrites to Cloud Run and Functions v2 support `pinTag`, pinning the
  admin service revision to the Hosting release so they roll back together.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`, 5-day lifetime
  (platform maximum is 14). Created by a same-origin HTTPS POST endpoint on the
  Admin SSR service using Admin SDK `createSessionCookie`, verified with
  `checkRevoked`.
- Same-origin mutations require a configured Hosting origin and a custom CSRF
  header. For authenticated requests, the CSRF token is derived from the
  HttpOnly `__session` cookie, so the server does not rely on Hosting forwarding
  any additional cookie. The unauthenticated login exchange uses strict Origin
  validation and a required non-simple custom header; cross-origin CORS is not
  enabled.

### 4.3 Binding delivery constraints

1. **Hosting resolution order is** reserved namespaces → configured redirects →
   **exact-match static content** → configured rewrites. A rewrite only fires
   when no static file matches.
2. Therefore the `/admin/**` routes **must be removed from the public static
   build**. If `dist/admin/index.html` ships, it is served directly and the
   rewrite is silently bypassed — an access-control bypass, not a cosmetic bug.
3. `headers` matching runs **before** rewrites, so `Cache-Control: private,
   no-store` and `X-Robots-Tag: noindex` for `/admin/**` can be declared in
   `firebase.json` and still apply.
4. **Verify at Phase 13.5:** Hosting's cookie forwarding to backend rewrites.
   Historically only the `__session` cookie is forwarded to a backend. If that
   still holds, the session cookie must be named `__session`. Do not assume
   `Set-Cookie`/`Cookie` pass-through works until it is tested on a real rewrite.

### 4.4 Consequence for the Phase 11 tree

The 10 static `/admin/**` routes are a **frontend reference**, not a delivery
mechanism. They keep their current layout, components, and tokens, but they move
out of the public static output before any real data is connected.

---

## 5. Data architecture

### 5.1 Three concepts, three lifecycles

| Concept | Mutability | Visibility | Written by |
| --- | --- | --- | --- |
| **Draft** — working copy of everything editable | Mutable | Admin only | Verified Admin SSR API; emulator-only before Phase 13 staging verification |
| **Release snapshot** — frozen copy taken at publish | Immutable | Admin only | Trusted publish path only |
| **Published output** — the `dist/` for that release | Immutable | Public | Deploy pipeline |

There is exactly **one draft set** for the whole site: a single Publish publishes
everything. This matches the Phase 11 decision and Phase 10's atomicity
requirement.

### 5.2 Firestore layout — `approved` (schema v1 finalized locally in Phase 14)

```
drafts/services/records/{slug}   # one doc per service
drafts/projects/records/{slug}   # one doc per project
drafts/pages/records/{pageId}    # structured page copy; section IDs are code-controlled
drafts/settings/records/businessDetails
drafts/settings/records/seo
drafts/media/records/{assetId}  # metadata mirror; object is under media/drafts/{assetId}/
releases/{releaseId}            # immutable snapshot + build/deploy result
locks/publish                   # single-doc mutex, used in a transaction
adminAudit/{eventId}            # provisioning and publish audit trail
```

Field inventory (from the Phase 10 editable-content inventory):

| Collection | Fields | Notes |
| --- | --- | --- |
| `drafts/services/records/{slug}` | `schemaVersion`, `id`, `order`, `category`, `title`, `summary`, `body`, `scope`, `suitability[]`, `imageRef`, `archived`, `updatedAt` | `id` immutable; in-page anchors depend on it |
| `drafts/projects/records/{slug}` | `schemaVersion`, `id`, `order`, `category`, `title`, `summary`, `specifications`, `location`, `year`, `reference`, `clientName`, `imageRef`, `altText`, `featured`, `archived`, `updatedAt` | No invented values; owner-verified only |
| `drafts/pages/records/{pageId}` | `schemaVersion`, per-section heading/intro/body/label/CTA/items, `updatedAt` | Structured text fields only; section names and CTA routes are allow-listed |
| `drafts/settings/records/businessDetails` | `schemaVersion`, `address`, `phone`, `email`, `hours`, `whatsapp`, `updatedAt` | Replaces `siteSettings/public` (D3) |
| `drafts/settings/records/seo` | `schemaVersion`, per-route `title`, `description`, share-image reference, `updatedAt` | Must be in the generated document |
| `drafts/media/records/{assetId}` | `schemaVersion`, `filename`, `alt`, `width`, `height`, `contentType`, `bytes`, `storagePath`, `archived`, `updatedAt` | Metadata only; JPEG/PNG/WebP, 10 MiB maximum; bytes live in Storage |
| `releases/{releaseId}` | `schemaVersion`, `createdAt`, `completedAt`, `createdBy`, `snapshot`, `mediaRefs[]`, `status`, `hostVersionId`, `buildId`, `failure`, `rollbackOf` | Snapshot immutable to clients; status and deploy fields are pipeline-managed |

The TypeScript contracts and runtime parsers live in
`src/lib/contentModel.ts`; `src/lib/draftRepository.ts` provides validated,
version-checked reads and writes. Document timestamps crossing the application
boundary use canonical ISO-8601 UTC strings. Schema version 1 is explicit.
The Admin SSR API is guarded by the verified session claim and is hard-limited
to a `demo-*` project with the Firestore emulator enabled. Client rules permit
admins to read draft documents but deny all client writes; release writes are
also denied. The legacy footer-settings mapper and repository operations are
tested locally. No staging CMS data or migration has been created.

**Pricing is deliberately absent** until the owner confirms fixed-per-service
versus quoted-per-project.

Draft writes use Firestore transactions with the editor's expected
`updatedAt`, rejecting stale edits rather than silently overwriting them.
Saving drafts does not feed the static public build; publishing remains a
separate, unimplemented phase.

### 5.3 Storage layout — `approved`

| Prefix | Access | Purpose |
| --- | --- | --- |
| `media/published/{sha256}/…` | World read-only | Media referenced by a published release |
| `media/drafts/{assetId}/…` | Admin only | Uploaded but unpublished media |

Published paths are **content-hash addressed**, so identical bytes are shared
across releases and repeated publishing does not duplicate storage. Garbage
collection removes an object only when no retained release references it.

Draft objects are never public. Because Storage rules cannot consult "the live
release" cheaply, the publish path copies referenced draft objects into the
published namespace rather than relying on a runtime lookup.

Phase 15 uploads and Admin previews are mediated by the verified Admin SSR
session and are restricted to the local demo project until the Phase 13
staging gate passes. Storage rules additionally constrain draft writes to
authenticated admins, approved raster MIME types, and 10 MiB. Replacing media
creates a new uniquely named draft object; archive/restore changes only the
metadata record. Permanent deletion and garbage collection are not available,
so retained releases cannot lose their referenced objects.

### 5.4 Stable identifiers

- Service and project `id` is a slug that is **immutable while any release
  containing it is live**. The prototype anchors `#service-01` … `#service-08`
  are load-bearing, so existing slugs are pinned. A rename must ship an alias.
- `order` is an integer; ties break on `id` so rendered order is deterministic.
- Release ids are sortable and unique (e.g. `20261014-1930-<short>`).
- **No document id is derived from user-editable text**, and no id is reused
  after archival.

### 5.5 Public read boundary — D4 `APPROVED`

- **Firestore: no public reads.** The public site performs no runtime Firestore
  reads. All content and metadata are baked into HTML at build time, which is
  what makes publishing atomic, crawlable, and cache-safe.
- **Storage: published media only.** Everything else is admin-only or denied.

### 5.6 Retired `siteSettings/public` — D3 `APPROVED`

Under Build and Deploy, keeping a public runtime override for footer details
would let two versions of the same values diverge — Phase 10 explicitly flagged
this. The Phase 13 local foundation has:

1. removed the `siteSettings/public` public-read rule from `firestore.rules`,
2. removed `fetchSiteSettings`/`hydrateSiteSettings`, the `data-site-field`
   hooks, and the obsolete `src/lib/siteSettings.ts` module,
3. left the footer rendering business details at build time.

The current footer values, including the masked phone number (`+94 77 XXX XXXX`),
are illustrative and **must be confirmed by the owner** before the public site
ships. Phase 17 will source the values from the selected release snapshot.

---

## 6. Identity and access

### 6.1 Model

| Role | Holds | Can do |
| --- | --- | --- |
| Project custodian | Google Cloud/Firebase project access | Grant/revoke the `admin` claim |
| Operator | Time-boxed project access | Run the provisioning script |
| Administrator | Firebase Auth user with `admin == true` | Use the CMS. Needs **no** Google Cloud access |
| Pipeline service accounts | Attached IAM identities | Only their own job |

Authorization signal is the single `admin` custom claim, matching today's
`firestore.rules`. Signing in grants nothing on its own.

### 6.2 Provisioning — D5 `APPROVED`

Two paths, both server-side Admin SDK, **never the browser**:

1. **Bootstrap and break-glass (operator-run).** A versioned script run with
   Application Default Credentials (`gcloud auth application-default login`) by
   someone who already has project access. No service-account key file is ever
   created. This is the only path that can create the first admin.
2. **Routine changes (admin-only SSR endpoint).** Verifies the caller's
   `__session` cookie and `admin` claim, checks a code-controlled custodian
   allow-list, then sets or removes the claim. Rate-limited and audited. This
   uses the same request boundary as the Admin UI, not a callable that would
   require keeping a browser ID token after session-cookie exchange.

Verification and audit:

- A claim change only appears in a **newly issued** ID token; the UI forces a
  refresh and the server always uses the revoked-check variant.
- Cloud Audit Logs (Data Access) for `identitytoolkit.googleapis.com` and
  `firebaseauth.googleapis.com` make every change attributable.
- The trusted path writes `adminAudit/{eventId}`: actor, target, action,
  timestamp, reason. Never credentials or tokens.
- Until two custodian UIDs are supplied, the tracked
  `src/config/admin-custodians.json` allow-list is empty and all real grants
  through the Admin endpoint and operator script fail closed.

Recovery:

- **Two custodians minimum**, so one lost account is not fatal.
- Lost admin → re-run the operator script against a new or reset Auth user.
- Compromised admin → revoke the claim **and** `revokeRefreshTokens(uid)`, then
  confirm live sessions fail.
- Lost project access → Google account recovery; the runbook records a recovery
  contact. A secrets-free runbook may be committed.

### 6.3 Session mechanics

Client signs in with the Firebase Auth web SDK, then exchanges the ID token for
an `HttpOnly` session cookie via a same-origin HTTPS POST endpoint on the Admin
SSR service. The endpoint validates the request origin and login CSRF header,
verifies the ID token and current `admin` claim, and sets the cookie with
`createSessionCookie`; it never returns the session-cookie value to browser
JavaScript. The client uses in-memory Auth persistence and signs out after the
exchange. For authenticated state-changing requests, the SSR service provides
a CSRF token derived from the HttpOnly session cookie; the token travels in a
custom request header, not a second cookie, because Hosting may forward only
the specially named `__session` cookie to a rewrite. The SSR service calls
`verifySessionCookie(cookie, checkRevoked)` on every protected request and
requires `admin === true`. The cookie expires after five days; because the
browser clears Firebase Auth state after exchange, an expired session requires
a fresh sign-in rather than automatic renewal. These changes replace the
original callable proposals: Firebase's documented session-cookie flow
requires an HTTP response to set the `HttpOnly` cookie safely, and the browser
clears ID-token state after the exchange.

---

## 7. Publishing pipeline

**Implementation status (2026-10-16):** the local release repository, protected
publish/rollback API, Cloud Build trigger client, and release-history UI are
implemented. The trigger client passes `_RELEASE_ID` so a pipeline can consume
the frozen release instead of building against mutable drafts. The staging
project has no associated billing account; required APIs could not be enabled.
No trigger, build definition, service identities, or Hosting deployment has
been provisioned or verified. Phase 17 remains incomplete until its staging
exit gate passes.

### 7.1 Trigger comparison — D6 `APPROVED`

| | GitHub Actions as the CMS trigger | Server-side pipeline |
| --- | --- | --- |
| Credential | Long-lived GitHub token with repo write access, held by the publish function | None — the pipeline lives inside the project |
| Coupling | Content publishing depends on the repo, its branch protection, and GitHub availability | Independent of the code repo |
| Status | Must be relayed back into Firestore | The job writes the release record directly |
| Least privilege | Broad token, hard to scope | Per-job service accounts |

**Decision:** a **server-side publish pipeline** (Cloud Run job or Cloud Build)
started by an authenticated callable. **GitHub Actions on merge to `main`
remains the code-deployment route** and is kept clearly separate. Firebase App
Hosting is not used for publishing because it deploys on push, which
reintroduces a commit requirement the CMS must not have.

### 7.2 Flow

```mermaid
sequenceDiagram
  participant AD as Administrator
  participant P as Publish callable
  participant L as locks/publish
  participant FS as Firestore
  participant J as Build/deploy job
  participant H as Firebase Hosting

  AD->>P: Publish (ID token)
  P->>P: verify token + admin claim
  P->>L: begin transaction (serialise)
  P->>FS: copy drafts/** -> releases/{releaseId} (immutable)
  P->>J: start job with RELEASE_ID
  J->>FS: read releases/{releaseId}
  J->>J: npm run check && npm run build
  J->>H: deploy artifact
  J->>FS: status = live + hostVersionId
  AD-->>AD: status shown only after Hosting confirms live
```

### 7.3 Build input rule

The Astro build **never reads the live draft set**. The pipeline passes
`RELEASE_ID`; the build fetches exactly one `releases/{releaseId}` document via
the Admin SDK (ADC) and renders from its `snapshot`.

This gives atomicity (one document defines the whole site), reproducibility
(same `releaseId` ⇒ same output), rollback, and immunity to torn reads while a
draft is being edited. Archived items are excluded when the snapshot is created,
so no draft-only field can reach public HTML.

### 7.4 Least-privilege identities

| Identity | Granted | Explicitly not granted |
| --- | --- | --- |
| `publish-sa` (callable runtime) | Read `drafts/**`, write `releases/**` + `locks/**`, start the job, verify tokens | Draft writes, Hosting deploy |
| `builder-sa` (build job) | Read one release, read published media, write the artifact, write release status | Draft writes, deploy, other releases |
| `deployer-sa` (Hosting deploy) | Create Hosting versions/releases for the single site | Firestore, Storage, Auth |
| GitHub Actions deploy | Hosting deploy only, via **Workload Identity Federation (OIDC)** | Long-lived JSON keys |
| Operators | Time-boxed project access for provisioning | Standing deploy rights |

No key is committed, stored in `.env`, or shipped to a browser. `PUBLIC_*`
variables never carry a secret.

### 7.5 Concurrency, status, and rollback

- One in-flight publish per site, enforced by a transaction on `locks/publish`.
  A second request is rejected with a clear "release in progress" state rather
  than silently queued or merged.
- Status is written only by the pipeline: `queued → snapshotting → building →
  deploying → live | failed`, plus rollback states.
- **"Live" is reported only after the intended Hosting release is confirmed**,
  with `hostVersionId` recorded. A failure leaves the previous release serving.
- Retain per release: the immutable snapshot, the built artifact (private), and
  the referenced published media.
- Rollback = redeploy the retained artifact (fast path); if the artifact is
  gone, rebuild from the snapshot. Success is reported only after verification.
- **Retention — D8 `APPROVED`:** the last 20 releases, always including current
  and previous; media retained at least as long as any retained release
  referencing it.
- `firebase hosting:rollback` stays available as break-glass, but the CMS uses
  the recorded artifact so the release record stays truthful.

---

## 8. Environments — D7 `APPROVED`

| Environment | Purpose | Firebase project | Data | Deploy path |
| --- | --- | --- | --- | --- |
| Local | Development | None — Emulator Suite only | Synthetic seeds | `astro dev`; no cloud writes |
| Staging | Verification, rules tests, owner acceptance | Separate project (name `open`) | Synthetic + owner-approved test content | Full pipeline |
| Production | Live site | Production project (name `open`) | Real content | Approved pipeline only |

Rules:

- **Never use production credentials locally.** Local runs use
  `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`,
  `STORAGE_EMULATOR_HOST`.
- `.env` / `.env.*` stay gitignored; only non-secret `PUBLIC_*` values are
  allowed in frontend variables.
- Staging and production never share buckets, Hosting sites, Auth users, or
  service accounts. A staging admin can never touch production.
- `.firebaserc` holds project aliases only.
- Safe test data is synthetic and obviously fake. The Phase 11 rule extends to
  fixtures: **no invented client names, metrics, certifications, locations, or
  years**, not even as test data.

---

## 9. Security boundaries

| Boundary | Enforcement point | Never rely on |
| --- | --- | --- |
| Admin HTML delivery | Server-side session + claim verification before render | `noindex`, obscured URLs, client-side guards, static pages |
| Draft data | `firestore.rules`: `request.auth.token.admin == true` | Client-side role checks |
| Media | `storage.rules`: drafts admin-only, published read-only | Unlisted/download-token URLs alone |
| Publish | Server-side callable verifying token + claim, then a serialised pipeline | A browser-initiated build with a general-purpose token |
| Contact inquiries | HTTPS callable with App Check, server-side validation, Firestore abuse limit, and SMTP secrets | Client-side validation or a honeypot alone |
| Deploy | Dedicated service accounts, WIF for GitHub Actions, no committed keys | Keys in `.env`, repo files, or client bundles |
| Public content | Static `dist/` built from exactly one release snapshot | Public Firestore reads for page content |

### 9.1 Threat model

**Assets:** draft content; write access to published content; admin sessions;
the deployment identity; (later) mail-provider credentials.

**Actors:** anonymous visitor (untrusted); authenticated non-admin (untrusted for
CMS); administrator (trusted by the owner, but their browser is untrusted);
operator/custodian (trusted humans with cloud access); pipeline service accounts
(least-privilege, non-human, separated by job).

### 9.2 Current enforcement reality

`firestore.rules` requires the `admin` claim for reads and writes, except for
the user's own `/users/{uid}` identity document. `storage.rules` permits
anonymous reads only under `media/published/**`, admin-only draft access, and
denies other paths. The rules and route authorization middleware are
implemented and verified against the local Firebase Emulator Suite, including
anonymous, authenticated non-admin, and admin contexts. They have not been
deployed to or verified in staging.

---

## 10. Verification and release gates

Per gate:

1. `npm run check` and `npm run build` (already the per-step gate).
2. Rules unit tests on the emulator for Firestore **and** Storage, against
   anonymous / authenticated non-admin / admin.
3. Auth boundary tests: signed-out direct URL to `/admin/**`, expired session,
   revoked claim, authenticated non-admin.
4. **Draft-leak scan** after build: `dist/client/` must contain no draft-only
   markers or ids, no `[REPLACE:` copy, and no static Admin HTML/routes. Public
   browser bundles may include non-sensitive UI code but must contain no
   credentials or private content.
5. Publish/rollback integration tests in staging: complete release, failed build,
   retry, concurrent publish, rollback, media retention across two releases.
6. Accessibility and responsive review repeated on the connected admin UI.
7. Secret scan of the repo and generated output.

Release approval:

- **Developer gate:** checks and rules/auth tests pass.
- **Owner gate:** content facts (certifications, projects, contact details,
  performance claims) verified by the owner before the first production publish.
- **Explicit authorization required** before creating or changing Firebase
  projects, configuring secrets, and every production deployment. Production
  publishing stays disabled until the Phase 13–17 exit gates pass and P20.5 is
  approved.

### Build commands (today)

```sh
npm ci
npm run check     # astro check — must report 0 errors, 0 warnings, 0 hints
npm run build     # public routes into dist/client/; SSR app into dist/server/
npm run preview   # preview the static build locally
```

Deployment is not performed by these commands. Do not run `firebase deploy` by
hand without asking.

---

## 11. Decision log

| # | Decision | Answer | State |
| --- | --- | --- | --- |
| D1 | Protected admin delivery boundary | Server-rendered admin behind a Firebase Hosting rewrite, session-cookie verified | **APPROVED** 2026-10-14 |
| D2 | `/admin/**` in the public static build | Removed — mandatory, or the rewrite is bypassed by static content | **APPROVED** 2026-10-14 |
| D3 | `siteSettings/public` runtime footer hydration | Retired; all content comes from the build snapshot | **APPROVED** 2026-10-14 |
| D4 | Public reads | No public Firestore reads; Storage reads limited to published media | **APPROVED** 2026-10-14 |
| D5 | Admin provisioning path | Operator script for bootstrap + admin-only SSR endpoint; custodian allow-list required | **APPROVED** 2026-10-14; endpoint correction approved 2026-10-15 |
| D9 | Session-cookie exchange | Same-origin HTTPS POST handled by Admin SSR, not callable; CSRF and HttpOnly `__session` | **APPROVED** 2026-10-15 |
| D10 | Admin SSR runtime | Cloud Run standalone Astro service in `asia-south1` for staging | **APPROVED** 2026-10-15 |
| D6 | Publish trigger | Server-side pipeline; GitHub Actions stays for code only | **APPROVED** 2026-10-14 |
| D7 | Environments | Separate staging and production projects; emulators locally | **APPROVED** 2026-10-14 |
| D8 | Retention | 20 releases; media retained while any retained release references it | **APPROVED** 2026-10-14 |

---

## 12. Open items

These are unanswered. Do not assume an answer.

| # | Item | Blocks |
| --- | --- | --- |
| O1 | Named project custodian and a second custodian | Routine admin grants and bootstrap script remain blocked until two UIDs are added to the code-controlled allow-list |
| O2 | Production Firebase project id/name and billing owner | Production setup and Phase 17. Staging project `rajarata-engineering-developer` exists; owner confirmed it on 2026-10-15 |
| O4 | Confirm the footer business details in `DEFAULT_SETTINGS` (address, phone, email, hours) before the site ships | Content, not code |
| O5 | Fixed price per service, or quoted per project? | Pricing schema |
| O6 | Should root `DESIGN.md` be restored? It was removed in commit `fc57401` and Phase 11 referenced the recoverable copy. | Future UI work |
| O7 | Who verifies factual claims (certifications, projects, metrics) before the first production publish? | Owner gate |

---

## 13. Related documents

| Document | Scope | Tracked |
| --- | --- | --- |
| `ARCHITECTURE.md` | This file — system design and decisions | Yes |
| `README.md` | Local setup, scripts, front-end structure | Yes |
| `IMPLEMENTATION.md` | Ordered build plan and phase records | No — gitignored |
| `AGENTS.md` | Working agreements for agents | No — gitignored |
| `UI-UX-design/` | Approved prototype design source (read-only) | No — gitignored |
| `firestore.rules` | The one implemented security boundary | Yes |
