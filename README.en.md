# SpatialXomics

English | [简体中文](README.md)

SpatialXomics is a web platform for mass spectrometry imaging (MSI) data management and analysis. The Vue 3, TypeScript, and Vite frontend supports imzML upload, public/private dataset management, configurable preprocessing, Zarr result visualization, annotation matching, ROIs, and region comparison.

## Main Features

- **Authentication and authorization**: sign-in, registration, password recovery, profiles, administrator user management, and protected routes.
- **Dataset management**: browse public datasets, manage personal datasets, inspect metadata, share public overview pages, and download raw `.imzML` / `.ibd` pairs.
- **Collections**: group related public datasets into curated collections with academic metadata and an ordered member list.
- **Upload pipeline**: MD5 in a Web Worker, server-side reuse checks, streamed ZIP64 compression, Alibaba Cloud OSS multipart upload, and same-browser resume.
- **Analysis workspace**: compatible noise reduction, baseline correction, normalization, peak picking, and peak alignment choices based on spectrum/storage mode.
- **Result visualization**: Continuous ion images and mean spectra; Processed TIC images and per-pixel spectra; display range, gamma, colormap, TIC normalization, and JPG (default) or transparent PNG export.
- **Clustering and regions**: backend-generated UMAP plus browser-local KMeans, cluster filtering, rectangular/freehand ROIs, multi-region comparison, and mask import/export.
- **Annotations**: Match Continuous + Centroid mean-spectrum peaks against an annotation database CSV, with ppm/Da tolerance, scores and FDR, filtering, export, and PubChem lookup. The database is a user-provided CSV or a one-click import from the platform's reference database.
- **Reference database**: Browse the HMDB 4.0 metabolite reference database after signing in — search by ID, name, or formula, filter by origin and mass range, open PubChem/HMDB entries, and download the full CSV; the annotation panel imports it in one click.
- **SXO-Harness agent**: After signing in, open the floating chat panel from the nav ball on the home or visualization page. It answers questions about the current dataset by reading ion images, statistics, annotations, clustering, and page state, and can call PubChem, ChEBI, HMDB, KEGG, literature, and web-search tools; external sources render as citation cards.

## Technology

| Area | Technology |
|---|---|
| Core | Vue 3, TypeScript, Vite 7, Pinia, Vue Router |
| UI | Tailwind CSS v4, DaisyUI v5, offline Iconify subsets |
| Visualization | ECharts, Canvas, vue3-calendar-heatmap |
| MSI/Zarr | Custom chunked Zarr v3 reader, zstddec, `@zip.js/zip.js`, hash-wasm, ml-kmeans |
| Network/storage | Axios, ali-oss with temporary STS credentials |
| SXO-Harness | @deepseek-ai/cordis, AI SDK (@ai-sdk/anthropic), shadcn-vue AI Elements, Exa web search |
| Testing | Vitest, Playwright |
| Documentation | Bilingual VitePress site |

See [package.json](package.json) for exact versions.

## Layout

```text
src/
├── app/                         # App shell, navigation, global entry components
├── assets/                      # Styles and theme assets
├── features/                    # Business-domain modules
│   ├── agent/                   # SXO-Harness: floating chat panel + connection settings (on by default for signed-in users)
│   ├── auth/                    # Sign-in, registration, and recovery flows
│   ├── collections/             # Curated dataset collections with academic metadata
│   ├── datasets/                # Lists, details, sharing, and downloads
│   ├── home/                    # Home scenes, stats, and commit heatmap
│   ├── upload/                  # imzML parsing, compression, reuse, and resume
│   ├── users/                   # Administrator user management
│   ├── vizworkbench/            # Ion images, spectra, clustering, ROIs, and annotations
│   └── workspace/               # Analysis builder and task dashboard
├── i18n/                        # vue-i18n instance and namespaced locale messages
├── router/                      # Routes and auth/admin guards
├── services/                    # Zarr (with OSS client), clustering, and PubChem services
├── shared/                      # Shared API, auth, components, config, and utilities
├── views/                       # Route pages
└── workers/                     # Cross-feature workers; feature workers stay with their feature

docs/                            # Bilingual VitePress sources
e2e/                             # Playwright tests
env/                             # Vite environment files
public/config.json               # App-wide runtime configuration loaded before mount
public/content.json              # Home page content (team, timeline, hero copy)
docker/                          # Docker/nginx deployment
```

## Local Development

### Requirements

- Node.js `>=22.12.0`
- npm (the repository commits `package-lock.json`)

### Install

