# Rajarata Engineering CMS Admin UI — Design Specification

## Purpose

Design a secure, calm, and efficient content-management interface for Rajarata Engineering administrators. Administrators use it to maintain approved public-site content, review a private draft preview, publish a complete static-site release, monitor its build/deploy status, and restore a prior published snapshot when needed.

This document is a design brief for Google Stitch AI and a visual reference for later implementation. It specifies interface appearance and user-facing states; it does not authorize or define CMS code, Firestore schemas, Firebase rules, backend endpoints, or deployment automation.

## Product and implementation context

- The public site is built with **Astro 7 + Tailwind CSS 4** and generates static files in `dist/`.
- **Firebase Hosting** serves the public build. It does not render live Firestore content per request.
- The approved content delivery decision is **Build and Deploy for all CMS-managed content**, including business details. There is no hybrid publishing model.
- An authorized Publish action is expected to make changes live in a typical **2–5 minutes**. This is a target, not a guarantee. The UI must communicate actual pipeline state and errors.
- Administrators need an **access-controlled draft preview** before publishing.
- Administrators need to **restore a previously published content snapshot** if a release or its content causes a problem.
- Public-site code, page layouts, design tokens, component behavior, authentication, security policy, form validation, and allowed navigation destinations remain controlled in code. Do not imply that administrators can arbitrarily edit scripts, HTML, routes, or security rules.
- Firebase Authentication, Firestore, and Firebase Storage are the selected platform services. Admin access is enforced by server-side rules/claims, not by hiding UI controls.
- The existing public-site theme and tokens live in `src/styles/global.css`. The approved source reference is `UI-UX-design/precision_industrial_engineering/DESIGN.md`. Follow the current project token values below; do not modify either source reference while using this document.

## Design direction

**High-contrast corporate modernism with technical structuralism.** The admin UI should feel like a precise engineering control room: dependable, composed, information-dense where useful, and explicit about consequential publishing actions. Use strong alignment, calm surface layers, crisp borders, restrained red accents, and clear operational status.

The interface must remain part of the same Rajarata Engineering brand as the public site. It is an administrative product, not a redesign of the public website and not a generic SaaS template.

### Visual principles

- Favor legibility and clear hierarchy over decorative effects.
- Use a light neutral canvas, white content surfaces, and tonal surface containers to group related areas.
- Use the dark inverse surface selectively for a navigation rail, compact header region, or high-priority contextual panel; do not make the entire admin UI dark.
- Reserve primary red for the main action, active navigation/status emphasis, and destructive or urgent cues where semantically appropriate. Do not color every button red.
- Use hairline borders and shallow shadows to distinguish surfaces. Avoid glow, glassmorphism, blurred halos, gradients, and ornamental textures.
- Use compact tables and generous editor spacing. Do not compress form labels or supporting instructions to fit more controls on screen.
- Motion is brief and functional: immediate pressed feedback and restrained state transitions. Respect reduced-motion settings.

## Design system and tokens

The following values reflect the existing Tailwind 4 `@theme` in `src/styles/global.css`. Use these semantic token names in generated UI concepts and implementation prompts rather than introducing a parallel palette.

### Color palette

