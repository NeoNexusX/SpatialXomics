# Documentation Maintenance

The documentation uses VitePress. Sources live under `docs/`, and the production site is served at `/docs/`. User and developer documentation is maintained in both English and Chinese.

## Layout and URLs

```text
docs/
├── .vitepress/config.ts     # Site, locales, nav, sidebars, and build config
├── .vitepress/theme/        # Custom theme (includes the ArchDiagram component)
├── archit_image/            # Architecture diagrams (self-contained HTML, embedded in articles)
├── en/                      # Default English sources
│   ├── guide/
│   └── dev/
└── zh/
    ├── guide/
    └── dev/
```

The `rewrites` setting removes the source `/en` segment from English URLs, while Chinese keeps `/zh`. For example:

- `docs/en/guide/dataset-overview.md` → `/docs/guide/dataset-overview`
- `docs/zh/guide/dataset-overview.md` → `/docs/zh/guide/dataset-overview`

Both locales must use **identical basenames** (no numbering prefixes on the Chinese side). The language switcher maps the current path 1:1 between locales, so mismatched basenames make the switched-to page 404.

## Editing and Adding Pages

Edit an existing `.md` file and use the local docs server for hot reload. For a new page:

1. Add corresponding pages under `docs/en` and `docs/zh`.
2. Add both entries to the English and Chinese sidebars in `docs/.vitepress/config.ts`.
3. Update documentation and code comments that refer to an old path.
4. Run the production docs build to validate links.

Frontmatter is optional for normal pages; the first `#` heading becomes the title. Use frontmatter when a custom title or outline is needed:

```markdown
---
title: Documentation Maintenance
outline: [2, 3]
---
```

## Links and Assets

- Prefer relative links in the same section, such as `[Dataset Overview](./dataset-overview)`.
- Absolute English site paths omit `/en`; Chinese paths include `/zh`.
- `ignoreDeadLinks` currently exempts only SPA paths beginning with `/mydatasets` and `/datasets`. Other dead links still fail the build; dead-link checking is not globally disabled.
- Put documentation-only screenshots in a clearly named asset directory under `docs/` and reference them relatively, or use a stable external host. Do not place them in root `public/`, where they ship as unlisted SPA assets.
- Architecture diagrams live in `docs/archit_image/` as self-contained HTML. Each node label is repeated in the `data-node-label` attribute, the `aria-label`, the `<title>` element, and the rendered SVG `<text>`; change all four together, and keep the info-card notes in step with the code. Embed one in an article with `<ArchDiagram name="agent.architecture" title="Agent architecture" />`, where `name` is the file name without `.html`; a wrong name fails the build. The diagram displays in the article like an image and opens the full view on click. `npm run docs:build` emits the files unchanged into `dist-docs/assets/`.
- Do not copy obsolete API behavior or speculate about future behavior. Use current code, runtime configuration, and the current API contract.

VitePress also supports containers, math, emoji, `[[toc]]`, and code imports. Example:

```markdown
::: warning Caution
Document a current limitation that is easy to misuse.
:::
```

## Local Verification

```bash
npm run docs:dev         # http://localhost:5174/docs/
npm run docs:type-check  # VitePress config/theme types
npm run docs:build       # output: dist-docs/
npm run docs:preview     # preview the production build
```

`npm run dev` starts the SPA (5173) and docs (5174) in parallel.

## CI and Deployment

- The `test`-branch workflow runs `npm run check` and builds docs, then runs E2E in Chromium and Firefox: secret-free offline regression, account-based live integration, and Chinese smoke. See [Testing and E2E](./testing) for coverage boundaries.
- `docker/Dockerfile` builds both the SPA and docs again, then copies `dist-docs/` to Nginx's `/docs` directory.
- `base: '/docs/'` must remain aligned with the route in `docker/nginx.conf.template`.
- `.dockerignore` excludes root `*.md` files by default but explicitly includes `docs/**`, so maintained documentation belongs under `docs/`.

## Pre-commit Checks

- [ ] English and Chinese are synchronized.
- [ ] New pages appear in both sidebars.
- [ ] APIs, fields, limits, and defaults were checked against current code.
- [ ] Obsolete pages and incorrect duplicate content were removed.
- [ ] `npm run docs:type-check` and `npm run docs:build` pass.