```bash
npm ci
```

### Environment

The repository already contains:

- `env/.env` for shared values such as `VITE_API_BASE` and `VITE_OSS_ENDPOINT`.
- `env/.env.development` for the development proxy target `VITE_BACKEND_URL` and the SXO-Harness defaults `VITE_LLM_PROXY_URL` / `VITE_LLM_MODEL`.
- `env/.env.production` for production build/preview values. To ship a deployment-wide default connection, add `VITE_LLM_PROXY_URL`, `VITE_LLM_API_KEY`, and `VITE_LLM_MODEL` there or in a local override.
- The optional `VITE_EXA_API_KEY` for SXO-Harness web search; leave it empty to use Exa's anonymous allowance.

Put machine-specific overrides in the ignored `env/.env.development.local`:

```bash
VITE_BACKEND_URL=http://localhost:8000
```

In development, Vite proxies `/api` to `VITE_BACKEND_URL`. In the production container, nginx proxies `/api/` to the runtime `BACKEND_HOST:BACKEND_PORT` values.

Every `VITE_*` variable is compiled into the browser bundle: only put a restricted relay sub-key in `VITE_LLM_API_KEY`, and only a publishable Exa sub-key in `VITE_EXA_API_KEY`. Never place an official master key in either.

### Run

```bash
npm run dev       # SPA (5173) and docs (5174)
npm run dev:app   # SPA only
```

### Build and Verify

```bash
npm run build             # type-check + SPA build to dist/
npm run check             # type-check + ESLint + unit tests
npm run test:unit:run     # one-shot unit tests
npm run test:e2e          # Playwright E2E
npm run test:e2e:offline  # Chromium + Firefox regression without account, backend, or LLM key
npm run docs:build        # docs build to dist-docs/
npm run icons:bundle      # regenerate the offline icon subset
```

`npm run format` formats `src/` only; Markdown files are maintained separately.

### Live KEGG Queries

`kegg_pathway_lookup` and `pathway_enrichment` query the official KEGG REST API at runtime. They require no local KEGG index or downloaded dataset. Browser requests use same-origin `/kegg-rest/`, forwarded to `https://rest.kegg.jp/` by Vite (development) or nginx (Docker). Custom hosting must provide this proxy too; `vite preview` inherits Vite's proxy configuration. Restart the development server after changing Vite configuration; production needs the updated frontend and nginx configuration deployed together.

Tools schedule at most three requests per second; nginx also limits aggregate upstream traffic across clients. Rollups accept exact compound names/synonyms or KEGG C IDs and report mapping coverage, ambiguous matches and candidates deferred by the query budget. Counts are descriptive, not statistical enrichment. Network, upstream and proxy failures are reported as errors rather than absence of pathway membership.

Prepare the HMDB tool's offline index using the instructions in `scripts/build-hmdb-index.mjs`; KEGG pathway tools do not depend on it. Generate lipid candidates in the visualization annotation panel; the agent reads those existing annotation results.

## Runtime Configuration

The application loads `public/config.json` before mounting Vue. It controls the app name, navigation, pagination, verification, and Zarr read tuning. A missing or invalid file produces a startup error page.

Home page content (hero copy, feature showcase, timeline, team, contact details, commit heatmap) lives in `public/content.json` and is fetched only when the home route is entered; if it cannot be loaded the home page simply omits those sections. Both files can be edited on a deployed server and take effect on reload.

Form dropdown vocabularies and ion-source requirement rules are no longer JSON — they are compiled into the bundle (`src/features/datasets/constants/datasetMetadata.ts`, `src/features/upload/utils/ionSourceRules.ts`) and require a rebuild to change.

## Documentation and Deployment

- User and contributor docs live under `docs/` and are served locally at `http://localhost:5174/docs/`.
- The Docker image contains both `dist/` and `dist-docs/`; nginx serves the SPA and `/docs/` separately.
- The `test` branch runs checks, the docs build, and Playwright tests in Chromium and Firefox. `dev` and `main` trigger their respective deployments.

See [docs/en/dev/doc-maintenance.md](docs/en/dev/doc-maintenance.md) for the documentation workflow.

Contributor references: [Frontend Architecture](docs/en/dev/frontend-architecture.md), [Agent Architecture](docs/en/dev/agent-architecture.md), and [Testing and E2E](docs/en/dev/testing.md). Live backend tests require `E2E_USERNAME` / `E2E_PASSWORD`; offline regression skips authentication setup. Use `E2E_PORT=5193 npm run test:e2e:offline` for a dedicated server port.
