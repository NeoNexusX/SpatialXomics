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

`src/features/agent` 是一个 `@deepseek-ai/cordis` 插件应用。每个能力是一个插件，由一张组合表装配：

- `bundles/base.ts`：生产组合表。行序没有加载语义，插件在 `inject` 的服务就绪后才启动。增减插件只改这张表。
- `bootstrap.ts`：创建根 context 并装配组合表。`whenAgentReady()` 等全部插件启动，有插件失败时报出它的名字。
- `plugins/<名称>/`：一个目录一个插件，对外只暴露 `index.ts`。提供服务的插件写成 `class extends Service` 加 `static inject`，其余写成导出 `name`、`inject`、`apply` 的模块。
- `bridge/`：分析页面静态引用的轻量模块（页面状态、数据集绑定）。这里不能引用 cordis 和插件，否则运行时会进首屏。
- `components/`、`composables/`：界面，只依赖 `ctx.agent` 等服务。

循环（`plugins/agent-loop`）只管轮次、步骤、尝试和工具调度，其余策略都挂在它发出的事件上：

| 事件 | 模式 | 时机 | 监听方 |
| --- | --- | --- | --- |
| `agent/guard` | bail，抛错即结束这一轮 | 轮次开始、每步开始、每个工具前后 | `analysis-binding` |
| `agent/pre-turn` | waterfall | 提交轮次开头的事件之前 | `analysis-binding` 追加上下文消息 |
| `agent/pre-request` | serial | `request/context` 提交后、请求发出前 | `compaction` |
| `agent/request-error` | waterfall | 失败的尝试提交后 | `compaction`（超窗）、`llm-retry` |
| `agent/tool-result` | waterfall | 工具结果写进历史前 | `tool-archive` |
| `tools/pre-execute`、`tools/post-execute`、`tools/result` | serial、waterfall、emit | 工具执行前后 | 暂无生产监听方 |

上下文压缩（`plugins/compaction`）只做一件事：把最旧的一段对话换成一条结构化 checkpoint，不单独裁剪图片和工具结果。

- 触发：输入估算达到 `min(0.8W, W − O − min(65536, W/4))` 时在请求前压缩；端点确认超窗时每轮压缩一次后重试；用户手动压缩不看阈值。W 是上下文窗口，O 是输出预留。
- 选区：保留最近 `0.16 × (W − O)` 的内容，不动当前轮次，不拆开工具调用和结果。手动和超窗恢复只留最后一段完整内容。
- 摘要请求：回放原系统提示词、工具和这段原消息，最后追加压缩指令。它是上次请求的前缀，端点的提示词缓存可以复用，所以不要改动这段消息的顺序和内容。
- 日志：`compaction/start`、`compaction/summary`、替换消息、`compaction/end`。原始消息和附件一直在日志里，界面仍显示完整对话，但模型之后只能看到摘要。
- 失败：历史保持原样，这一轮继续，放不放得下由端点判断。

工具结果入库时的截断和存档（`plugins/tool-archive`）是另一回事：完整结果写进会话存储，模型可以用 `read_archived_result` 读回。

连接与模型由三个插件分担：`plugins/connection` 保存用户填写的端点、密钥和模型（密钥只在本机 `localStorage`，未填写时回落到 `VITE_LLM_*` 部署默认）；`plugins/llm-anthropic` 是唯一的协议适配器，请求规范化后的 `{baseUrl}{requestPath}`，默认为 `https://api.anthropic.com/v1/messages`；`plugins/model-catalog` 拉取模型列表并逐个发小图做多模态测试，只有通过的模型才能被选中保存。用户导入的 `AGENTS.md`（≤64 KiB）由 `plugins/agent-instructions` 原样写进系统提示词。

会话以数据集为作用域。`plugins/session` 负责轮次和事件日志，`plugins/session-persistence-opfs` 把每段对话写成带校验和的分段文件并保存图片附件：OPFS 不可用时降级为临时会话，同一对话在另一标签页打开时为只读，每个数据集最多保留 3 段对话。`plugins/session-archive` 把对话连同附件打包成 ZIP，导入前在内存里校验日志连续性和图片引用，`fflate` 按需加载。`plugins/attachments` 把聊天图片和工具生成的图片存成 artifact，消息只保留引用；`plugins/token-meter` 在还原图片前估算大小。

工具按领域拆分：`tool-backend-api`（文件、处理任务、配额）、`tool-page-context`（当前可视化页面的状态与统计）、`tool-ion-image`（单张/批量离子图与注释行图，每次返回 1–4 张图片，适配器放进同一个 `tool_result`）、`tool-knowledge`（PubChem、ChEBI、本地注释库）、`tool-bio`（HMDB、KEGG、富集）、`tool-literature`（PubMed、Europe PMC、OpenAlex）、`tool-web-search` 和 `tool-skill`。领域操作说明放在 `plugins/skill-bundled/skills/*/SKILL.md`，由 `plugins/skill` 的技能注册表加载。

联网搜索（`plugins/tool-web-search`）只给模型一个 `web_search` 工具，直接请求 Exa 托管的 MCP 端点 `https://mcp.exa.ai/mcp`，默认使用匿名额度。可选的 `VITE_EXA_API_KEY` 经 `x-api-key` 请求头只发给这个端点；它会进浏览器包，只能放受限的子 key。

外部证据的引用格式写在 `citations/index.ts`：模型输出 `[来源标题](URL "可选摘要")`，`MarkdownLink.vue` 把 HTTP(S) 链接渲染成 `InlineCitation.vue` 来源卡片。化学、生物、文献和网络类工具的 schema 会自动带上这条约定。

常见改动：

- 加工具：新建 `plugins/tool-<名称>/`，在 `apply` 里调 `ctx.tools.register()`，再往组合表加一行。
- 支持新协议：新建适配器插件调 `ctx.llm.registerAdapter()`，给 `ENDPOINT_PROFILES` 加一项，再往组合表加一行。循环和界面不用动。
- 加系统提示词内容：在负责它的插件里调 `ctx.systemPrompt.section()`。同样的输入必须渲染出同样的字节，否则端点的提示词缓存会失效。

`npm run lint:check` 会检查这些边界：插件之间只能引用对方的 `index.ts`；插件不能引用界面；`ai`、`@ai-sdk/*` 只能出现在 `plugins/llm-anthropic`；`bridge/` 不能引用 cordis 和插件。

`__tests__/behaviorLock.test.ts` 端到端跑一遍 agent 的各个分支，逐字节比较写进存储的事件、发给模型的请求、界面状态和系统提示词（快照在 `__tests__/__snapshots__/behaviorLock/`）。重构时快照不应该变；有意改变行为时，检查差异后用 `npx vitest run src/features/agent/__tests__/behaviorLock.test.ts -u` 更新。

## 自动化检查

- `npm run type-check`：Vue/TypeScript 类型检查。
- `npm run lint:check`：ESLint、上述旧别名限制和 SXO-Harness 的插件边界。
- `npm run test:unit:run`：单元测试单次运行。
- `npm run check`：并行执行前三项。
- `npm run format:check`：只检查 `src/` 的 Prettier 格式，不包含在 `check` 中。
- `npm run docs:build`：单独验证文档构建和大多数站内链接。

新增代码应以现有目录职责和相邻实现为准；文档描述与代码冲突时，先确认运行行为，再同步更新两者。
