# 测试与 E2E

项目使用 Vitest 验证组件、composable、服务和 agent 行为契约，使用 Playwright 在真实浏览器中验证完整交互。E2E 分为固定网络响应的离线回归和真实后端集成，两者在 `playwright.config.ts` 中隔离选择，不共用登录初始化。

## 检查入口

```bash
npm ci
npm run check              # 应用、工具和 E2E 类型检查 + ESLint + Vitest 覆盖率
npm run docs:type-check
npm run docs:build
npx playwright install     # 首次安装浏览器；Linux CI 使用 --with-deps
npm run test:e2e:offline   # 无需账号、后端和 LLM 密钥
```

`check` 不执行浏览器测试、文档构建或 `format:check`，需要分别运行。浏览器报告在 `playwright-report/`，失败截图和 trace 在 `test-results/`，两个目录都不提交。

## 离线浏览器回归

`*.offline.spec.ts` 仅由 `offline-chromium`、`offline-firefox`、`offline-webkit` 执行。这三个项目没有 `setup` 依赖，使用空 storage state、英文 locale 和 headless 模式。

```bash
npm run test:e2e:offline
# 定位单个浏览器或文件
npx playwright test --project=offline-chromium
npx playwright test e2e/agent.offline.spec.ts --project=offline-webkit
# 查看报告或某次失败的 trace
npx playwright show-report
npx playwright show-trace test-results/<case>/trace.zip
```

`e2e/fixtures/offline.ts` 创建每个测试独立的虚拟账号、连接和任务记录。它仅拦截网络和不可用存储的测试开关，应用依然加载实际的 Vue 页面、Cordis 组合表、Anthropic 适配器、工具执行器和浏览器 OPFS。模型响应采用 Messages SSE 协议事件，模型探测也经过真实适配器。开发中转和生产直连两种 URL 都由夹具处理。

需要真实 OPFS 的 WebKit 用例使用每例独立的临时持久 profile，结束后删除：本机 WebKit 的隐私 context 在原生 `navigator.storage.getDirectory()` 就返回 `UnknownError`，持久 profile 则可用。部分 WebKit 端口仍跨 profile 共享 origin 存储，因此夹具在加载应用前通过空白页清理测试 origin 的 localStorage 和 `sxo-sessions-v1`。持久化用例仍验证真实 OPFS，不用内存存储替代或跳过断言；临时会话降级用例和其他浏览器使用默认 context。并发运行时使用独立的 `E2E_PORT` 隔离 origin。

| 文件 | 覆盖的行为 |
| --- | --- |
| `agent.offline.spec.ts` | 实际探测并排除不支持图片的模型；保存与恢复连接；二次确认清除；设置切换保留草稿；Shift+Enter 与单次发送；工具调用及结果回传；永久错误和重新生成；取消及迟到响应隔离；OPFS 恢复与跨标签页只读；图片传输和 artifact 恢复；OPFS 不可用时的临时会话 |
| `workspace.offline.spec.ts` | 提交后才搜索、清空筛选和分页复位；每页数量；取消删除、确认删除、删除末页回退和统计刷新；删除失败后的提示及再次尝试；失败详情和运行中任务操作限制；401 清除登录状态并保留回跳路径 |

目前是 13 个场景，每个在三个浏览器执行，共 39 次。离线组还断言没有未配置的 API 请求及未捕获的页面错误，避免后端变化或浏览器异常悄悄被忽略。网络拦截严格匹配 API 路径，不能把 Vite 开发模块如 `/src/shared/api/httpClient.ts` 当成接口。

离线测试不验证真实后端契约、OSS Range 数据、算法结果质量或真实模型回答能力。它解决的是浏览器集成行为的可重复验证。

## 真实后端集成

原有 `chromium`、`firefox`、`webkit` 项目继续运行真实后端用例，并依赖 `setup`。`chromium-zh` 只执行中文冒烟 `i18n-zh.spec.ts`。离线文件不会混入这四个项目。

```bash
# 在当前 shell 注入测试账户，不要把真实凭据写进测试或命令历史
export E2E_USERNAME='<test account>'
export E2E_PASSWORD='<test password>'
npx playwright test --project=chromium
# 全部项目：包含离线组、真实后端组和中文冒烟
npm run test:e2e
```

`auth.setup.ts` 通过登录页获取真实登录态，保存到被 gitignore 的 `.auth/user.json`。`env/` 中的 Vite 环境文件不会自动注入 Playwright 的 Node 进程，测试账号需要 shell 或 CI 显式提供。缺少账号只影响需要 setup 的真实后端组。

现有集成覆盖认证、数据集、上传、集合、公开分享总览、数据库、分析任务与可视化、工作区、响应式和中文路由文案。涉及算法的测试使用 `e2e/utils.ts` 中约定的真实 MSI 数据集；不要用没有光谱的合成 imzML 去断言任务成功。资源创建后应清理；环境缺少可选数据时的 skip 必须有明确原因，不能用它掩盖产品断言失败。

本地 Playwright 自动启动或复用 5173 的 SPA 开发服务器；`CI=true` 时启动 4173 的 preview，必须先 `npm run build`。真实后端集成需要可用的 `/api`：开发环境用 Vite proxy，生产预览的后端访问方式应由运行环境提供，固定响应组不依赖该代理。

正在运行其他开发或测试服务时，可用 `E2E_PORT=5193 npm run test:e2e:offline` 同时修改测试 URL 和自动启动服务的端口，避免复用别的进程。

## Agent 行为锁与浏览器测试的分工

`src/features/agent/__tests__/behaviorLock.test.ts` 在 Vitest 中用固定依赖跑生产插件组合，逐字节比较持久事件、请求、UI 状态和系统提示词。它覆盖数据绑定、工具错误、自动重试、上下文压缩、图片、存储失败和恢复等大量分支，但不启动浏览器，不能替代 E2E 对 OPFS、锁、文件选择和组件接线的验证。

```bash
npx vitest run src/features/agent/__tests__/behaviorLock.test.ts
npx vitest run src/features/agent
```

只有有意修改行为并审查快照差异后，才用 `-u` 更新行为锁。重构时不应为让测试变绿而直接接受新快照。完整设计见 [Agent 架构](./agent-architecture)。

## 新增用例和 CI

优先断言用户看得到的结果与关键请求内容。使用 role、label、placeholder 定位；遇到重复标题或对话名称时先限定消息 log、表格行或弹窗。用 locator 自动等待、`expect.poll()` 或明确的请求事件同步，不添加固定 sleep，也不以 `networkidle` 作为流式 agent 完成的判断。

新的网络夹具应匹配当前 API 的方法、路径、body 和分页结构。OPFS 恢复、跨标签页锁和图片 artifact 要使用真实浏览器能力；需要降级测试时单独关闭能力。每个测试使用独立 context，不依赖前一个测试留下的账号、任务或会话。

`test` 分支 CI 先执行 `check` 和文档构建，再独立执行两个浏览器 job：`e2e-offline` 构建生产 SPA 后跑三个离线项目，不读取账号 secrets；`e2e` 跑三个真实后端项目和中文冒烟，使用账号 secrets。两组分别上传报告、截图和 trace，保留 7 天。离线组通过不代表真实后端组通过，报告中应明确区分。