| Semantic token | Value | Admin UI use |
| --- | --- | --- |
| `background` / `surface` | `#F9F9F9` | Application canvas and page background |
| `surface-dim` | `#DADADA` | Strong neutral separation only where needed |
| `surface-bright` | `#F9F9F9` | Bright surface plane |
| `surface-container-lowest` | `#FFFFFF` | Cards, tables, inputs, editor panels |
| `surface-container-low` | `#F3F3F3` | Grouped sections, secondary panels, editor canvas |
| `surface-container` | `#EEEEEE` | Secondary controls, selected neutral controls |
| `surface-container-high` | `#E8E8E8` | Hover/raised neutral surfaces |
| `surface-container-highest` / `surface-variant` | `#E2E2E2` | Stronger neutral boundaries or muted rows |
| `on-surface` / `on-background` | `#1B1B1B` | Primary text and headings |
| `on-surface-variant` | `#5B403D` | Secondary text; check contrast for small text |
| `inverse-surface` | `#303030` | Selective dark navigation or inverted panels |
| `inverse-on-surface` | `#F1F1F1` | Text on inverse surfaces |
| `primary` | `#AF101A` | Deep brand red; pressed/strong primary action |
| `primary-container` | `#D32F2F` | Primary action, active emphasis, brand marker |
| `on-primary` | `#FFFFFF` | Text/icons on primary action |
| `on-primary-container` | `#FFF2F0` | Text/icons on the primary container where needed |
| `primary-fixed` | `#FFDAD6` | Soft red status background |
| `primary-fixed-dim` / `inverse-primary` | `#FFB3AC` | Muted red emphasis on dark surfaces |
| `on-primary-fixed` | `#410003` | High-contrast text on primary-fixed |
| `on-primary-fixed-variant` | `#930010` | Secondary text on primary-fixed |
| `surface-tint` | `#BA1A20` | Tint only when a token-driven component requires it |
| `secondary` | `#575E70` | Supporting text and secondary actions |
| `on-secondary` | `#FFFFFF` | Text on secondary |
| `secondary-container` | `#D9DFF5` | Neutral/informational selected panel |
| `on-secondary-container` | `#5C6274` | Text on secondary container |
| `secondary-fixed` | `#DCE2F7` | Fixed pale supporting surface |
| `secondary-fixed-dim` | `#C0C6DB` | Muted supporting surface |
| `on-secondary-fixed` | `#141B2B` | Text on secondary-fixed |
| `on-secondary-fixed-variant` | `#404758` | Supporting text on secondary-fixed |
| `tertiary` | `#0056AA` | Information and connectivity accent |
| `on-tertiary` | `#FFFFFF` | Text/icons on tertiary |
| `tertiary-container` | `#276FCA` | Secondary informational action/emphasis |
| `on-tertiary-container` | `#F2F4FF` | Text/icons on tertiary container |
| `tertiary-fixed` | `#D6E3FF` | Informational status background |
| `tertiary-fixed-dim` | `#A9C7FF` | Muted information state |
| `on-tertiary-fixed` | `#001B3D` | Text on tertiary-fixed |
| `on-tertiary-fixed-variant` | `#00468C` | Supporting text on tertiary-fixed |
| `error` | `#BA1A1A` | Errors and destructive action feedback |
| `on-error` | `#FFFFFF` | Text/icons on error |
| `error-container` | `#FFDAD6` | Error and failed-publish message background |
| `on-error-container` | `#93000A` | Text on error-container |
| `outline` | `#8F6F6C` | Strong outline, focus-adjacent boundary where appropriate |
| `outline-variant` | `#E4BEBA` | Default hairline border token |
| `whatsapp` | `#15803D` | Only for a WhatsApp-specific brand action, not general status |
| `whatsapp-hover` | `#14532D` | Hover for that WhatsApp-specific action only |

Use the color-token values above as the source of truth for the application. Do not silently replace them with nearby colors from another Tailwind palette. Status color must not be communicated by color alone; always pair it with a label and, where useful, an icon.

### Typography

Use **Plus Jakarta Sans** for all UI text. Use **Material Symbols Outlined** for icons; icons supplement visible labels and must not replace accessible names.

