# Tech Stack

This page records the technologies, layout, and scripts used by the current frontend. See [Frontend Architecture](./frontend-architecture) for module boundaries, [Agent Architecture](./agent-architecture) for the assistant, and [Testing and E2E](./testing) for verification.

## Requirements

- Node.js `>=22.12.0`
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
| Icons | Iconify with build-time offline subsets of `heroicons`, `simple-icons`, and `lucide`; the SXO-Harness interface uses `@lucide/vue` |
| Charts | ECharts, `vue3-calendar-heatmap` |
| HTTP | Axios |
| i18n | `vue-i18n` (Composition mode); locale messages split into per-namespace JSON files and lazy-loaded with routes; `@intlify/unplugin-vue-i18n` build optimization; `@intlify/eslint-plugin-vue-i18n` for missing/unused key checks |
| Upload | `hash-wasm` for MD5, `@zip.js/zip.js` for ZIP64, and `ali-oss` multipart upload |
| Zarr | In-repository Zarr v3/OSS reader (whole objects, no Range requests) with `zstddec`; supports MassFlow layouts 1.0 and 1.1 |
| PubChem | Compound lookup for annotation rows |
| Clustering | Backend-generated UMAP; browser-side KMeans using `ml-kmeans` over the UMAP embedding |
| Annotation | No third-party dependencies: element and adduct mass tables live in `src/shared/chem`; feature matching, scoring (mass / adduct fit / spatial: METASPACE chaos plus same-molecule co-localization) and target-decoy FDR run in the browser (worker) |
| Other | `i18n-iso-countries` for country/region data |
| Docs and tests | VitePress, Vitest, Playwright |
| Quality | ESLint 9 flat config, Prettier |
| SXO-Harness | `@deepseek-ai/cordis` plugin runtime (tool loop, skills, connection and model management); model access: AI SDK (`ai`, `@ai-sdk/anthropic`) over `/v1/messages`, using only models that pass a multimodal test; conversations and images persist in browser OPFS and export as ZIP (`fflate` loaded on demand); web search goes through Exa's hosted MCP; UI: shadcn-vue AI Elements (`reka-ui`, `@comark/vue`, `shiki`; formulas load `katex` on demand) |

The project does not use `zarrita` or `crypto-js`. Password form values are sent over HTTPS; access-token storage and session state live under `src/shared/auth` and use `localStorage`.

Use root `package.json` and `package-lock.json` for exact versions.

## Source Layout

```text
src/
├── app/                  # Application shell and global entry components
├── assets/               # Theme and global styles
├── features/             # Business modules: agent, auth, collections, databases, datasets, home, upload, users, vizworkbench, workspace
├── i18n/                 # vue-i18n instance, type definitions, and locales/{locale}/{ns}.json message files
├── router/               # Routes and guards
├── services/             # Cross-module Zarr (with OSS client), clustering, and PubChem services
├── shared/               # HTTP, auth, directives, generic components/composables/config/types
├── views/                # Route pages that compose features
└── workers/              # Upload ZIP/MD5 worker
```

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
| `npm run test:e2e` | Default Playwright projects (no WebKit); live projects require an account |
| `npm run test:e2e:offline` | Fixed-response regression in Chromium and Firefox without backend credentials |
| `npm run check` | Type check, lint, and unit tests in parallel |
| `npm run icons:bundle` | Regenerate the offline icon bundle |
| `npm run docs:dev` / `docs:build` / `docs:preview` | Develop, build, or preview docs |
| `npm run docs:type-check` | Type-check VitePress config and theme code |

## Configuration and Deployment

- Vite environment files live under `env/`. Use `env/.env.development.local` for local overrides. Runtime business configuration comes from `public/config.json` and is loaded before the app mounts.
- `config.json` controls app-wide settings: application name, navigation and floating action button, pagination, verification, and Zarr read tuning. SXO-Harness has no dedicated switch: its floating-button `toggle-ai` entry follows the regular `active` / `requireAuth` flags and is currently enabled for signed-in users. Chat needs an endpoint that offers `/v1/messages`: either the deployment default (`VITE_LLM_PROXY_URL` / `VITE_LLM_API_KEY` / `VITE_LLM_MODEL`), or an address and key entered in the connection settings plus a model that passes the multimodal test. With neither, the panel opens straight into its connection settings. Web search uses Exa's hosted MCP; the optional `VITE_EXA_API_KEY` raises its allowance, and an empty value falls back to the anonymous tier. Both `VITE_LLM_API_KEY` and `VITE_EXA_API_KEY` are compiled into the frontend bundle, so only put restricted sub-keys there, never official master keys.
- Home page content (hero copy, feature showcase, timeline, team, contact details, commit heatmap) lives in `public/content.json`. The `/` route fetches it in parallel with the home chunk, so its size never sits on the app-wide startup path. If it cannot be loaded the home page simply omits those sections; other routes are unaffected.
- SXO-Harness KEGG tools request the same-origin `/kegg-rest/` path, which Vite (development and `vite preview`) or nginx (Docker deployment) forwards to `https://rest.kegg.jp/`; custom hosting needs the same forwarding. The HMDB tool reads `public/data/hmdb-index.json`, an index that is not committed; generate it as described in the header of `scripts/build-hmdb-index.mjs`.
- Upload form vocabularies and ion-source requirement rules are no longer JSON. They are compiled into the bundle (`datasetMetadata.ts` / `ionSourceRules.ts`), ship inside long-cached route chunks, and require a rebuild to change.
- The `test`-branch workflow runs `npm run check` and builds docs, then runs E2E in Chromium and Firefox: secret-free offline regression, account-based live integration, and Chinese smoke coverage.
- Pushes to `dev` and `main` trigger their deployment workflows. The multi-stage Docker build creates both `dist/` and `dist-docs/`; Nginx serves the docs at `/docs/`.

Whether configuration values are committed is a repository-policy choice. Anything exposed through frontend `VITE_*` variables, `public/config.json`, or `public/content.json` is delivered to the browser and is not a server-side secret.
