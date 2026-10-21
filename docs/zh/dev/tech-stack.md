# 技术栈

本页记录当前前端仓库实际使用的技术、目录和脚本。模块边界见 [前端架构边界](./frontend-architecture)。

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- npm（仓库提交了 `package-lock.json`）

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动 SPA（5173）和文档站（5174）；只开发应用时使用 `npm run dev:app`。

## 核心依赖

| 分类 | 当前实现 |
|---|---|
| 应用框架 | Vue 3、TypeScript、Pinia、Vue Router |
| 构建与样式 | Vite 7、Tailwind CSS 4、DaisyUI 5 |
| 图标 | Iconify，构建前抽取 `heroicons`、`simple-icons`、`lucide` 子集并离线注册 |
| 图表 | ECharts、`vue3-calendar-heatmap` |
| HTTP | Axios |
| 国际化 | `vue-i18n`（Composition 模式），语言包按命名空间拆分为 JSON 并随路由懒加载；`@intlify/unplugin-vue-i18n` 构建优化，`@intlify/eslint-plugin-vue-i18n` 检查缺失/多余 key |
| 上传 | `hash-wasm` 计算 MD5，`@zip.js/zip.js` 生成 ZIP64，`ali-oss` 分片上传 |
| Zarr | 项目内的 Zarr v3/OSS Range reader，`zstddec` 解压；兼容 MassFlow layout 1.0/1.1 |
| PubChem | 注释结果的化合物查询 |
| 聚类 | 后端生成 UMAP；浏览器通过 `ml-kmeans` 在 UMAP embedding 上计算 KMeans |
| 注释 | 无第三方依赖：元素与加合物质量表在 `src/shared/chem`；浏览器端（Worker）完成特征峰匹配、质量 / 加合适配度 / 空间（METASPACE 混乱度 + 同分子共定位）打分与 target-decoy FDR |
| 其他 | `i18n-iso-countries` 提供国家/地区数据 |
| 文档与测试 | VitePress、Vitest、Playwright |
| 规范 | ESLint 9 flat config、Prettier |

<!-- AI 助手暂不对用户开放，恢复时把这一行加回上面的表格：
| AI 助手 | `cordis` Agent 运行时（工具循环、技能、SSE 适配）；聊天视图：`@tdesign-vue-next/chat` |
-->

项目没有使用 `zarrita` 或 `crypto-js`。密码按表单值通过 HTTPS 提交，访问令牌由 `src/shared/auth` 管理并保存在 `localStorage`。

精确版本以根目录 `package.json` 和 `package-lock.json` 为准。

## 目录结构

```text
src/
├── app/                  # App 外壳和全局入口组件
├── assets/               # 主题与全局样式
├── features/             # 业务模块：auth、collections、datasets、home、upload、users、vizworkbench、workspace
├── i18n/                 # vue-i18n 实例、类型定义和 locales/{locale}/{ns}.json 语言包
├── router/               # 路由与守卫
├── services/             # Zarr（含 OSS client）、聚类和 PubChem 等跨模块服务
├── shared/               # HTTP、认证、指令、通用组件/composable/config/types
├── views/                # 路由页面，负责组装 feature
└── workers/              # 上传 ZIP/MD5 Worker
```

<!-- `assistant`（AI 助手）模块仍在源码中，暂不对用户开放，故从上面清单隐去；恢复时加回。 -->

`vizworkbench` 还在 `src/features/vizworkbench/utils/` 下维护注释 CSV 和 KMeans Worker；Worker 靠近所属 feature，不要求全部放到根 `workers/`。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 并行启动 SPA 和文档站 |
| `npm run dev:app` | 只启动 SPA |
| `npm run build` | 并行执行类型检查和 Vite 生产构建，输出 `dist/` |
| `npm run preview` | 预览 SPA 生产构建 |
| `npm run type-check` | Vue/TypeScript 类型检查 |
| `npm run lint` / `lint:check` | ESLint 自动修复 / 只检查 |
| `npm run format` / `format:check` | 仅格式化/检查 `src/` |
| `npm run test:unit` / `test:unit:run` | Vitest watch / 单次运行 |
| `npm run test:e2e` | Playwright E2E |
| `npm run check` | 并行执行类型检查、lint 和单元测试 |
| `npm run icons:bundle` | 重新生成离线图标 bundle |
| `npm run docs:dev` / `docs:build` / `docs:preview` | 开发、构建、预览文档站 |
| `npm run docs:type-check` | 检查 VitePress 配置和主题类型 |

## 配置与部署

- Vite 环境文件位于 `env/`。本地覆盖可使用 `env/.env.development.local`；运行时业务配置由 `public/config.json` 提供，并在应用挂载前加载。
- `config.json` 可配置站点名称、导航与悬浮按钮、分页、验证码、Zarr 读取参数等全站设置。<!-- AI 助手暂不对用户开放，恢复时取消本注释：AI 助手没有独立开关：悬浮按钮的 `toggle-ai` 入口走通用 `active` / `requireAuth` 规则，当前对已登录用户开启。对话需要部署级 LLM 凭据（`VITE_LLM_PROXY_URL` / `VITE_LLM_API_KEY`）或用户自配（BYOK）；两者皆无时，助手面板会直接落在设置页。 -->
- 首页展示内容（Hero 文案、功能展示、时间线、团队、联系信息、提交热力图）拆在 `public/content.json`，由 `/` 路由在进入首页时加载，与首页 chunk 并行；这样它的体积不会压在全站启动的关键路径上。取不到时首页降级为不显示这些区块，不影响其他页面。
- 上传表单的下拉选项与 ion source 必填规则不再走 JSON，已编译进代码（`datasetMetadata.ts` / `ionSourceRules.ts`），随路由 chunk 长缓存，修改后需重新构建。
- `test` 分支的 workflow 运行 `npm run check`、文档构建和 Chromium/Firefox/WebKit E2E。
- 推送 `dev` 或 `main` 会分别触发对应部署 workflow。Docker 多阶段构建同时生成 `dist/` 和 `dist-docs/`，Nginx 在 `/docs/` 提供文档站。

私有配置值是否提交由仓库策略决定；前端 `VITE_*`、`public/config.json` 和 `public/content.json` 最终都会进入浏览器，不能作为真正的服务端秘密。
