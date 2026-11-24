# SpatialXomics

[English](README.en.md) | 简体中文

SpatialXomics 是一个面向质谱成像（MSI）的 Web 数据管理与分析平台：从 imzML 数据上传、公开/私有数据集管理，到可配置的预处理、Zarr 结果可视化、注释匹配、ROI 与区域比较，以及围绕当前数据集对话的 SXO-Harness 助手。

本仓库包含前端应用（Vue 3 + TypeScript + Vite）和 VitePress 文档站。认证、数据文件与计算任务由独立部署的后端提供，前端通过同源 `/api` 访问；仓库内没有后端服务端代码。

## 主要功能

- **账户与权限**：注册、登录、找回密码、个人资料、管理员用户管理，以及需要登录的路由守卫。
- **数据集**：浏览公开数据集、管理私有数据集、查看元数据、通过 `public_id` 或分享令牌访问公开详情页，下载原始 `.imzML` / `.ibd` 文件对。
- **数据集合**：把相关公开数据集组织成带学术元数据和有序成员列表的数据集合，支持公开分享页。
- **上传管线**：浏览器 Worker 计算 MD5、服务端查重、流式 ZIP64 压缩、阿里云 OSS 分片上传（STS 临时凭证），以及同一浏览器内的断点续传。
- **分析工作区**：按数据的 spectrum / storage mode 展示兼容的降噪、基线校正、归一化、峰提取和峰对齐方法，并管理分析任务。
- **结果可视化**：Continuous 离子图与平均谱、Processed TIC 图与逐像素谱；显示范围、Gamma、配色、TIC 归一化；离子图可导出 JPG（默认）或透明背景 PNG。
- **聚类与区域分析**：后端生成 UMAP，浏览器本地执行 KMeans；聚类筛选、矩形/自由形状 ROI、多区域组合比较，以及掩膜的导入导出。
- **注释**：Continuous + Centroid 结果用平均谱峰与注释库 CSV 匹配，支持 ppm/Da 容差、评分与 FDR、筛选、导出和 PubChem 查询；注释库可自备 CSV，也可从平台参考库一键导入。
- **参考数据库**：登录后浏览 HMDB 4.0 代谢物参考库（后端 `SI_DB` 接口，带来源列），支持编号/名称/分子式检索、来源与质量区间筛选、PubChem/HMDB 外链和整库 CSV 下载。
- **新闻**：公告与版本更新列表及详情页；条目为构建期编译的 Markdown，按语言分目录维护。
- **SXO-Harness 助手**：登录后在首页或数据集可视化页打开悬浮对话面板，围绕当前数据集提问。它读取离子图、统计、注释、聚类与页面状态，也可调用 PubChem、ChEBI、HMDB、KEGG、文献检索和联网搜索，外部来源以引用卡片展示。详见 [SXO-Harness 助手](#sxo-harness-助手)。

## 技术栈

| 分类 | 技术 |
|---|---|
| 核心 | Vue 3、TypeScript、Vite 7、Pinia、Vue Router |
| UI | Tailwind CSS v4、DaisyUI v5、reka-ui、离线 Iconify 图标子集 |
| 可视化 | ECharts、Canvas、vue3-calendar-heatmap |
| MSI / Zarr | 自研 Zarr v3 分块读取器、zstddec、`@zip.js/zip.js`、hash-wasm、ml-kmeans |
| 网络与存储 | Axios、ali-oss（上传用 STS 临时凭证）、OPFS（助手会话） |
| SXO-Harness | @deepseek-ai/cordis、AI SDK（`@ai-sdk/anthropic`）、comark、KaTeX、Shiki、Exa 联网搜索 |
| 测试 | Vitest、Playwright |
| 文档 | VitePress（中英文） |

准确版本以 [package.json](package.json) 为准。

## 目录结构

```text
src/
├── app/                         # 应用外壳、导航与全局入口组件
├── assets/                      # 样式和主题资源
├── features/                    # 按业务领域组织的功能
│   ├── agent/                   # SXO-Harness：助手运行时、插件与悬浮面板
│   ├── auth/                    # 登录、注册、找回密码表单逻辑
│   ├── collections/             # 带学术元数据的数据集合
│   ├── databases/               # 参考数据库浏览（HMDB 4.0 / SI_DB 数据源）
│   ├── datasets/                # 数据集列表、详情、分享、下载
│   ├── home/                    # 首页场景、统计和提交热力图
│   ├── news/                    # 公告与版本更新（Markdown 内容）
│   ├── upload/                  # imzML 解析、压缩、查重和续传
│   ├── users/                   # 管理员用户管理
│   ├── vizworkbench/            # 离子图、谱图、聚类、ROI 与注释
│   └── workspace/               # 分析构建器和任务看板
├── i18n/                        # vue-i18n 实例与按命名空间拆分的语言包
├── router/                      # 路由与认证/管理员守卫
├── services/                    # Zarr（含 HTTP 读取客户端）、聚类和 PubChem 服务
├── shared/                      # 跨业务共享的 API、认证、组件、配置和工具
├── views/                       # 路由页面
└── workers/                     # 跨功能 Worker（上传 ZIP）；功能专用 Worker 与功能同目录

docs/                            # VitePress 中英文文档（zh/、en/）
e2e/                             # Playwright 测试与离线夹具
env/                             # Vite 环境变量（envDir 指向这里）
public/config.json               # 无需重新构建即可调整的全站运行时配置
public/content.json              # 首页展示内容（团队、时间线、Hero 文案）
scripts/                         # 构建、图标子集、正式配置覆盖等脚本
docker/                          # Dockerfile、nginx 模板与容器入口脚本
```

## 本地开发

### 环境要求

- Node.js `>=22.12.0`（见 `package.json` 的 `engines`）
- npm（使用仓库中的 `package-lock.json`）

### 安装

```bash
npm ci
```

### 环境配置

`env/` 是 Vite 的 `envDir`，仓库已提供以下文件：

| 文件 | 内容 |
|---|---|
| `env/.env` | 所有环境共享的公共值：`VITE_API_BASE`、`VITE_OSS_ENDPOINT` |
| `env/.env.development` | 开发服务器代理目标 `VITE_BACKEND_URL` |
| `env/.env.production` | 生产构建/预览使用的值；需要部署级默认连接时补 `VITE_LLM_PROXY_URL`、`VITE_LLM_API_KEY`、`VITE_LLM_MODEL` |
| `env/config.prod.overrides.json` | 正式环境 `config.json` 的覆盖项（见[部署](#部署)） |

本机覆盖写入不会被提交的 `env/.env.development.local`：

```bash
VITE_BACKEND_URL=http://localhost:8000
```

指向测试服 nginx 时地址要带上 `/api`（例如 `https://sxo.neonexus.top/api`）：Vite 代理会先去掉浏览器的 `/api` 前缀，再把 target 路径拼上去；直连后端端口时则填后端 origin（如 `http://localhost:8000`）。

`VITE_BACKEND_URL` 只影响开发环境的 Vite 代理；生产容器由 nginx 把 `/api/` 转发到运行时传入的 `BACKEND_HOST:BACKEND_PORT`。开发环境的助手请求也经 Vite 转发：部署默认端点走 `/llm-proxy`，用户自填端点走 `/llm-relay`（目标 origin 放在 `x-llm-target` 头里），避免本机代理干扰 SSE 流。

所有 `VITE_*` 变量都会编译进浏览器包：`VITE_LLM_API_KEY` 只能放中转站的受限子 key，`VITE_EXA_API_KEY` 也只能放可公开的 Exa 子 key，不要放官方主 key。

### 启动

```bash
npm run dev       # 同时启动 SPA（5173）和文档站（5174）
npm run dev:app   # 只启动 SPA
```

### 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` / `dev:app` | 启动开发服务器（SPA 与文档站） |
| `npm run build` | 类型检查 + SPA 构建，输出 `dist/` |
| `npm run preview` | 本地预览 `dist/` 构建产物 |
| `npm run check` | 类型检查 + ESLint + 单元测试（CI 使用） |
| `npm run lint` / `lint:check` | ESLint 自动修复 / 只检查 |
| `npm run format` / `format:check` | Prettier 格式化 `src/` / 检查 |
| `npm run test:unit` / `test:unit:run` | 监听模式运行 Vitest / 单次运行并生成覆盖率 |
| `npm run test:e2e` / `test:e2e:offline` | Playwright 真实后端回归 / 离线回归 |
| `npm run docs:dev` / `docs:build` / `docs:preview` | 文档站开发 / 构建 / 预览 |
| `npm run docs:type-check` | 文档站配置与组件类型检查 |
| `npm run icons:bundle` | 重新生成离线图标子集 |

`npm run format` 仅格式化 `src/`；Markdown 文档按原格式手动维护。

## SXO-Harness 助手

助手运行在浏览器内，围绕当前打开的数据集回答分析问题；它只读取现有数据与结果，不会启动预处理、修改注释或重新聚类。

### 面板与能力

- 登录后在首页、数据集可视化等带导航球的页面打开；面板可拖动、缩放，关闭面板不会销毁运行时或中止正在执行的轮次。
- 在数据集页提问时，助手捕获提交时刻的选中离子、像素、聚类与注释权重作为本轮分析上下文；页面选择之后再变，本轮不会使用新选择。
- 会话按数据集分组保存在浏览器 OPFS；同一会话在另一标签页打开时为只读，OPFS 不可用时降级为内存会话并提示刷新会丢失记录。
- 工具完整结果超过预算时先存档（默认 4,000 字符，证据类 12,000），模型可再按 offset 读回全文；对话历史接近上下文上限时自动压缩，界面仍保留原文。

### 模型连接

- 助手目前只支持 **Anthropic Messages 协议**（`/v1/messages`）的端点，OpenAI Chat Completions 等其他协议不能直接使用。
- 用户填写的地址与密钥只保存在本机 `localStorage`，不经过平台后端；用户这一组与部署默认一组不会混用。
- 部署默认连接需要同时配置 `VITE_LLM_PROXY_URL` 与 `VITE_LLM_API_KEY`，模型名由 `VITE_LLM_MODEL` 或用户选择决定。
- 「获取可用模型」会拉取端点模型列表并逐个发送一张小图做多模态探测，只有通过的模型才能保存；上下文上限默认 256,000 tokens，可按端点与模型保存。
- 会话指令可导入 `.md` / `.txt`（如 `AGENTS.md`，最大 64 KiB），随当前对话保存并进入系统提示词。

### 工具目录

工具由 Cordis 插件注册，共 9 个领域、30 个工具；页面类工具支持排名窗口翻页（默认 1–10，页上限 25，模型按返回的游标续页）。

| 领域插件 | 工具 | 说明 |
|---|---|---|
| `tool-page-context` | `get_page`、`get_dataset`、`get_ion`、`get_annotation`、`get_kmeans`、`get_umap`、`get_mean_spectrum_top_peaks`、`get_pixel_spectrum` | 页面快照、数据集信息、离子视图、注释行（窗口/精确两种模式）、聚类与 UMAP、谱峰与像素谱 |
| `tool-ion-image` | `get_ion_image_by_ranks`、`get_ion_image_by_mzs` | 按注释面板 rank 或显式 m/z 出热图，1–4 张独立出图，更多拼 montage |
| `tool-knowledge` | `pubchem_compound_lookup`、`pubchem_formula_search`、`chebi_lookup`、`hmdb_lookup` | 化学身份核验；HMDB 读 Wayback 归档 XML 的官方条目 |
| `tool-kegg` | `kegg_find`、`kegg_compound`、`kegg_pathway`、`kegg_pathway_annotations`、`kegg_mass_search` | 运行时查询 KEGG 官方 REST API，无本地索引；通路注释扫描覆盖全部已加载注释行 |
| `tool-literature` | `pubmed_search`、`europepmc_search` | 文献检索 |
| `tool-web-search` | `web_search` | Exa 联网搜索（匿名额度或 `VITE_EXA_API_KEY`） |
| `tool-backend-api` | `list_files`、`list_my_files`、`get_file_metadata`、`list_my_processes`、`get_user_quota` | 文件、任务与配额查询 |
| `tool-archive` | `read_archived_result` | 按 offset 读回被截断的存档结果 |
| `tool-skill` | `skill` | 按需加载内置技能正文 |

外部查询走同源中继，自定义托管需要一并配置转发：

| 路径 | 上游 | 限制 |
|---|---|---|
| `/kegg-rest/` | `https://rest.kegg.jp/` | 全站共享 3 次/秒，`burst=10`，仅 GET |
| `/hmdb-archive/` | `https://web.archive.org` 的 HMDB 代谢物 XML | 2 次/秒，仅允许 `HMDB` 开头的条目路径 |

每次 KEGG 工具调用最多发一个上游请求。`kegg_find` 的一个 `query` 可以包含多个按 AND 匹配的关键词。化合物和通路详情每次接受 1–10 个 ID，更多 ID 由 Agent 分次提交。`kegg_pathway(membersOf=[...])` 一次取得多个通路的成员编号，`kegg_mass_search` 每次查询一个 m/z 和一个指定加合物。

HMDB 归档站不返回浏览器所需的 CORS 头，因此 XML 必须经 `/hmdb-archive/` 取回，中继失败时工具降级为只给链接，不编造数据。

### 内置技能

`src/features/agent/plugins/skill-bundled/skills/` 下共 8 个按需加载的工作流说明：

`msi-analysis`、`annotation-review`、`adduct-isotope-analysis`、`ion-image-interpretation`、`metabolite-biology`、`literature-evidence`、`web-research`、`report-writing`。

技能是提示词层面的工作流，不是独立执行进程；模型在需要时通过 `skill` 工具读取正文。

## 运行时配置

- **`public/config.json`**：应用启动时先加载，再挂载 Vue。控制应用名称与版本、导航形态、分页、验证码、轮播、Zarr 读取参数和 OSS 预览域名；缺失或格式错误时应用显示启动失败页。
- **`public/content.json`**：首页展示内容（Hero 文案、功能展示、时间线、团队、联系方式、提交热力图），只在进入首页时加载；取不到时首页降级为不显示这些区块。
- **新闻内容**：`src/features/news/content/<locale>/*.md`，文件名以日期开头，版本更新以 `-v<版本号>` 结尾；构建期编译，新增或修改后需重新构建。
- 两份 `public/*.json` 都可以在部署后直接修改、刷新即生效；表单下拉选项与离子源必填规则已编译进代码（`src/features/datasets/constants/datasetMetadata.ts`、`src/features/upload/utils/ionSourceRules.ts`），修改后需重新构建。
- 正式环境专属的配置差异只维护在 `env/config.prod.overrides.json`，构建前执行 `node scripts/apply-prod-config.mjs` 深合并进 `public/config.json`（递归合并对象，数组与标量整体替换）；本地跑过该脚本后请还原 `public/config.json`。

## 测试

| 命令 | 覆盖范围 |
|---|---|
| `npm run test:unit:run` | Vitest 单元测试 + 覆盖率 |
| `npm run test:e2e` | 默认 Playwright 项目：Chromium、Firefox，以及中文冒烟；真实后端需 `E2E_USERNAME` / `E2E_PASSWORD`，WebKit 需 `E2E_WEBKIT=1` |
| `npm run test:e2e:offline` | `offline-chromium` + `offline-firefox`，使用离线夹具，无需账号、后端和模型密钥 |

- 离线回归不需要登录初始化；使用独立端口可跑 `E2E_PORT=5193 npm run test:e2e:offline`。
- 单元测试与行为重构测试覆盖会话事件、模型请求、界面状态和系统提示词快照（`src/features/agent/__tests__/behaviorLock.test.ts`）；`e2e/tools.offline.spec.ts` 会把每个助手工具在真实插件组合下返回的文本与图片原样落盘，用于评审工具描述与输出。
- CI（`.github/workflows/test.yml`）在 `test` 分支运行 `npm run check`、`docs:type-check`、`docs:build`，再构建 SPA 跑 Playwright；外部 fork 的 PR 拿不到密钥，只跑离线组。

## 部署

- `docker/Dockerfile` 为多阶段构建：`node:22-alpine` 内 `npm ci`、`npm run build`、`npm run docs:build`，产物 `dist/` 与 `dist-docs/` 复制到 nginx 镜像，文档挂在 `/docs/`。
- `docker/entrypoint.sh` 用 `envsubst` 把模板里的 `BACKEND_HOST` / `BACKEND_PORT` 替换为运行时值（默认 `host.docker.internal:8000`），校验配置后启动 nginx；缺少 brotli 模块时自动降级为 `gzip_static`。
- nginx 同时负责：静态资源长缓存与预压缩产物（`.gz` / `.br`）、`/api/` 反向代理（10 GB 请求体、300 s 超时）、`/kegg-rest/` 与 `/hmdb-archive/` 中继、Vue Router history fallback，以及 `/docs/` 文档站独立 fallback。
- 正式构建前执行 `node scripts/apply-prod-config.mjs` 合并正式配置覆盖（`deploy-main.yml` 已接入）。
- 分支流程：`test` 分支跑检查与测试；推送到 `dev` 构建镜像（tag 为 commit SHA）并部署开发服务器；推送到 `main` 构建并部署正式环境（tag 为 `latest`）。

## 文档

- 用户与开发文档位于 `docs/`，本地地址 `http://localhost:5174/docs/`；线上由 nginx 在 `/docs/` 提供。
- 维护流程见 [文档维护](docs/zh/dev/doc-maintenance.md)（[English](docs/en/dev/doc-maintenance.md)）。
- 开发参考：[前端架构](docs/zh/dev/frontend-architecture.md)、[Agent 架构](docs/zh/dev/agent-architecture.md)、[测试与 E2E](docs/zh/dev/testing.md)（[English](docs/en/dev/frontend-architecture.md)）。
- 用户指南从 [快速开始](docs/zh/guide/getting-started.md) 进入，包含数据上传、可视化、注释、参考数据库与助手的使用说明。
