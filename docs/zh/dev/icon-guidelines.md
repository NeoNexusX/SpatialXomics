# 图标使用规范

应用图标统一通过 Iconify 渲染，并把使用到的图标子集打进仓库，避免生产环境依赖 Iconify 公共 API。

## 使用方式

### 语义图标

常用业务图标优先使用全局组件 `SvgIcon`。`type` 是 `src/shared/components/svgIcons.ts` 中 `ICON_MAP` 的键，会经过 TypeScript 校验。

```vue
<SvgIcon type="warning" class="h-5 w-5 text-warning" />
```

如果一个图标在多处使用，或业务语义不应绑定具体图标名，就把它加入 `ICON_MAP`。

### 一次性图标

只出现一次的品牌或特殊图标可以直接使用 `@iconify/vue`：

```vue
<script setup lang="ts">
import { Icon } from '@iconify/vue'
</script>

<template>
  <Icon icon="simple-icons:github" class="h-5 w-5" />
</template>
```

当前离线图标集为：

- `heroicons`：常规 UI 图标的首选。
- `simple-icons`：GitHub、微信、阿里云等品牌图标。
- `lucide`：目前用于 `lasso` 和 `square`。

不要在未更新离线清单的情况下使用其他集合。

## 离线 bundle

相关文件：

```text
scripts/iconNames.mjs                         # 图标集合和名称清单
scripts/build-icon-bundle.mjs                 # 从 @iconify-json/* 抽取子集
src/shared/icons/iconBundle.generated.json    # 生成文件，提交到 Git
src/shared/icons/offlineRegistry.ts           # 启动时 addCollection()
```

`src/main.ts` 在挂载应用前导入 `offlineRegistry.ts`。如果本地缓存没有某个图标，Iconify 仍可能回退请求公共 API，所以联网开发时不能只凭“看得见图标”判断配置正确。

## 新增图标

1. 在 [Iconify 图标集](https://icon-sets.iconify.design/) 确认完整名称。
2. 将名称加入 `scripts/iconNames.mjs` 的正确集合。
3. 运行：

   ```bash
   npm run icons:bundle
   ```

4. 复用图标时同步添加 `ICON_MAP`；一次性图标可直接写完整名称。
5. 一并提交清单、业务代码和 `iconBundle.generated.json`。

## 验证

- 运行 `npm run icons:bundle` 后确认命令成功，生成文件有预期变化。
- 运行 `npm run type-check` 和 `npm run build`。
- DevTools Network 过滤 `iconify`，刷新后不应出现 `api.iconify.design` 请求。
- 不手改 `iconBundle.generated.json`，也不再直接引入 `@heroicons/vue` 组件或复制裸 SVG 来绕过清单。
