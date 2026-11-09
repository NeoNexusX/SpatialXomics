# SXO-Harness Agent 架构

SXO-Harness 是运行在浏览器内的分析助手。Vue 界面通过 `ctx.agent` 操作会话，Cordis 插件提供模型通信、工具、技能、上下文压缩和本地存储。后端仍负责认证、数据文件和计算任务；本仓库没有独立的服务端 agent 调度进程。

本文以 `src/features/agent/bundles/base.ts` 的生产组合表为入口。用户操作说明见 [SXO-Harness 助手](../guide/sxo-harness)，测试方法见 [测试与 E2E](./testing)。

<ArchDiagram name="agent.architecture" title="Agent 架构" />

## 入口与依赖装配

`Navbar.vue` 静态引用轻量的 `FloatingAgent.vue`。外壳负责打开、关闭、拖拽和缩放；`AgentWorkspace.vue` 是异步组件，浏览器空闲时会预取它，因此“异步分包”并不表示必须等点击才下载。运行时由 `whenAgentReady()` 懒创建并缓存为模块级单例，关闭面板不会销毁它或中止正在执行的轮次。

`bootstrap.ts` 创建 Cordis 根 context，将 `baseBundle` 中的插件交给 `ctx.plugin()`。组合表行序不表达启动依赖，服务的 `static inject` 和模块插件的 `inject` 才决定何时启动。`whenAgentReady()` 等待所有插件处于 active，失败时报告插件 ID；HMR 时释放根 fiber。

<ArchDiagram name="cordis-relationships.architecture" title="Cordis 与项目的关系" />

| 层 | 模块 | 职责与消费方 |
| --- | --- | --- |
| 页面桥接 | `bridge/analysisContext.ts`、`datasetBinding.ts` | 页面提供数据集、离子、聚类、像素、注释等状态；桥接层不能加载 Cordis 或插件 |
| 界面 | `components/`、`composables/` | 展示消息和连接设置，通过服务快照与命令交互 |
| 应用门面 | `plugins/agent` | 准入、会话切换、订阅快照、指令导入和轮次停止 |
| 轮次驱动器 | `plugins/agent-loop` | 实现 `AgentDriver`，组织 step、attempt 和工具往返 |
| 会话事实与读取模型 | `session`、`session-projection`、`session-transcript` | 提交事件、维护模型可见历史、从已提交日志生成 UI 和统计 |
| 存储 | `session-persistence`、`session-persistence-opfs`、`attachments`、`session-archive` | 存储契约、OPFS 实现、附件引用与 ZIP 迁移 |
| 模型与策略 | `connection`、`llm`、`llm-anthropic`、`model-catalog`、`llm-retry`、`token-meter`、`compaction` | 连接解析、协议隔离、模型探测、重试与上下文预算 |
| 提示词与分析绑定 | `system-prompt`、`persona`、`agent-instructions`、`analysis-binding` | 组合系统提示词和会话指令，捕获并校验数据集绑定 |
| 领域能力 | `tools`、`tool-*`、`skill`、`skill-bundled` | 工具注册、执行管线、结果存档、技能目录与正文 |

## Agent 门面与循环分离

`AgentRuntime` 管理当前会话和驱动器，界面只依赖 `Agent` 契约。`AgentLoop` 在启动时通过 `setDriverFactory()` 注册 `LoopDriver`。替换执行策略时可以替换驱动器插件，界面、连接和存储不需要承担循环实现。

一次 `send(text, images)` 的主要过程是：

1. 门面拒绝空输入、并发发送、正在切换或已释放的状态；捕获连接、数据集绑定和当前分析选择。
2. 等待会话恢复，拒绝只读会话，保存图片 artifact，生成包含系统提示词的 `TurnPlan`。
3. 驱动器解析模型和预算，提交 `turn/start`、用户消息及 `agent/pre-turn` 追加的上下文。提交成功才回调 accepted；输入框据此清除已接受的草稿。
4. 每一步先提交 `step/start` 和 `request/context`，运行请求前策略，再还原附件并提交 `attempt/start`，最后发出流式请求。
5. 流中的文本、思考和调用参数暂存在 `live` 中，叠加到 UI。成功的 attempt 才提交模型消息；失败尝试的输出不会混入后续模型历史。
6. 有工具调用时提交调用事实，逐个执行工具、存档结果、保存图片引用，再进入下一步。没有工具调用则完成本轮。
7. 停止、绑定失效和异常走收尾逻辑；请求中止后到达的结果不能再作为成功消息提交。

