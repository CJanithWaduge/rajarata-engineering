# Rajarata Engineering

Rajarata Engineering's public marketing pages are statically generated. The CMS Admin UI is served dynamically by an Astro server runtime and protected by Firebase Authentication session-cookie verification.

## Frontend stack

- [Astro](https://astro.build/) with static public pages and a Node.js SSR runtime for `/admin/**`
- [Tailwind CSS 4](https://tailwindcss.com/) through `@tailwindcss/vite`
- TypeScript for shared browser-side behavior
- Firebase Hosting serves public files from `dist/client/` and rewrites `/admin/**` to Cloud Run

The site is built from Astro pages and components; it does not use a client-side UI framework.

## Requirements

- Node.js 22.12 or newer
- npm
- Java 21 or newer to run the Firebase Emulator Suite rules tests

## Run locally

Install the locked dependencies and start Astro's development server:

```sh
npm ci
npm run dev
```

Open the local URL printed by Astro (normally `http://localhost:4321`).

Available scripts:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run check` | Run Astro and TypeScript diagnostics |
| `npm run build` | Build public pages into `dist/client/` and the SSR app into `dist/server/` |
| `npm run preview` | Preview the generated application locally |
| `npm run test:content` | Test content schema validation and legacy-settings migration |
| `npm run test:rules` | Test Firestore and Storage rules with local emulators (requires Java 21+) |
| `npm run test:phase14` | Build, test content schemas, and run Firestore/Storage plus draft-repository emulator tests |
| `npm run test:phase15` | Check/build and run schema, Storage rules, and media repository emulator tests |
| `npm run test:preview` | Run protected-preview integration tests with local Auth, Firestore, and Storage emulators |
| `npm run test:phase16` | Check/build and test protected draft preview, Auth/Firestore/Storage emulators, and public-output isolation |
| `npm run test:phase19` | Check/build and test WhatsApp number validation and `wa.me` link generation |

## Pages

| URL | Page source |
| --- | --- |
| `/` | `src/pages/index.astro` |
| `/services` | `src/pages/services.astro` |
| `/about-us` | `src/pages/about-us.astro` |
| `/projects` | `src/pages/projects.astro` |
| `/contact` | `src/pages/contact.astro` |

Each page assembles its sections from `src/components/` and uses the shared layout, header, and footer.

## Frontend structure

```text
src/
  pages/                 # Astro routes
  layouts/Base.astro     # Shared document head, fonts, global styles and scripts
  components/
    ui/                  # Reusable button, card, chip and field components
    home/                # Home page sections
    services/            # Services page sections
    about/               # About Us page sections
    projects/            # Projects page sections
    contact/             # Contact page sections
  lib/
    cardTilt.ts          # Progressive card pointer interaction
    scrollReveal.ts      # Viewport reveal and replay behavior
    firebaseClient.ts    # Browser Firebase Auth initialization
    firebaseAdmin.ts     # Server-side Firebase Admin SDK initialization
    adminSession.ts      # Session cookie, CSRF, and private response helpers
    adminBrowserSession.ts # Browser session and sign-out requests
  middleware.ts          # Server-side Admin route authorization
  styles/global.css      # Tailwind import, design tokens and shared component styles
public/                  # Static assets served from the site root
storage.rules            # Published-media and draft-media access policy
tests/firebase-rules.test.mjs # Firestore and Storage emulator tests
```

## Styling and design

The approved design reference is `UI-UX-design/precision_industrial_engineering/DESIGN.md`, with page-specific prototypes under `UI-UX-design/`. The shared palette, typography, radii, shadows, and interaction styles are defined in `src/styles/global.css` in Tailwind 4's CSS-first `@theme` block.

Keep page styling in Tailwind utility classes and shared styles in `global.css`. Do not add a `tailwind.config.js`; this project uses Tailwind 4 and the Vite plugin configured in `astro.config.mjs`.

Scroll reveals and card interactions are initialized by `src/layouts/Base.astro`. Reveals replay as elements leave and re-enter the viewport. Motion respects `prefers-reduced-motion`; without JavaScript, page content remains visible.

## Firebase and Admin authentication

Public pages do not make runtime Firestore reads. Footer details are rendered into the static build; CMS-managed public content will be supplied by the approved build-and-deploy pipeline.

To exercise Firebase Auth locally:

1. Copy `.env.example` to `.env`.
2. Set the non-secret Firebase Web App values `PUBLIC_FIREBASE_PROJECT_ID` and `PUBLIC_FIREBASE_API_KEY`.
3. Start the Auth and Firestore emulators with project `demo-rajarata-engineering`; the Admin draft API refuses to operate unless Firestore is running at `FIRESTORE_EMULATOR_HOST` and `FIREBASE_PROJECT_ID` starts with `demo-`.

Server-side Admin SDK access uses Application Default Credentials; never put service-account keys or other server credentials in frontend variables or committed files. The Admin service also requires `FIREBASE_PROJECT_ID` and, in production, `ADMIN_PUBLIC_ORIGINS`.

`firebase.json` configures the Firestore, Storage, Auth, and Hosting emulators plus the staging Hosting rewrite. The selected staging project is `rajarata-engineering-developer`, with the Admin SSR service planned for Cloud Run in `asia-south1`. No staging resources have been deployed. Admin claim grants remain disabled until two custodian UIDs are designated in `src/config/admin-custodians.json`.

Phase 14 draft writes are server-side, version-checked, and emulator-only. Firestore client rules allow admins to read draft documents but deny client writes; the Admin SSR API validates content and uses the Admin SDK against the local demo project. Saving drafts does not change the public static build. Run `npm run test:phase14` to execute the build, schema tests, rules tests, repository tests, and public-output draft-leak check (requires Java 21+).

Phase 15 media uploads are served through the verified Admin SSR session and restricted to local Firebase emulators until Phase 13 staging verification is complete. JPEG, PNG, and WebP files are limited to 10 MiB; alt text is required. Replacing an asset creates a new draft object, and archive/restore only changes metadata—there is no permanent-delete action. Admin image previews are served privately; only the published Storage prefix is public.

Phase 16 `/admin/preview` is rendered on demand from saved draft content, media, and SEO metadata. It is protected by the same verified session-cookie and Admin-claim middleware as the editors. The preview's validation rail links issues to editable fields, and referenced draft images are served only through the protected Admin media endpoint. The preview does not include unsaved editor changes, publish content, or alter the static site. Run `npm run test:phase16` (Java 21+) to verify the SSR access boundary, no-store/noindex responses, media access, emulator data, and absence of Admin HTML from `dist/client/`.

## Contact inquiries (Phase 18)

The public quotation form calls the `submitContactInquiry` Firebase callable in `asia-south1`. The function enforces App Check, validates and bounds every field server-side, requires the inquiry consent flag, rejects a filled honeypot, limits each source address to five requests per 15 minutes, and sends a plain-text email through configurable SMTP. Inquiry bodies are not written to Firestore or logged. Only an HMAC of the source address and the rate counter are stored in `contactRateLimits`; Firestore TTL is configured to expire those records after 24 hours.

`functions/.env.example` contains reserved `.invalid` sample addresses and localhost SMTP settings. It is not a real mail configuration. Before enabling delivery, register the Firebase Web App with App Check, set `PUBLIC_FIREBASE_APPCHECK_SITE_KEY` and the Functions emulator address for local testing, configure `CONTACT_SMTP_HOST`, `CONTACT_SMTP_PORT`, `CONTACT_SMTP_SECURE`, `CONTACT_SENDER`, and `CONTACT_RECIPIENT`, and provide `CONTACT_SMTP_USER`, `CONTACT_SMTP_PASSWORD`, and a random `CONTACT_RATE_LIMIT_SALT` using Firebase Functions secrets. Secret values must never be placed in browser variables or committed files. The caller owns the recipient, provider account, and retention/consent review. Run `npm run test:contact` for validation, abuse-limit, and delivery-failure tests; `npm run test:phase18` runs the full local gate. No function or secret is deployed by these commands.

## WhatsApp contact link (Phase 19)

Set the optional public build variable `PUBLIC_WHATSAPP_NUMBER` to the business number in international format using digits only, including its country code (for example, `94771234567`). The static Contact page and footer render the clickable number as a `https://wa.me/` link only when the value is valid; blank or invalid values do not produce a link. Since it is a `PUBLIC_*` value, it is included in the public site output and must not contain anything private. The Admin Business Details WhatsApp field remains a draft; it is not connected to the public build until the publishing pipeline is implemented. Run `npm run test:phase19` for checks, build, and number/link validation tests.

## Build and hosting

Run the checks and generate the static production output:

```sh
npm run check
npm run build
```

Astro writes public static files to `dist/client/` and the Admin server runtime to `dist/server/`. Hosting serves only `dist/client/` and rewrites `/admin/**` to Cloud Run; the server runtime must be deployed separately. Deployment is not performed by these commands.

Before deploying the Admin service from source with `gcloud run deploy --source .`, run `npm run build`. The checked-in `.gcloudignore` keeps the generated `dist/` output in the upload while excluding local environment files and dependencies.

## Before launch

Some page copy and metadata still contain `[REPLACE: ...]` placeholders, and some prototype images use temporary Google-hosted URLs. Replace these with approved company content and durable assets before publishing. Do not invent company credentials, client names, project metrics, or other business facts.
