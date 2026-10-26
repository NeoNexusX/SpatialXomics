# 前端架构边界

## 目录职责

- `src/app`：应用外壳和全局入口组件。
- `src/views`：路由页面，组装 feature 能力；已有页面可能包含少量页面协调逻辑。
- `src/shared`：不属于单一业务模块的 HTTP、认证、配置、指令（`v-reveal`）、通用组件、composable、类型和工具。
- `src/features/<module>`：按业务拆分的模块，按需包含 `api`、`components`、`composables`、`constants`、`mappers`、`services`、`stores`、`types`、`utils`。当前模块：`auth`、`collections`、`databases`、`datasets`、`home`、`upload`、`users`、`vizworkbench`、`workspace`。<!-- `assistant`（AI 助手）暂不对用户开放，随功能恢复加回本清单。 -->
- `src/i18n`：全站 vue-i18n 实例、类型定义和语言包。语言包按 `locales/{locale}/{namespace}.json` 组织，core 命名空间（`common`、`auth`）启动时加载，feature 命名空间随路由懒加载。
- `src/services`：多个 feature 共同使用、且与基础设施紧密相关的读取与客户端能力——Zarr（含 OSS client）、聚类和 PubChem。
- `src/router`：路由声明和认证/权限守卫。
- `src/workers`：跨上传流程使用的 Worker；feature 专属 Worker 可以留在所属模块。

## 依赖方向

- `shared` 不应依赖具体 `features`。
- feature 可以依赖 `shared` 和跨模块 `services`。
- 避免直接引用另一 feature 的内部实现；确需跨模块复用时，先抽到合适的 `shared` 或 `services` API。
- `views` 和工作区页面可组合多个 feature，但请求、计算和副作用优先沉到 composable/service。
- **语言包必须放在 `src/i18n/locales/`，不能放 `src/shared/`**。`vite.config.ts` 的 `manualChunks` 把 `src/shared/**`（除 `config/`）合并成一个 eager chunk；语言包落进去会导致所有语言和命名空间的文案全部打进首屏，懒加载失效。

这些是维护约定，不是全部由工具强制的规则。当前 ESLint 的架构规则只明确禁止旧根目录别名，如 `@/components/*`、`@/composables/*`、`@/utils/*`、`@/stores/*`、`@/types/*`、`@/constants/*`；它不会自动阻止所有跨 feature 引用。

## 状态边界

- 临时 UI 状态放在组件内。
- 页面/模块共享状态放到所属 feature 的 composable，必要时使用 store。
- 认证是全局横切能力，当前实现位于 `src/shared/auth/authStore.ts`，不是 `features/auth/stores`。
- 服务端数据由 API/composable 管理，除非确有跨页面缓存需求，不要默认放进 Pinia。
- 结果页的大数据数组和 reader 实例由 composable/service 持有，并在 run 切换或组件卸载时释放。

## 后台任务与大数据

- 上传 ZIP/MD5 在 `src/workers/zip-compress.worker.ts` 执行。
- 注释（库 CSV 解析、特征峰匹配、打分、FDR、空间评分计算）和 KMeans 分别在 `vizworkbench` 的 Worker 中执行（`utils/annotation/annotation.worker.ts`、`kmeans.worker.ts`）；注释用到的离子图由主线程从 Zarr 读取后交给 Worker。
- Zarr 通过 OSS Range 请求按元数据和 chunk 读取，访问凭证过期时由 OSS client 刷新。
- UMAP 由后端生成；KMeans 是基于 UMAP embedding 的本地计算。不要把两者描述为同一个后端任务。

## 自动化检查

- `npm run type-check`：Vue/TypeScript 类型检查。
- `npm run lint:check`：ESLint 和上述旧别名限制。
- `npm run test:unit:run`：单元测试单次运行。
- `npm run check`：并行执行前三项。
- `npm run format:check`：只检查 `src/` 的 Prettier 格式，不包含在 `check` 中。
- `npm run docs:build`：单独验证文档构建和大多数站内链接。

新增代码应以现有目录职责和相邻实现为准；文档描述与代码冲突时，先确认运行行为，再同步更新两者。