step 数没有固定上限。工具默认执行超时为 15 秒；模型流的空闲超时是 600 秒。模型不再调用工具、发生不可恢复错误、上下文放不下或用户停止时结束。面板关闭与轮次停止是不同的操作。

`AgentSnapshot.phase` 包含 `restoring`、`idle`、`preparing`、`generating`、`executing-tools`、`compacting`、`stopping`、`storage-error`、`disposed`。会话模式 `persistent` / `temporary` / `read-only` 与运行阶段正交；例如只读会话也可以处于 idle，但不能发送。

## 事件是事实，投影负责读取

`Session.commit()` 是会话事实的写入入口。它为输入分配连续 `seq`、ID 和时间，校验 surface 操作，组成一个带校验和的批次。只有 `storage.append()` 成功后，才更新不可变日志、模型历史 surface、投影并通知订阅者。写入失败时保留原批次，进入 `storage-error`，通过“重试保存”重写相同批次，防止结果只出现在内存里。

三类读取内容需要区分：

| 内容 | 来源 | 用途 |
| --- | --- | --- |
| 持久事件日志 | `session.events` | 保留轮次、尝试、工具、压缩及指令的事实，支持恢复和导出 |
| 模型可见 surface | `Session.nodes` / `deriveMessages()` | 当前请求实际回放的消息序列；重生成或压缩可以改变它 |
| UI 与统计投影 | `sessionProjections` | `transcript`、`instructions`、`tokenUsage`、`contextPressure` 等读取模型 |

`session-projection` 用 `init/apply/view` 注册插件拥有的纯读取模型。恢复日志时 `reset()` 重建，提交后 `push()` 增量折叠。流式内容单独叠加在 transcript 上，不能作为持久事实提前写入投影。`useAgent()` 默认只展示最后 100 条 UI 消息，“加载更早”每次增加 50 条；它不裁剪存储或模型历史。

重生成从原轮次的 `baseSurface` 开始，通过 `surface/reset` 建立新的模型历史，transcript 替换原轮次的显示；旧事件仍可审计。压缩同样只替换模型可见的旧内容，界面仍可显示原始对话。

## 本地存储与恢复

`session-persistence` 定义 `SessionStorage`、批次校验和会话目录接口，`session-persistence-opfs` 提供生产实现：

- 会话按数据集分组，每个作用域最多 3 段；空白会话可以复用或在导入时让位。没有打开数据集时使用空数据集作用域。
- OPFS 保存版本头、`active.json` 指针、`events-N.jsonl` 分段和独立 artifact 文件。校验和用于检测记录损坏，不是认证签名。
- 写入权通过浏览器锁协调。同一会话在另一标签页已占用时，以只读模式打开；界面禁用发送。
- OPFS 或所需浏览器能力不可用时降级为内存会话，并显示刷新会丢失记录的提示。真正的日志损坏不应被静默当成空会话。
- 恢复时检查序号、批次和 surface，未完成的 attempt、step、compaction、turn 会补记中断；未完成工具写入 `TOOL_NOT_STARTED` 或 `TOOL_OUTCOME_UNKNOWN`，不会自动重复有副作用的操作。

`attachments` 将聊天图片和工具图片保存为 artifact，事件只保存引用，发请求前再 hydrate。`session-archive` 按需加载 `fflate`，把日志与被引用的附件导出为 ZIP；导入前在内存里校验批次、日志连续性、surface 和附件引用，再交给存储写入。

## 分析上下文绑定

结果页面通过轻量 bridge 注册 provider，并调用 `setAgentDataset()` / `markAgentDatasetReady()` 标记数据身份和加载代次。`analysis-binding` 捕获问题提交时的 `datasetId`、`generation`、页面状态和选择，生成数据集系统提示词与本轮上下文消息。

`agent/guard` 在轮次开始、每步开始和工具前后核对身份、代次及 ready 状态；需要时还核对工具对应的离子、像素、聚类或注释权重。切换数据集会停止当前轮次并打开新数据集的最近会话，防止旧工具结果落到新数据上。重新生成在同一数据集上保留原选择并更新加载代次；来自其他数据集的导入会话会重新捕获当前绑定。

## 模型通信与连接

`connection` 是读取用户设置和部署默认的唯一入口。用户填写密钥时使用用户这一组地址和密钥；用户没填密钥时使用部署这一组，避免把某组凭据发送到另一组地址。用户密钥明文保存在本机 `localStorage`，不写进会话 ZIP。

