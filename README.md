# Rajarata Engineering

Static marketing website for an electrical engineering and contracting company, covering MV/LV distribution, industrial installations, testing and commissioning, and ELV/automation.

## Frontend stack

- [Astro](https://astro.build/) with static site generation
- [Tailwind CSS 4](https://tailwindcss.com/) through `@tailwindcss/vite`
- TypeScript for shared browser-side behavior
- Firebase Hosting serves the generated `dist/` directory

The site is built from Astro pages and components; it does not use a client-side UI framework.

## Requirements

- Node.js 22.12 or newer
- npm

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
| `npm run build` | Build the static site into `dist/` |
| `npm run preview` | Preview the generated production build locally |

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
    siteSettings.ts      # Optional runtime footer settings from Firestore
  styles/global.css      # Tailwind import, design tokens and shared component styles
public/                  # Static assets served from the site root
```

## Styling and design

The approved design reference is `UI-UX-design/precision_industrial_engineering/DESIGN.md`, with page-specific prototypes under `UI-UX-design/`. The shared palette, typography, radii, shadows, and interaction styles are defined in `src/styles/global.css` in Tailwind 4's CSS-first `@theme` block.

Keep page styling in Tailwind utility classes and shared styles in `global.css`. Do not add a `tailwind.config.js`; this project uses Tailwind 4 and the Vite plugin configured in `astro.config.mjs`.

Scroll reveals and card interactions are initialized by `src/layouts/Base.astro`. Reveals replay as elements leave and re-enter the viewport. Motion respects `prefers-reduced-motion`; without JavaScript, page content remains visible.

## Optional Firebase footer settings

The footer can fetch public business contact details from the Firestore document `siteSettings/public` at runtime. If no configuration is supplied, the build-time values in `src/lib/siteSettings.ts` remain in place.

To enable the Firestore read locally:

1. Copy `.env.example` to `.env`.
2. Set `PUBLIC_FIREBASE_PROJECT_ID` and `PUBLIC_FIREBASE_API_KEY` to the Firebase web app values.
3. Ensure Firestore rules permit public reads of `siteSettings/public`.

These `PUBLIC_` values are included in browser code; they are not secrets. Do not put Firebase Admin credentials, service-account keys, or mail-provider credentials in frontend environment variables. Server-side access control belongs in Firebase rules and Cloud Functions.

## Build and hosting

Run the checks and generate the static production output:

```sh
npm run check
npm run build
```

Astro writes the site to `dist/`, the intended Firebase Hosting publish directory. Deployment is not performed by these commands.

## Before launch

Some page copy and metadata still contain `[REPLACE: ...]` placeholders, and some prototype images use temporary Google-hosted URLs. Replace these with approved company content and durable assets before publishing. Do not invent company credentials, client names, project metrics, or other business facts.
