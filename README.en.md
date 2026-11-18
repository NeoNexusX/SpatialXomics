# SpatialXomics

English | [简体中文](README.md)

SpatialXomics is a web platform for mass spectrometry imaging (MSI) data management and analysis: imzML upload, public/private dataset management, configurable preprocessing, Zarr result visualization, annotation matching, ROIs and region comparison, plus the SXO-Harness assistant that answers questions about the dataset currently open in the visualization workspace.

This repository contains the frontend application (Vue 3 + TypeScript + Vite) and the VitePress documentation site. Authentication, data files, and compute jobs are served by a separately deployed backend that the frontend reaches through the same-origin `/api`; no backend code lives here.

## Main Features

- **Accounts and permissions**: registration, sign-in, password recovery, profiles, administrator user management, and protected routes.
- **Datasets**: browse public datasets, manage private ones, inspect metadata, share public overview pages through `public_id` or a share token, and download raw `.imzML` / `.ibd` pairs.
- **Collections**: curate related public datasets with academic metadata and an ordered member list, including a public share page.
- **Upload pipeline**: MD5 in a Web Worker, server-side duplicate checks, streamed ZIP64 compression, Alibaba Cloud OSS multipart upload with temporary STS credentials, and same-browser resume.
- **Analysis workspace**: compatible noise reduction, baseline correction, normalization, peak picking, and peak alignment choices based on spectrum/storage mode, plus analysis task management.
- **Result visualization**: Continuous ion images and mean spectra; Processed TIC images and per-pixel spectra; display range, gamma, colormap, and TIC normalization; JPG (default) or transparent PNG export.
- **Clustering and regions**: backend-generated UMAP plus browser-local KMeans, cluster filtering, rectangular/freehand ROIs, multi-region comparison, and mask import/export.
- **Annotations**: match Continuous + Centroid mean-spectrum peaks against an annotation database CSV, with ppm/Da tolerance, scores and FDR, filtering, export, and PubChem lookup; use a user-provided CSV or import the platform reference database in one click.
- **Reference databases**: browse the HMDB 4.0 metabolite reference library (backend `SI_DB` endpoint, with an origin column) after signing in — search by ID, name, or formula, filter by origin and mass range, open PubChem/HMDB entries, and download the full CSV.
- **News**: announcements and version updates with detail pages; items are Markdown compiled at build time and maintained per locale.
- **SXO-Harness assistant**: after signing in, open the floating chat panel from the home or visualization page. It reads ion images, statistics, annotations, clustering, and page state, can call PubChem, ChEBI, HMDB, KEGG, literature, and web-search tools, and renders external sources as citation cards. See [SXO-Harness assistant](#sxo-harness-assistant).

## Technology

| Area | Technology |
|---|---|
| Core | Vue 3, TypeScript, Vite 7, Pinia, Vue Router |
| UI | Tailwind CSS v4, DaisyUI v5, reka-ui, offline Iconify subsets |
| Visualization | ECharts, Canvas, vue3-calendar-heatmap |
| MSI / Zarr | Custom chunked Zarr v3 reader, zstddec, `@zip.js/zip.js`, hash-wasm, ml-kmeans |
| Network and storage | Axios, ali-oss with temporary STS credentials, OPFS for assistant sessions |
| SXO-Harness | @deepseek-ai/cordis, AI SDK (`@ai-sdk/anthropic`), comark, KaTeX, Shiki, Exa web search |
| Testing | Vitest, Playwright |
| Documentation | Bilingual VitePress site |

See [package.json](package.json) for exact versions.

## Layout

```text
src/
├── app/                         # App shell, navigation, global entry components
├── assets/                      # Styles and theme assets
├── features/                    # Business-domain modules
│   ├── agent/                   # SXO-Harness: runtime, plugins, floating panel
│   ├── auth/                    # Sign-in, registration, and recovery forms
│   ├── collections/             # Curated dataset collections with academic metadata
│   ├── databases/               # Reference database browser (HMDB 4.0 / SI_DB)
│   ├── datasets/                # Lists, details, sharing, and downloads
│   ├── home/                    # Home scenes, stats, and commit heatmap
│   ├── news/                    # Announcements and version updates (Markdown content)
│   ├── upload/                  # imzML parsing, compression, duplicate checks, resume
│   ├── users/                   # Administrator user management
│   ├── vizworkbench/            # Ion images, spectra, clustering, ROIs, annotations
│   └── workspace/               # Analysis builder and task dashboard
├── i18n/                        # vue-i18n instance and namespaced locale messages
├── router/                      # Routes and auth/admin guards
├── services/                    # Zarr (with OSS client), clustering, PubChem
├── shared/                      # Shared API, auth, components, config, utilities
├── views/                       # Route pages
└── workers/                     # Cross-feature workers (upload ZIP); feature workers stay with their feature

docs/                            # VitePress sources (zh/, en/)
e2e/                             # Playwright tests and offline fixtures
env/                             # Vite environment files (envDir points here)
public/config.json               # App-wide runtime configuration, editable after deployment
public/content.json              # Home page content (team, timeline, hero copy)
scripts/                         # Build, icon subset, production-config override scripts
docker/                          # Dockerfile, nginx template, container entrypoint
```

## Local Development

### Requirements

- Node.js `>=22.12.0` (see `engines` in `package.json`)
- npm (the repository commits `package-lock.json`)

### Install

```bash
npm ci
```

### Environment

`env/` is Vite's `envDir`; the repository already contains:

| File | Contents |
|---|---|
| `env/.env` | Values shared by all environments: `VITE_API_BASE`, `VITE_OSS_ENDPOINT` |
| `env/.env.development` | Dev proxy target `VITE_BACKEND_URL`, plus assistant defaults `VITE_LLM_PROXY_URL` / `VITE_LLM_MODEL` |
| `env/.env.production` | Production build/preview values; add `VITE_LLM_PROXY_URL`, `VITE_LLM_API_KEY`, `VITE_LLM_MODEL` for a deployment-wide default connection |
| `env/config.prod.overrides.json` | Overrides merged into `config.json` for production (see [Deployment](#deployment)) |

Put machine-specific overrides in the ignored `env/.env.development.local`:

```bash
VITE_BACKEND_URL=http://localhost:8000
```

When pointing at the test server's nginx, include `/api` (e.g. `https://sxo.neonexus.top/api`): the Vite proxy strips the browser's `/api` prefix and then prepends the target path. For a direct backend port, use the backend origin (e.g. `http://localhost:8000`).

`VITE_BACKEND_URL` only affects the development proxy; in the production container nginx forwards `/api/` to the runtime `BACKEND_HOST:BACKEND_PORT`. Assistant traffic is also relayed in development: the deployment default endpoint goes through `/llm-proxy`, while user-supplied endpoints go through `/llm-relay` with the target origin in the `x-llm-target` header, which keeps local proxy interference away from SSE streams.

Every `VITE_*` variable is compiled into the browser bundle: only put a restricted relay sub-key in `VITE_LLM_API_KEY`, and only a publishable Exa sub-key in `VITE_EXA_API_KEY`. Never place an official master key in either.

### Run

```bash
npm run dev       # SPA (5173) and docs (5174)
npm run dev:app   # SPA only
```

### Common Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `dev:app` | Start the development servers (SPA and docs) |
| `npm run build` | Type-check + SPA build to `dist/` |
| `npm run preview` | Preview the built `dist/` output locally |
| `npm run check` | Type-check + ESLint + unit tests (used in CI) |
| `npm run lint` / `lint:check` | ESLint with fixes / check only |
| `npm run format` / `format:check` | Prettier on `src/` / check only |
| `npm run test:unit` / `test:unit:run` | Vitest in watch mode / one-shot with coverage |
| `npm run test:e2e` / `test:e2e:offline` | Playwright against the live backend / offline regression |
| `npm run docs:dev` / `docs:build` / `docs:preview` | Docs dev server / build / preview |
| `npm run docs:type-check` | Type-check docs config and components |
| `npm run icons:bundle` | Regenerate the offline icon subset |

`npm run format` formats `src/` only; Markdown files are maintained separately.

## SXO-Harness Assistant

The assistant runs in the browser and answers analysis questions about the dataset currently open. It only reads existing data and results — it does not start preprocessing, modify annotations, or re-run clustering.

### Panel and Behavior

- Open it after signing in from pages with a navigation ball (home, visualization). The panel can be moved and resized; closing it neither destroys the runtime nor aborts a running turn.
- On a dataset page, a question captures the selected ion, pixel, clustering, and annotation weights at submit time as this turn's analysis context. Later page changes are not used by that turn.
- Sessions are stored per dataset in browser OPFS. A session open in another tab is read-only; when OPFS is unavailable the app falls back to in-memory sessions and warns that a refresh loses them.
- Oversized tool results are archived first (4,000 characters by default, 12,000 for evidence tools) and the model can read them back by offset. When context nears the window limit, older history is compacted while the UI keeps the original messages.

### Model Connection

- The assistant currently supports **Anthropic Messages** endpoints (`/v1/messages`) only; OpenAI Chat Completions and other protocols cannot be used directly.
- A user-supplied address and key are kept in local `localStorage` and never pass through the platform backend. User credentials and the deployment default are never mixed.
- The deployment default requires both `VITE_LLM_PROXY_URL` and `VITE_LLM_API_KEY`; the model comes from `VITE_LLM_MODEL` or the user's choice.
- "Fetch available models" lists the endpoint's models and sends each a small image to probe multimodal support; only models that pass can be saved. The context limit defaults to 256,000 tokens and is saved per endpoint and model.
- Session instructions accept `.md` / `.txt` files (such as `AGENTS.md`, up to 64 KiB) and are stored with the conversation and included in the system prompt.

### Tool Catalog

Tools are registered by Cordis plugins: 9 domains, 28 tools. Page tools page through a zero-based `offset` / `limit` rank window (default rank 1–10, page cap 25); the model continues with the returned `nextOffset`.

| Domain plugin | Tools | Purpose |
|---|---|---|
| `tool-page-context` | `get_page`, `get_dataset`, `get_ion`, `get_annotation`, `get_kmeans`, `get_umap`, `get_mean_spectrum_top_peaks`, `get_pixel_spectrum` | Page snapshot, dataset info, selected-ion view, annotation rows (window and exact modes), clustering and UMAP, spectrum peaks, pixel spectra |
| `tool-ion-image` | `get_ion_image` | Ion heatmaps for the selected ion, one or more m/z values, or annotation rowIds; up to 4 separate images, more as a montage |
| `tool-knowledge` | `pubchem_compound_lookup`, `pubchem_formula_search`, `chebi_lookup`, `hmdb_lookup` | Chemical identity checks; HMDB reads official records from Wayback-archived XML |
| `tool-kegg` | `kegg_find`, `kegg_compound`, `kegg_pathway`, `kegg_mass_search` | Live KEGG REST queries, no local index |
| `tool-literature` | `pubmed_search`, `europepmc_search`, `openalex_search` | Literature search |
| `tool-web-search` | `web_search` | Exa web search (anonymous allowance or `VITE_EXA_API_KEY`) |
| `tool-backend-api` | `list_files`, `list_my_files`, `get_file_metadata`, `list_my_processes`, `get_user_quota` | Files, jobs, and quota queries |
| `tool-archive` | `read_archived_result` | Read back a truncated archived result by offset |
| `tool-skill` | `skill` | Load a bundled skill's instructions on demand |

External queries use same-origin relays; custom hosting must provide them too:

| Path | Upstream | Limits |
|---|---|---|
| `/kegg-rest/` | `https://rest.kegg.jp/` | 3 requests/s shared across the site, `burst=10`, GET only |
| `/hmdb-archive/` | HMDB metabolite XML on `https://web.archive.org` | 2 requests/s, only path-safe `HMDB` accessions |

The KEGG client caches responses within a call, deduplicates batch queries, and chunks requests to the upstream 10-entry limit. The archive sends no browser CORS headers, so XML must come through `/hmdb-archive/`; when the relay fails the tool degrades to link-only output instead of inventing data.

### Bundled Skills

`src/features/agent/plugins/skill-bundled/skills/` holds 8 on-demand workflow instructions:

`msi-analysis`, `annotation-review`, `adduct-isotope-analysis`, `ion-image-interpretation`, `metabolite-biology`, `literature-evidence`, `web-research`, `report-writing`.

Skills are prompt-level workflows, not separate processes; the model reads a skill's body through the `skill` tool when needed.

## Runtime Configuration

- **`public/config.json`**: loaded before Vue mounts. It controls the app name and version, navigation mode, pagination, verification, carousel, Zarr read tuning, and OSS preview hosts; a missing or invalid file produces a startup error page.
- **`public/content.json`**: home page content (hero copy, feature showcase, timeline, team, contact details, commit heatmap), fetched only when the home route is entered; if it cannot be loaded the home page omits those sections.
- **News content**: `src/features/news/content/<locale>/*.md`; file names start with the date and version updates end with `-v<version>`. These are compiled at build time, so new or edited items require a rebuild.
- Both `public/*.json` files can be edited on a deployed server and take effect on reload. Form dropdown vocabularies and ion-source requirement rules are compiled into the bundle (`src/features/datasets/constants/datasetMetadata.ts`, `src/features/upload/utils/ionSourceRules.ts`) and require a rebuild.
- Production-only differences live solely in `env/config.prod.overrides.json`; run `node scripts/apply-prod-config.mjs` before a production build to deep-merge it into `public/config.json` (objects merge recursively, arrays and scalars replace). Restore `public/config.json` if you run it locally.

## Testing

| Command | Scope |
|---|---|
| `npm run test:unit:run` | Vitest unit tests with coverage |
| `npm run test:e2e` | Default Playwright projects: Chromium, Firefox, and a Chinese smoke run; live backend needs `E2E_USERNAME` / `E2E_PASSWORD`, WebKit needs `E2E_WEBKIT=1` |
| `npm run test:e2e:offline` | `offline-chromium` + `offline-firefox` with offline fixtures; no account, backend, or model key required |

- Offline regression skips authentication setup; use `E2E_PORT=5193 npm run test:e2e:offline` for a dedicated port.
- Unit and behavior-lock tests cover session events, model requests, UI state, and system-prompt snapshots (`src/features/agent/__tests__/behaviorLock.test.ts`). `e2e/tools.offline.spec.ts` runs every assistant tool through the real plugin bundle and writes the exact text and images the model would see, for reviewing tool descriptions and output.
- CI (`.github/workflows/test.yml`) runs `npm run check`, `docs:type-check`, and `docs:build` on the `test` branch, then builds the SPA and runs Playwright. Pull requests from external forks cannot read secrets and therefore run only the offline group.

## Deployment

- `docker/Dockerfile` is a multi-stage build: `node:22-alpine` runs `npm ci`, `npm run build`, and `npm run docs:build`; `dist/` and `dist-docs/` are copied into an nginx image with the docs served under `/docs/`.
- `docker/entrypoint.sh` substitutes the runtime `BACKEND_HOST` / `BACKEND_PORT` (default `host.docker.internal:8000`) with `envsubst`, validates the configuration, and starts nginx; without the brotli module it falls back to `gzip_static`.
- nginx handles static-asset caching and precompressed `.gz` / `.br` files, the `/api/` reverse proxy (10 GB request body, 300 s timeouts), the `/kegg-rest/` and `/hmdb-archive/` relays, the Vue Router history fallback, and a separate fallback for the `/docs/` site.
- Production builds run `node scripts/apply-prod-config.mjs` first to merge production config overrides (`deploy-main.yml` already does this).
- Branch flow: `test` runs checks and tests; pushes to `dev` build an image tagged with the commit SHA and deploy to the development server; pushes to `main` build and deploy production with the `latest` tag.

## Documentation

- User and contributor docs live under `docs/` and are served locally at `http://localhost:5174/docs/`; nginx serves them at `/docs/` online.
- Maintenance workflow: [documentation maintenance](docs/en/dev/doc-maintenance.md) ([中文](docs/zh/dev/doc-maintenance.md)).
- Contributor references: [Frontend Architecture](docs/en/dev/frontend-architecture.md), [Agent Architecture](docs/en/dev/agent-architecture.md), [Testing and E2E](docs/en/dev/testing.md) ([中文](docs/zh/dev/frontend-architecture.md)).
- The user guide starts at [Getting Started](docs/en/guide/getting-started.md) and covers uploads, visualization, annotations, reference databases, and the assistant.