`llm` 提供统一的消息、工具 schema、流式事件和错误类型，`llm-anthropic` 是当前唯一协议适配器。端点规范化为带版本的基地址，默认请求 `https://api.anthropic.com/v1/messages`。适配器负责 AI SDK 转换、思考块回放和端点兼容性修正，其他插件不能直接依赖 `ai` / `@ai-sdk/*`。

开发环境中，部署默认端点经 `/llm-proxy`，BYOK 经 `/llm-relay` 并用 `x-llm-target` 传目标 origin；生产使用配置的实际地址，是否经过同源代理取决于部署。`model-catalog` 获取模型列表并以绿色小图实际探测识图能力，只有通过的模型才允许在设置界面保存；默认允许探测前 10 个，同时最多 4 个，更多由用户触发。

`llm-retry` 在 step 边界应用适配器的重试策略，每个 step 独立计数。鉴权等永久错误直接结束并显示；不要把适配器内部的协议兼容性修正与循环层的传输失败重试混为一谈。

`VITE_LLM_*` 默认密钥会进入前端包。Exa 搜索使用独立的可选 `VITE_EXA_API_KEY`，通过 `x-api-key` 仅发往 `https://mcp.exa.ai/mcp`；未配置时使用匿名额度。

## 预算、压缩和结果存档

`token-meter` 从同一份日志投影累计服务商用量与上下文压力。上下文窗口优先使用用户按端点/模型保存的值，再用端点元数据，最后回落到默认 256,000 tokens；循环输出预留为 `min(MAX_OUTPUT_TOKENS, floor(W/4))`。估算在附件还原前进行，已有服务商用量时用它校准。

压缩策略由 `compaction` 通过事件挂接：

- 请求前，输入估算达到 `floor(min(0.8W, W − O − min(65536, floor(W/4))))` 时压缩；常规压缩保留最近 `floor(0.16 × (W − O))` 的内容。
- 端点确认超窗时，每轮最多做一次超窗恢复；用户也可以手动压缩，不受阈值限制。
- 选区不拆工具调用与结果，不动正在执行的当前轮次；摘要请求回放原系统提示词、工具和原消息前缀，末尾追加压缩指令。
- 成功后以结构化 checkpoint 替换 surface 中的旧区间；摘要失败保持原历史。停止或存储失败仍按各自的中断、保存规则处理。

`tool-archive` 另行保存成功工具的完整文本。默认结果预算为 4,000 字符，证据类常用 12,000；超出时模型收到截断结果及 `read_archived_result` 提示，可按 offset 读回全文。这与对话摘要压缩是两个独立机制。

## 插件扩展点

| 事件 | 模式 | 生产用途 |
| --- | --- | --- |
| `agent/guard` | bail | `analysis-binding` 抛错终止失效绑定 |
| `agent/pre-turn` | waterfall | 追加随本轮一起提交的分析上下文 |
| `agent/pre-request` | serial | 检查预算并压缩，必要时重记请求快照 |
| `agent/request-error` | waterfall | 先尝试超窗压缩，再交给重试策略 |
| `agent/tool-result` | waterfall | 持久化完整结果，生成模型可见摘要 |
| `tools/pre-execute` | serial | 可返回 `{ kind: 'deny' }` 拒绝执行 |
| `tools/post-execute` | waterfall | 改写工具结果 |
| `tools/result` | emit | 只观察结果 |

工具按领域分为后端 API、页面上下文、离子图、化学知识、生物学、文献、网络搜索和技能加载。内置技能在 `plugins/skill-bundled/skills/*/SKILL.md`；技能是按需加载的工作流说明，不是另一个独立执行进程。化学、生物、文献和搜索工具在 schema 中加入引用约定，模型输出 Markdown 来源链接，由 `MarkdownLink.vue` / `InlineCitation.vue` 展示。

新增工具时，在领域插件注册 `defineTool()`，有新插件则加入组合表；新增协议时实现 `LlmAdapter`、注册到 `ctx.llm`，同时扩展端点类型和 profile。系统提示词用 `ctx.systemPrompt.section()` 按确定的 key/order 组合，相同输入保持相同字节有利于端点缓存。

ESLint 检查插件只能经彼此的 `index.ts` 引用、插件不能引用 UI、SDK 只能在适配器内使用、bridge 不能依赖运行时。行为重构还应运行 `behaviorLock.test.ts`，核对存储事件、模型请求、界面状态和提示词快照；浏览器回归覆盖见 [测试与 E2E](./testing)。
