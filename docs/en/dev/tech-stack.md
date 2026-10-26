# Tech Stack

This page records the technologies, layout, and scripts used by the current frontend. See [Frontend Architecture](./frontend-architecture) for module boundaries.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm (the repository commits `package-lock.json`)

```bash
npm install
npm run dev
```

`npm run dev` starts both the SPA (5173) and docs site (5174). Use `npm run dev:app` for the application only.

## Core Dependencies

| Area | Current implementation |
|---|---|
| Application | Vue 3, TypeScript, Pinia, Vue Router |
| Build and styling | Vite 7, Tailwind CSS 4, DaisyUI 5 |
| Icons | Iconify with build-time offline subsets of `heroicons`, `simple-icons`, and `lucide` |
| Charts | ECharts, `vue3-calendar-heatmap` |
| HTTP | Axios |
| i18n | `vue-i18n` (Composition mode); locale messages split into per-namespace JSON files and lazy-loaded with routes; `@intlify/unplugin-vue-i18n` build optimization; `@intlify/eslint-plugin-vue-i18n` for missing/unused key checks |
| Upload | `hash-wasm` for MD5, `@zip.js/zip.js` for ZIP64, and `ali-oss` multipart upload |
| Zarr | In-repository Zarr v3/OSS Range reader with `zstddec`; supports MassFlow layouts 1.0 and 1.1 |
| PubChem | Compound lookup for annotation rows |
| Clustering | Backend-generated UMAP; browser-side KMeans using `ml-kmeans` over the UMAP embedding |
| Annotation | No third-party dependencies: element and adduct mass tables live in `src/shared/chem`; feature matching, scoring (mass / adduct fit / spatial: METASPACE chaos plus same-molecule co-localization) and target-decoy FDR run in the browser (worker) |
| Other | `i18n-iso-countries` for country/region data |
| Docs and tests | VitePress, Vitest, Playwright |
| Quality | ESLint 9 flat config, Prettier |

<!-- AI assistant temporarily hidden from users; restore this row into the table above when re-enabling:
| AI assistant | `cordis` agent runtime (tool loop, skills, SSE adapter); chat view built on `@tdesign-vue-next/chat` |
-->

The project does not use `zarrita` or `crypto-js`. Password form values are sent over HTTPS; access-token storage and session state live under `src/shared/auth` and use `localStorage`.

Use root `package.json` and `package-lock.json` for exact versions.

## Source Layout

```text
src/
├── app/                  # Application shell and global entry components
├── assets/               # Theme and global styles
├── features/             # Business modules: auth, collections, datasets, home, upload, users, vizworkbench, workspace
├── i18n/                 # vue-i18n instance, type definitions, and locales/{locale}/{ns}.json message files
├── router/               # Routes and guards
├── services/             # Cross-module Zarr (with OSS client), clustering, and PubChem services
├── shared/               # HTTP, auth, directives, generic components/composables/config/types
├── views/                # Route pages that compose features
└── workers/              # Upload ZIP/MD5 worker
```

<!-- The `assistant` (AI assistant) module still exists in the source; it is temporarily hidden from users and therefore omitted from the list above. Restore it when re-enabling. -->

The vizworkbench feature also owns the annotation CSV and KMeans workers under `src/features/vizworkbench/utils/`. Feature-specific workers stay close to their owner rather than all living under root `workers/`.

## Common Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start SPA and docs in parallel |
| `npm run dev:app` | Start the SPA only |
| `npm run build` | Run type checking and the Vite production build in parallel; output `dist/` |
| `npm run preview` | Preview the SPA production build |
| `npm run type-check` | Vue/TypeScript type checking |
| `npm run lint` / `lint:check` | ESLint with fixes / check only |
| `npm run format` / `format:check` | Format/check `src/` only |
| `npm run test:unit` / `test:unit:run` | Vitest watch / one-shot run |
| `npm run test:e2e` | Playwright E2E |
| `npm run check` | Type check, lint, and unit tests in parallel |
| `npm run icons:bundle` | Regenerate the offline icon bundle |
| `npm run docs:dev` / `docs:build` / `docs:preview` | Develop, build, or preview docs |
| `npm run docs:type-check` | Type-check VitePress config and theme code |

## Configuration and Deployment

- Vite environment files live under `env/`. Use `env/.env.development.local` for local overrides. Runtime business configuration comes from `public/config.json` and is loaded before the app mounts.
- `config.json` controls app-wide settings: application name, navigation and floating action button, pagination, verification, and Zarr read tuning. <!-- AI assistant temporarily hidden from users; restore by removing this comment: The AI assistant has no dedicated switch: its floating-button `toggle-ai` entry follows the regular `active` / `requireAuth` flags and is currently enabled for signed-in users. Chat needs either deployment LLM credentials (`VITE_LLM_PROXY_URL` / `VITE_LLM_API_KEY`) or a user-supplied BYOK configuration; with neither, the assistant panel opens straight into its settings. -->
- Home page content (hero copy, feature showcase, timeline, team, contact details, commit heatmap) lives in `public/content.json`. The `/` route fetches it in parallel with the home chunk, so its size never sits on the app-wide startup path. If it cannot be loaded the home page simply omits those sections; other routes are unaffected.
- Upload form vocabularies and ion-source requirement rules are no longer JSON. They are compiled into the bundle (`datasetMetadata.ts` / `ionSourceRules.ts`), ship inside long-cached route chunks, and require a rebuild to change.
- The `test`-branch workflow runs `npm run check`, the docs build, and Chromium/Firefox/WebKit E2E.
- Pushes to `dev` and `main` trigger their deployment workflows. The multi-stage Docker build creates both `dist/` and `dist-docs/`; Nginx serves the docs at `/docs/`.

Whether configuration values are committed is a repository-policy choice. Anything exposed through frontend `VITE_*` variables, `public/config.json`, or `public/content.json` is delivered to the browser and is not a server-side secret.