| Token | Size / line height | Weight | Tracking | Recommended admin use |
| --- | --- | --- | --- | --- |
| `display-hero` | 56px / 64px | 800 | -0.03em | Rare large sign-in or dashboard welcome heading; not table titles |
| `display-hero-mobile` | 38px / 46px | 800 | -0.02em | Mobile version of the same rare display heading |
| `headline-lg` | 40px / 48px | 700 | -0.02em | Major page heading on wide screens |
| `headline-lg-mobile` | 30px / 38px | 700 | -0.015em | Major page heading on mobile |
| `headline-md` | 28px / 36px | 700 | -0.015em | Main editor or dashboard section heading |
| `headline-sm` | 22px / 30px | 600 | -0.01em | Panel, table, or form-group heading |
| `title-lg` | 18px / 26px | 600 | -0.005em | Card title or prominent field-group label |
| `title-md` | 16px / 24px | 600 | 0em | Navigation, row title, button or field title |
| `body-lg` | 18px / 28px | 400 | 0em | Introductory/help text |
| `body-md` | 15px / 24px | 400 | 0em | Standard interface copy and table content |
| `body-sm` | 13px / 20px | 400 | 0.005em | Supporting instructions, timestamps, metadata |
| `label-caps` | 11px / 16px | 700 | 0.08em | Short uppercase technical category labels only |
| `label-md` | 14px / 20px | 600 | 0.01em | Buttons, tabs, table headers, standard labels |
| `label-sm` | 12px / 16px | 600 | 0.01em | Compact field labels, helper labels, badges |

Do not use `label-caps` for paragraphs, long labels, or critical instructions. Keep small text high contrast and readable.

### Radius, spacing, and elevation

| Token | Value | Use |
| --- | --- | --- |
| `radius-card` | 18px | Main cards, editor panels, modal/dialog surfaces |
| `radius-control` | 12px | Inputs, selects, buttons, upload zones |
| `radius-chip` | 6px | Status chips, compact metadata tags |
| `spacing-xs` | 4px | Icon/label proximity, compact internal gap |
| `spacing-sm` | 8px | Dense control spacing |
| `spacing-md` | 16px | Standard control and panel gap |
| `spacing-lg` | 24px | Card padding and logical group spacing |
| `spacing-xl` | 40px | Major layout separation |
| `spacing-2xl` | 64px | Large section spacing |
| `spacing-gutter` | 24px | Standard page gutter |
| `spacing-gutter-mobile` | 16px | Mobile page gutter |
| `spacing-section` | 48px | Wide-screen section spacing |
| `spacing-section-mobile` | 20px | Mobile section spacing |

Elevation is restrained and tokenized:

- Card: `0 1px 3px rgb(17 24 39 / 0.05), 0 1px 2px rgb(17 24 39 / 0.03)`.
- Hover: `0 10px 25px -5px rgb(17 24 39 / 0.08), 0 8px 10px -6px rgb(17 24 39 / 0.04)`.
- Overlay: `0 20px 35px -10px rgb(17 24 39 / 0.16)`.

Keep 1px boundaries crisp. Avoid strong ambient shadows. Use hover elevation only on genuinely interactive surfaces.

### Controls and interaction

- Standard inputs/selects: 48px minimum height, white surface, 12px radius, 1.5px border, label above.
- Primary button: 48px desktop height, red `primary-container` fill and white label. Compact button may be 40px.
- Secondary button: neutral container fill; outline/ghost action uses transparent or low surface and a hairline border.
- Keyboard focus: visible 2px outline with 2px offset, using a theme-approved high-contrast outline. Never remove focus indication.
- Press feedback: immediate subtle 1px downward translation; avoid springy/bouncy animation.
- Disabled controls must remain legible and have a discernible disabled state; explain why an action is unavailable when not obvious.
- Use semantic buttons for actions and anchors for navigation. Do not make informational cards or table rows appear actionable unless they have a real action.

## Admin information architecture

Design a desktop-first but fully responsive admin shell with a persistent navigation rail/sidebar and a clear top context area. Proposed navigation for the visual design:

1. Dashboard
2. Services
3. Projects
4. Media Library
5. Site Content (Home, About Us, Contact, Business Details, SEO)
6. Publishing History

Keep navigation compact, labels clear, and selected section obvious. Show the Rajarata Engineering brand mark/name, authenticated administrator identity, and a clear Sign out action. Do not add customer-facing marketing navigation to the admin shell.

### Shared admin shell

