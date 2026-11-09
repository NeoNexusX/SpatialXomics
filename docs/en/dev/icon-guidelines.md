# Icon Guidelines

Application icons are rendered through Iconify. The repository bundles the used subset so production does not depend on Iconify's public API. The SXO-Harness interface is an exception; see below.

## Usage

### Semantic icons

Prefer the globally registered `SvgIcon` for common business icons. Its `type` is a key from `ICON_MAP` in `src/shared/components/svgIcons.ts` and is checked by TypeScript.

```vue
<SvgIcon type="warning" class="h-5 w-5 text-warning" />
```

Add an icon to `ICON_MAP` when it is reused or when business code should not depend on a concrete icon-library name.

### One-off icons

A brand or special icon used once may use `@iconify/vue` directly:

```vue
<script setup lang="ts">
import { Icon } from '@iconify/vue'
</script>

<template>
  <Icon icon="simple-icons:github" class="h-5 w-5" />
</template>
```

The currently bundled sets are:

- `heroicons`: preferred for general UI.
- `simple-icons`: brands such as GitHub, WeChat, and Alibaba Cloud.
- `lucide`: currently used for `lasso` and `square`.

Do not use another set without adding it to the offline manifest and dependencies.

### SXO-Harness components

Components under `src/features/agent/components` follow shadcn-vue and import icons directly from `@lucide/vue`. It is bundled with the code, makes no network requests, and needs no offline manifest entry. Use it only in that directory; the rest of the interface stays on `SvgIcon`.

## Offline Bundle

Relevant files:

```text
scripts/iconNames.mjs                         # Sets and icon-name manifest
scripts/build-icon-bundle.mjs                 # Extracts subsets from @iconify-json/*
src/shared/icons/iconBundle.generated.json    # Generated and committed output
src/shared/icons/offlineRegistry.ts           # Calls addCollection() at startup
```

`src/main.ts` imports `offlineRegistry.ts` before mounting the application. Iconify may fall back to its public API when an icon is missing locally, so seeing an icon on an online development machine is not sufficient verification.

## Adding an Icon

1. Confirm the full name on [Iconify icon sets](https://icon-sets.iconify.design/).
2. Add it to the correct set in `scripts/iconNames.mjs`.
3. Run:

   ```bash
   npm run icons:bundle
   ```

4. Add reusable semantic icons to `ICON_MAP`; a true one-off can use the full name directly.
5. Commit the manifest, business-code change, and `iconBundle.generated.json` together.

## Verification

- Confirm `npm run icons:bundle` succeeds and produces the expected generated-file change.
- Run `npm run type-check` and `npm run build`.
- In DevTools Network, filter for `iconify`; a reload should make no request to `api.iconify.design`.
- Do not hand-edit `iconBundle.generated.json`, import `@heroicons/vue` components, or paste raw SVG to bypass the manifest.
