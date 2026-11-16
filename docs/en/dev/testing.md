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

`offline-chromium` and `offline-firefox` run `*.offline.spec.ts` by default; setting `E2E_WEBKIT=1` adds `offline-webkit`. They have no `setup` dependency and use empty storage state, English locale, and headless browsers.

```bash
npm run test:e2e:offline
# Focus a browser or file
npx playwright test --project=offline-chromium
E2E_WEBKIT=1 npx playwright test e2e/agent.offline.spec.ts --project=offline-webkit
# Inspect the report or a failed trace
npx playwright show-report
npx playwright show-trace test-results/<case>/trace.zip
```

`e2e/fixtures/offline.ts` creates an isolated fake account, connection, and process catalog per test. It replaces network responses and provides a switch for unavailable-storage tests. The actual Vue pages, Cordis production bundle, Anthropic adapter, tool executor, and browser OPFS still run. Model responses use Messages SSE protocol events, including real adapter-based vision probes. The fixture handles both development relay URLs and production direct requests.

On macOS, WebKit tests requiring native OPFS use a separate temporary persistent profile, removed at teardown. The locally installed WebKit rejects native `navigator.storage.getDirectory()` with `UnknownError` in a private context, while a persistent profile works. Some WebKit ports still share origin storage across profiles, so a blank setup page clears the test origin's localStorage and `sxo-sessions-v1` before application code loads. Persistence tests exercise actual OPFS rather than substituting memory. Temporary-storage fallback tests and other browsers use the default context.

Linux WebKit has no `navigator.storage`, so the application uses memory storage there. The fixture exposes this as `opfs`: the two tests that depend on persistence (message restore with second-tab read-only, and image artifact restore) skip in that environment while everything else still runs. To verify real OPFS in WebKit, run `E2E_WEBKIT=1 npx playwright test --project=offline-webkit` on macOS. Use distinct `E2E_PORT` values for concurrent runs to isolate origins.

| File | Behavior covered |
| --- | --- |
| `agent.offline.spec.ts` | Vision probing and exclusion of unsupported models; connection save/restore and confirmed clearing; drafts across settings; Shift+Enter and single submission; tool calls and result replay; permanent errors and regeneration; cancellation and late-response isolation; OPFS restore and cross-tab read-only access; image transport and artifact restore; temporary storage fallback |
| `datasets.offline.spec.ts` | Downloads on the public and personal dataset lists: one signing request that opens imzML + ibd, cooldown notice, server quota notice with retry, blocking on an incomplete profile, and the signed-out redirect to login |
| `workspace.offline.spec.ts` | Search submission, clearing, pagination reset and page size; cancel/confirm deletion, last-page fallback, summary refresh; failed-delete feedback and another attempt; task errors and running-task action restrictions; 401 state clearing and return destination; creating a Peak Alignment task from a dataset and following it to completion |

There are currently 22 scenarios, run in Chromium and Firefox by default for 44 executions; enabling WebKit makes it 66 (two of them skip on Linux WebKit). The fixture also fails on unconfigured API requests and uncaught page errors. Match API paths precisely: a Vite source module such as `/src/shared/api/httpClient.ts` must not be intercepted as an API endpoint.

Offline regression does not validate live backend contracts, OSS data reads, algorithm quality, or actual model reasoning. It verifies browser integration reproducibly.

## Live backend integration

The `chromium` and `firefox` projects run live backend tests and depend on `setup`; the `webkit` project does the same but requires `E2E_WEBKIT=1`. `chromium-zh` only runs `i18n-zh.spec.ts` for Chinese smoke coverage. None of them include offline files.

```bash
# Supply the test account in the current shell; keep real credentials out of tests and shell history
export E2E_USERNAME='<test account>'
export E2E_PASSWORD='<test password>'
npx playwright test --project=chromium
# Default projects: offline, live backend, and Chinese smoke, without WebKit
npm run test:e2e
# Include WebKit as well
E2E_WEBKIT=1 npm run test:e2e
```

`auth.setup.ts` signs in through the application and saves state to Git-ignored `.auth/user.json`. Vite environment files under `env/` do not automatically populate Playwright's Node process. Provide credentials explicitly through the shell or CI. Missing credentials only affect projects depending on setup.

Live integration covers authentication, datasets, upload, collections, shared overviews, databases, analysis and visualization, workspace, responsive layouts, and Chinese route messages. Real downloads, the large-file upload round trip, and the Peak Alignment journey run only in Chromium to limit run time and account quota; the offline group covers cross-browser download behavior. Algorithm journeys use the real MSI dataset names in `e2e/utils.ts`; synthetic imzML files without spectra cannot prove successful processing. Clean up created resources. Skips for missing optional environment data need explicit reasons and must not hide failed product assertions.

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

The `test` branch CI first runs `check` and the documentation build. A single `e2e` job then builds the production SPA and runs the default Playwright projects (no WebKit): the offline group and login setup first, then the live group and Chinese smoke. Pull requests from external forks have no account secrets and run only the offline group. Failures become Actions annotations, and the HTML report (with screenshots and traces) is uploaded as `playwright-report` for seven days. The live group shares one account and deletes and re-uploads datasets, so the job queues through `concurrency`. Offline success does not establish live backend success; report them separately.