- **Desktop:** left navigation rail approximately 248–272px wide; main content fills remaining width with a comfortable 24px+ gutter. Use a consistent top bar for page title/context, breadcrumbs where they aid orientation, and administrator menu.
- **Tablet:** collapsible navigation drawer or compact rail; preserve visible page context and avoid overlapping the editor.
- **Mobile:** navigation becomes a drawer opened by a labeled control. Tables transform into stacked record cards or an explicitly scrollable data region; editor actions remain reachable.
- Use a light `background` canvas, `surface-container-lowest` panels, `surface-container-low` grouping, neutral hairline borders, and selective `inverse-surface` navigation if useful.
- Keep global publish status easy to find but do not use an alarming persistent banner when there is no issue.
- A persistent or sticky footer/action bar may be used on long editing screens, with safe spacing so it never covers form controls.

## Required screens and UI components

### 1. Admin login

Create a focused, minimal sign-in screen that feels trustworthy and on-brand:

- Rajarata Engineering mark/name and a clear “Admin sign in” heading.
- Email and password fields with associated labels, visible focus, and password visibility control with an accessible name.
- Primary “Sign in” action; show submitting, invalid credentials, network error, and disabled states.
- Provide password reset only if the authentication flow supports it; do not visually promise a nonexistent flow.
- No self-service public registration. Admin accounts are provisioned by an authorized process.
- Use a centered white form card on a neutral `background`, a restrained red brand accent, and no invented security seals or guarantees.
- Make errors actionable and associated with the relevant input; do not leak whether an email address belongs to an account.

### 2. Admin dashboard

The dashboard should answer: “What content needs attention, and what is live?”

- Page heading and short supporting context.
- Compact overview cards for counts/status only when backed by real data (e.g., published services, published projects, drafts awaiting review). Do not fabricate metric values.
- “Needs attention” section for unpublished drafts, missing/invalid media, or failed publication.
- Latest publishing activity list with content snapshot/version label, actor, timestamp, result, and a safe detail link.
- Current live release panel showing publish time, release/snapshot identifier, and available preview/rollback actions.
- A primary “Create content” or “Add service/project” control may appear only where supported by the eventual product scope.
- Provide useful empty, loading, partial-data, and error states. Empty state copy should guide the administrator without making business claims.

### 3. Services list

Create a manageable tabular list with:

- Search by service name and optional category filter.
- Columns: service name/identifier, category, publication state, last updated, and row actions.
- Draft/published/archived status with text labels and distinct, subtle status colors.
- Row actions such as Edit, Preview, Publish, Archive only when permitted and implemented. Avoid destructive delete as the default.
- Sorting, pagination or clear “showing items” context when item volume requires it.
- Empty and no-search-results states with a relevant next action.
- On mobile, stack each record into a card with title, status, updated date, and a visible actions menu.
- Stable service identifiers should be represented as read-only technical metadata if they anchor public links.

### 4. Projects list

Use the Services-list interaction and styling pattern so administrators do not have to relearn controls. Include:

- Search by project title/reference and filters for category and publication state.
- Columns: thumbnail, project title/reference, category/type, publication state, last updated, and row actions.
- Missing image fallback thumbnail that preserves the card dimensions and clearly marks the asset as unavailable.
- Project year/location/client details only if approved and provided; show no fabricated portfolio facts.
- Allow archive/restore semantics. Do not present permanent media deletion as an ordinary row action.
- Responsive stacked card treatment on narrow viewports.

### 5. Content editor and forms

Use clear sections with a single page heading, record status, and a logical reading order. Group related fields inside white cards or neutral containers rather than a long, undifferentiated form.

Common controls:

- Title/name, stable slug or identifier (read-only after creation unless explicitly supported), summary, body copy, category, ordering, alt text, and publication metadata as applicable.
- Required/optional markers, helper text, character count only where there is a real limit, and inline validation next to the field.
- Multi-line rich text may offer a constrained toolbar (bold, italic, lists, headings, links from an allow-list) only if the CMS supports it. Do not allow arbitrary HTML, scripts, embedded third-party content, or unsafe URL schemes.
- Preserve semantic heading order and provide clear field labels; placeholders supplement labels, never replace them.
- Provide unsaved-changes state and confirm before leaving if edits would be lost.
- Distinguish “Save draft” from “Publish”; saving a draft must not change the public site.
- Show last saved time and whether there are unsaved local changes when that state is available.

