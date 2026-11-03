# Testing and E2E

Vitest verifies components, composables, services, and agent behavior contracts. Playwright exercises complete interactions in real browsers. `playwright.config.ts` separates deterministic offline browser regression from live backend integration; they do not share authentication setup.

## Checks

```bash
npm ci
npm run check              # App, tooling, and E2E types + ESLint + Vitest coverage
npm run docs:type-check
npm run docs:build
npx playwright install     # First-time browser installation; Linux CI uses --with-deps
npm run test:e2e:offline   # No account, backend, or LLM key required
```

`check` does not run browser tests, build documentation, or run `format:check`. Run these separately. Reports are under `playwright-report/`; failure screenshots and traces are under `test-results/`. Both directories are ignored by Git.

## Offline browser regression

Only `offline-chromium`, `offline-firefox`, and `offline-webkit` run `*.offline.spec.ts`. They have no `setup` dependency and use empty storage state, English locale, and headless browsers.

```bash
npm run test:e2e:offline
# Focus a browser or file
npx playwright test --project=offline-chromium
npx playwright test e2e/agent.offline.spec.ts --project=offline-webkit
# Inspect the report or a failed trace
npx playwright show-report
npx playwright show-trace test-results/<case>/trace.zip
```

`e2e/fixtures/offline.ts` creates an isolated fake account, connection, and process catalog per test. It replaces network responses and provides a switch for unavailable-storage tests. The actual Vue pages, Cordis production bundle, Anthropic adapter, tool executor, and browser OPFS still run. Model responses use Messages SSE protocol events, including real adapter-based vision probes. The fixture handles both development relay URLs and production direct requests.

WebKit tests requiring native OPFS use a separate temporary persistent profile, removed at teardown. The locally installed WebKit rejects native `navigator.storage.getDirectory()` with `UnknownError` in a private context, while a persistent profile works. Some WebKit ports still share origin storage across profiles, so a blank setup page clears the test origin's localStorage and `sxo-sessions-v1` before application code loads. Persistence tests exercise actual OPFS rather than substituting memory or skipping assertions. Temporary-storage fallback tests and other browsers use the default context. Use distinct `E2E_PORT` values for concurrent runs to isolate origins.

| File | Behavior covered |
| --- | --- |
| `agent.offline.spec.ts` | Vision probing and exclusion of unsupported models; connection save/restore and confirmed clearing; drafts across settings; Shift+Enter and single submission; tool calls and result replay; permanent errors and regeneration; cancellation and late-response isolation; OPFS restore and cross-tab read-only access; image transport and artifact restore; temporary storage fallback |
| `workspace.offline.spec.ts` | Search submission, clearing, pagination reset and page size; cancel/confirm deletion, last-page fallback, summary refresh; failed-delete feedback and another attempt; task errors and running-task action restrictions; 401 state clearing and return destination |

There are currently 13 scenarios, each run in three browsers, totaling 39 executions. The fixture also fails on unconfigured API requests and uncaught page errors. Match API paths precisely: a Vite source module such as `/src/shared/api/httpClient.ts` must not be intercepted as an API endpoint.

Offline regression does not validate live backend contracts, OSS Range data, algorithm quality, or actual model reasoning. It verifies browser integration reproducibly.

## Live backend integration

The existing `chromium`, `firefox`, and `webkit` projects retain live backend tests and depend on `setup`. `chromium-zh` only runs `i18n-zh.spec.ts` for Chinese smoke coverage. All four exclude offline files.

```bash
# Supply the test account in the current shell; keep real credentials out of tests and shell history
export E2E_USERNAME='<test account>'
export E2E_PASSWORD='<test password>'
npx playwright test --project=chromium
# All projects, including offline, live backend, and Chinese smoke
npm run test:e2e
```

`auth.setup.ts` signs in through the application and saves state to Git-ignored `.auth/user.json`. Vite environment files under `env/` do not automatically populate Playwright's Node process. Provide credentials explicitly through the shell or CI. Missing credentials only affect projects depending on setup.

Live integration covers authentication, datasets, upload, collections, shared overviews, databases, analysis and visualization, workspace, responsive layouts, and Chinese route messages. Algorithm journeys use the real MSI dataset names in `e2e/utils.ts`; synthetic imzML files without spectra cannot prove successful processing. Clean up created resources. Skips for missing optional environment data need explicit reasons and must not hide failed product assertions.

Locally, Playwright starts or reuses the SPA dev server on 5173. With `CI=true`, it starts preview on 4173 and requires `npm run build` first. Live integration needs working `/api` access: development uses Vite's proxy, while a production-preview environment must provide its own backend access. Fixed-response tests do not depend on that proxy.

Use `E2E_PORT=5193 npm run test:e2e:offline` when another development or test server is running. It changes both the test URL and the automatically started server port.

## Behavior locks and browser coverage

`src/features/agent/__tests__/behaviorLock.test.ts` runs the production plugin composition with deterministic dependencies inside Vitest. It compares stored events, model requests, UI state, and system prompt bytes. It covers binding changes, tool errors, retries, compaction, images, and storage failure/recovery, but does not launch a browser. It cannot replace browser validation of OPFS, locks, file selection, and component wiring.

```bash
npx vitest run src/features/agent/__tests__/behaviorLock.test.ts
npx vitest run src/features/agent
```

Update snapshots with `-u` only after an intentional behavior change and review of the diff. Do not update them simply to accept a refactor's unexpected changes. See [Agent Architecture](./agent-architecture) for the implementation boundaries.

## New tests and CI

Assert user-visible outcomes and important request contents. Prefer roles, labels, and placeholders. Scope repeated titles or conversation names to a message log, table row, or dialog. Synchronize with locator assertions, `expect.poll()`, or explicit request events; avoid fixed sleeps and do not use `networkidle` to decide that a streaming agent turn has completed.

Fixtures should match the current API's method, path, body, and pagination shape. Exercise real browser storage, locks, and artifacts for persistence tests; disable capabilities only in dedicated fallback tests. Every test gets an independent context and must not depend on a previous test's account, process, or conversation.

The `test` branch CI first runs `check` and the documentation build. Two browser jobs follow independently: `e2e-offline` builds the production SPA and runs all three offline projects without account secrets; `e2e` runs the three live projects and Chinese smoke using account secrets. Each uploads its own reports, screenshots, and traces for seven days. Offline success does not establish live backend success; report them separately.
