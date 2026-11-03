# 前端架构边界

## 目录职责

- `src/app`：应用外壳和全局入口组件。
- `src/views`：路由页面，组装 feature 能力；已有页面可能包含少量页面协调逻辑。
- `src/shared`：不属于单一业务模块的 HTTP、认证、配置、指令（`v-reveal`）、通用组件、composable、类型和工具。
- `src/features/<module>`：按业务拆分的模块，按需包含 `api`、`components`、`composables`、`constants`、`mappers`、`services`、`stores`、`types`、`utils`。当前模块：`agent`、`auth`、`collections`、`databases`、`datasets`、`home`、`upload`、`users`、`vizworkbench`、`workspace`。
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

这些是维护约定，不是全部由工具强制的规则。当前 ESLint 的架构规则只明确禁止旧根目录别名，如 `@/components/*`、`@/composables/*`、`@/utils/*`、`@/stores/*`、`@/types/*`、`@/constants/*`；它不会自动阻止所有跨 feature 引用。`src/features/agent` 另有一组插件边界规则，见下文。

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

## SXO-Harness 的插件结构

`src/features/agent` 是由 `@deepseek-ai/cordis` 装配的浏览器端插件应用。完整执行过程、事件契约和恢复语义见 [Agent 架构](./agent-architecture)。

- `bundles/base.ts` 是生产组合表，插件通过 `inject` 声明服务依赖；`bootstrap.ts` 的 `whenAgentReady()` 等待全部插件就绪。
- `bridge/` 是页面静态引用的轻量边界，传递数据集身份、加载代次和分析选择，不依赖 Cordis 或插件。
- `plugins/agent` 提供界面使用的 `ctx.agent` 门面，负责准入、会话切换与快照；`plugins/agent-loop` 注册驱动器，负责 turn、step、attempt 和工具调度。压缩、重试、分析绑定和结果存档通过事件接入。
- `plugins/session` 先持久化事件批次再发布事实；`session-projection` 管理一致的读取模型，`session-transcript`、`token-meter` 和 `agent-instructions` 分别维护对话、统计与指令投影。流式输出是叠加态，失败尝试不会写进模型消息历史。
- `session-persistence` 是存储契约，OPFS 插件是实现。会话按数据集分组，支持恢复、跨标签页只读、临时降级及带图片的 ZIP 导入导出；不能把日志、模型可见 surface 和 UI 消息数组当作同一份状态。
- `connection` 解析成组的地址/密钥，`llm` 提供协议无关契约，`llm-anthropic` 隔离 SDK，`model-catalog` 实际探测识图能力。领域工具和内置技能通过注册表扩展。
- `FloatingAgent.vue` 异步加载工作面板并在空闲时预取；关闭面板保留模块级运行时，正在执行的轮次需显式停止。

ESLint 限制插件之间只经 `index.ts` 引用，插件不能依赖界面，AI SDK 只能在 `llm-anthropic` 中使用，bridge 不能加载插件运行时。新增能力先明确其门面、驱动器、策略或读取模型职责，避免把插件间调用收回一个大循环。

## 自动化检查

- `npm run type-check`：Vue/TypeScript 类型检查。
- `npm run lint:check`：ESLint、上述旧别名限制和 SXO-Harness 的插件边界。
- `npm run test:unit:run`：单元测试单次运行。
- `npm run check`：并行执行前三项。
- `npm run format:check`：只检查 `src/` 的 Prettier 格式，不包含在 `check` 中。
- `npm run test:e2e:offline`：三个浏览器的固定响应回归，无需测试账号；运行方式与真实后端测试边界见 [测试与 E2E](./testing)。
- `npm run docs:type-check` / `npm run docs:build`：单独验证文档类型、生产构建和大多数站内链接。

新增代码应以现有目录职责和相邻实现为准；文档描述与代码冲突时，先确认运行行为，再同步更新两者。