Service editor fields:

- Service name and stable ID.
- Short card summary and detailed description.
- Category, scope of work, “suitable for” items, display order.
- Approved image/icon selection and descriptive alt text.
- SEO title/description if included in the approved CMS model.

Project editor fields:

- Project title/reference, type/category, summary, detailed description/specification.
- Image, alt text, caption, and image crop/focal point only if the asset system supports it.
- Location/year/client labels only from verified business data.
- Display order and featured status if included in scope.
- SEO title/description if included in the approved CMS model.

For Home, About, Contact, Business Details, and SEO editors, reuse the same field, validation, status, and preview patterns. Keep allowed route destinations code-controlled rather than editable free-form links.

### 6. Image upload and media selection

Design an accessible upload/drop zone and an asset picker that works without drag-and-drop:

- Dashed or hairline outline in a neutral surface; upload icon, concise instruction, and a keyboard-accessible “Choose file” control.
- State accepted image formats and maximum file size only when those constraints are defined by the product.
- Show upload progress, success, retryable failure, invalid format/size feedback, and cancellation where supported.
- Preview the selected image with a deterministic aspect ratio and contained/cropped display. Preserve image dimensions in the layout to avoid visual shift.
- Provide descriptive alt-text input with helper text and validation; do not auto-use filenames as final alt text without review.
- If no image exists or loading fails, use a neutral branded placeholder preserving the same geometry, with an explicit “No image”/“Preview unavailable” label.
- Existing assets should show thumbnail, filename/description, usage context if known, and archive state. Avoid exposing private draft assets publicly.
- Warn before replacing a media asset that is referenced by published or previous snapshots. Prefer archive/soft delete to permanent deletion.

### 7. Draft preview

- Provide a clearly labeled “Preview draft” action from the editor and draft state.
- Preview should use the public page’s real component layout, typography, tokens, and responsive behavior, with the draft content substituted.
- Make preview private and authenticated; it must not be anonymously accessible or indexable. A robots directive alone is not access control.
- Show a persistent “Draft preview — not published” banner and an obvious return-to-editor action.
- Support desktop and mobile preview sizing. Do not simulate a public live page if the system has not loaded the preview successfully.
- Show validation issues and missing-media fallbacks before an administrator can proceed to publish.

### 8. Publish, deployment status, and rollback

Publishing changes the public build; it is a consequential action. The UI must explain the change and never imply immediate success without confirmed deployment.

- Separate “Save draft”, “Preview draft”, and “Publish” actions visually and semantically.
- Before publish, summarize which content is included in the release and identify blocking validation errors. Use an explicit confirmation dialog for the final publish action.
- After authorization, show a persistent status sequence such as **Queued → Building → Deploying → Live** or **Failed**. Use plain labels and timestamps, not color alone.
- Explain that publication typically takes **2–5 minutes**; show elapsed time and actual status without promising a fixed SLA.
- Keep the previous public release active if build or deploy fails. Show an actionable error and retry option only when safe.
- Once live, display the deployed snapshot/release identifier, completion time, and link/action to view the public site.
- Publishing history should identify release/snapshot, included content scope, publishing administrator, started/completed time, status, and available rollback action.
- Rollback must require explicit confirmation, identify the snapshot that will be restored, and clearly distinguish rollback-in-progress from rollback-complete.
- Do not overwrite or discard prior snapshots or media needed for rollback.

## UX and accessibility requirements

- Use semantic landmarks, one clear `h1` per screen, correctly nested headings, labeled controls, and meaningful button/link text.
- All flows must be keyboard operable: navigation, dialogs, tables, upload selection, editors, preview, publish, and rollback. Focus order must follow visual order.
- Focus indicator is always visible for keyboard navigation. Do not rely on color or hover to reveal available actions.
- Meet WCAG 2.2 AA contrast for text and controls. Validate text on `on-surface-variant`, outline, and status combinations; token presence alone does not guarantee sufficient contrast at small sizes.
- Associate inline errors/help with fields using accessible descriptions and announce asynchronous save/publish state through an appropriate live region.
- Use text plus icon/status label for Draft, Published, Archived, Building, Failed, and Rollback states.
- Provide clear loading, empty, error, success, and disabled states for every asynchronous action.
- Destructive actions must be clearly named, separated from routine actions, and confirmed. Prefer archive over delete.
- Avoid broad catches that turn failed saves or deployments into success-shaped UI. Make errors recoverable and visible.
- Respect reduced-motion preferences. Avoid auto-moving carousels, pulsing status indicators, and unnecessary animations.
- Support zoom and reflow on narrow viewports; no essential workflow should require a wide desktop.

## Responsive behavior

- **Wide desktop (≥1280px):** sidebar plus 12-column content grid; tables may use full density; editor may use a main column plus a narrow validation/status rail.
- **Tablet (768–1279px):** collapsible navigation, reduced table columns where secondary values move into record detail, editor becomes one column or a flexible main-plus-context layout.
- **Mobile (<768px):** single-column content, 16px outer gutters, compact header/drawer, forms in one column, large touch targets (at least 44px), tables become record cards or clearly labeled horizontal-scroll regions, sticky publish actions must not obscure content.
- Breakpoints above are design guidance; validate actual layout at intermediate widths, not only at these exact thresholds.
- Maintain the same surface roles, typography tokens, and interaction semantics at every size.

## Stitch AI generation guidance

Generate coherent screens that can be translated into the existing Astro + Tailwind CSS 4 project. Do not choose or introduce a different application framework, visual system, or database.

Recommended Stitch screen set:

1. Admin sign-in.
2. Dashboard with realistic structural placeholders, not fabricated company metrics.
3. Services list and Projects list, including search/filter and status states.
4. Service editor and Project editor with grouped fields.
5. Media upload/asset picker including empty, upload-progress, failed, and fallback-preview states.
6. Private draft preview with the “not published” banner.
7. Publish confirmation, build/deploy progress, failure, success, publishing history, and rollback confirmation/status.

Copy/paste prompt for Stitch:

> Design the Rajarata Engineering CMS Admin UI as a polished, responsive engineering operations console. Match the existing public website exactly: high-contrast corporate modernism, Plus Jakarta Sans, Material Symbols Outlined, Tailwind CSS 4 semantic tokens, light neutral surface containers, white cards with crisp 1px hairlines, 18px card radius, 12px controls, 6px status chips, shallow shadows, and restrained primary red (#D32F2F / #AF101A). Use dark inverse-surface (#303030) only for a selective navigation region or emphasis. Do not add a new palette, purple gradients, glassmorphism, glow, ambient blur, playful motion, or generic SaaS decoration. Create admin login, dashboard, Services and Projects tables, grouped content editors, accessible image upload with fallback preview, private draft preview, publish confirmation, build/deploy progress states, failure feedback, publishing history, and snapshot rollback. Public publishing uses a static Astro build deployed to Firebase Hosting, not runtime page rendering. Target typical go-live in 2–5 minutes but show actual status and do not guarantee it. Draft previews must be private and clearly labeled not published. Keep all actions, statuses, forms, focus states, and empty/loading/error/success states explicit and keyboard accessible. Use realistic structure but no invented company metrics, client names, certifications, project facts, or contact details. Make mobile layouts fully usable: navigation drawer, stacked records, one-column forms, 44px+ touch targets, and reachable publish actions. Generate visuals only; do not invent backend behavior or allow arbitrary HTML/scripts/URLs.

Review every generated frame against this specification and the current public-site components before implementation. Stitch output is a visual starting point; implement screens using the project’s Astro and Tailwind conventions, accessible semantics, and approved Firebase architecture.
