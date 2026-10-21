# SpatialXomics

[English](README.en.md) | 简体中文

SpatialXomics 是一个面向质谱成像（MSI）的 Web 数据管理与分析平台。前端使用 Vue 3、TypeScript 和 Vite，支持 imzML 数据上传、公开/私有数据集管理、可配置预处理、Zarr 结果可视化、注释匹配、ROI 与区域比较。

## 主要功能

- **认证与权限**：登录、注册、找回密码、个人资料、管理员用户管理，以及受保护路由。
- **数据集管理**：浏览公开数据集，管理自己的数据集，查看元数据、分享公开详情页，以及下载原始 `.imzML` / `.ibd` 文件对。
- **数据集合**：把相关公开数据集组织成带学术元数据和有序成员列表的数据集合。
- **上传管线**：浏览器 Worker 计算 MD5、服务端查重、流式 ZIP64 压缩、阿里云 OSS 分片上传，以及同浏览器内的断点续传。
- **分析工作区**：按数据的 spectrum/storage mode 展示兼容的降噪、基线校正、归一化、峰提取和峰对齐方法。
- **结果可视化**：Continuous 离子图和平均谱、Processed TIC 图和逐像素谱、显示范围/Gamma/配色/TIC 归一化、透明背景 PNG 导出。
- **聚类与区域分析**：后端生成 UMAP，浏览器本地执行 KMeans；支持聚类筛选、矩形/自由形状 ROI、多区域组合比较。
- **注释**：Continuous + Centroid 结果使用平均谱峰与注释库 CSV 匹配，支持 ppm/Da 容差、评分与 FDR、筛选、导出和 PubChem 查询；注释库可自备 CSV 或从平台参考库一键导入。
- **参考数据库**：登录后浏览 HMDB 4.0 代谢物参考库，支持编号/名称/分子式检索、来源与质量区间筛选、PubChem/HMDB 条目外链和整库 CSV 下载；注释面板可直接导入该库。

## 技术栈

| 分类 | 技术 |
|---|---|
| 核心 | Vue 3、TypeScript、Vite 7、Pinia、Vue Router |
| UI | Tailwind CSS v4、DaisyUI v5、Iconify 离线图标子集 |
| 可视化 | ECharts、Canvas、vue3-calendar-heatmap |
| MSI/Zarr | 自研 Zarr v3 分块读取器、zstddec、`@zip.js/zip.js`、hash-wasm、ml-kmeans |
| 网络与存储 | Axios、ali-oss（STS 临时凭证） |
| 网络与存储 | Axios、ali-oss（STS 临时凭证） |
| AI 助手 | cordis、@tdesign-vue-next/chat |
| 测试 | Vitest、Playwright |
| 文档 | VitePress（中英文） |

准确版本以 [package.json](package.json) 为准。

## 目录结构

```text
src/
├── app/                         # 应用外壳、导航与全局入口组件
├── assets/                      # 样式和主题资源
├── features/                    # 按业务领域组织的功能
│   ├── assistant/               # AI 助手：悬浮窗聊天 + BYOK（对已登录用户默认开启）
│   ├── auth/                    # 登录、注册、找回密码表单逻辑
│   ├── collections/             # 带学术元数据的数据集合
│   ├── datasets/                # 数据集列表、详情、分享、下载
│   ├── home/                    # 首页场景、统计和提交热力图
│   ├── upload/                  # imzML 解析、压缩、查重和续传
│   ├── users/                   # 管理员用户管理
│   ├── vizworkbench/            # 离子图、谱图、聚类、ROI 与注释
│   └── workspace/               # 分析构建器和任务看板
├── router/                      # 路由与认证/管理员守卫
├── services/                    # Zarr（含 OSS client）、聚类和 PubChem 服务
├── shared/                      # 跨业务共享的 API、认证、组件、配置和工具
├── views/                       # 路由页面
└── workers/                     # 跨功能 Worker（上传 ZIP）；功能专用 Worker 与功能同目录

docs/                            # VitePress 中英文文档
e2e/                             # Playwright 测试
env/                             # Vite 环境变量
public/config.json               # 无需重新构建即可调整的全站运行时配置
public/content.json              # 首页展示内容（团队、时间线、Hero 文案）
docker/                          # Docker/nginx 部署
```

## 本地开发

### 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- npm（使用仓库中的 `package-lock.json`）

### 安装

```bash
npm ci
```

### 环境配置

仓库已提供以下文件：

- `env/.env`：`VITE_API_BASE`、`VITE_OSS_ENDPOINT` 等公共值。
- `env/.env.development`：开发服务器的 `VITE_BACKEND_URL`。
- `env/.env.production`：生产构建/预览使用的值。

本机覆盖请创建不会提交的 `env/.env.development.local`，例如：

```bash
VITE_BACKEND_URL=http://localhost:8000
```

开发环境的 `/api` 请求由 Vite 代理到 `VITE_BACKEND_URL`。生产容器由 nginx 把 `/api/` 代理到运行时传入的 `BACKEND_HOST:BACKEND_PORT`。

### 启动

```bash
npm run dev       # 同时启动 SPA（5173）和文档站（5174）
npm run dev:app   # 只启动 SPA
```

### 构建与检查

```bash
npm run build             # 类型检查 + SPA 构建，输出 dist/
npm run check             # 类型检查 + ESLint + 单元测试
npm run test:unit:run     # 单次运行单元测试
npm run test:e2e          # Playwright E2E
npm run docs:build        # 文档构建，输出 dist-docs/
npm run icons:bundle      # 更新离线图标子集
```

`npm run format` 仅格式化 `src/`；Markdown 文档需按原格式手动维护。

## 运行时配置

应用启动时先加载 `public/config.json`，再挂载 Vue。该文件控制应用名称、导航、分页、验证码和 Zarr 读取参数；缺失或格式错误时应用会显示启动失败页。

首页展示内容（Hero 文案、功能展示、时间线、团队、联系方式、提交热力图）拆在 `public/content.json`，只在进入首页时加载，取不到时首页降级为不显示这些区块。两份文件都可在部署后直接修改、刷新即生效。

表单下拉选项与离子源必填规则不再走 JSON，已编译进代码（`src/features/datasets/constants/datasetMetadata.ts`、`src/features/upload/utils/ionSourceRules.ts`），修改后需重新构建。

## 文档与部署

- 用户与开发文档位于 `docs/`，本地地址为 `http://localhost:5174/docs/`。
- Docker 镜像同时包含 `dist/` 和 `dist-docs/`，nginx 分别服务 SPA 与 `/docs/`。
- `test` 分支运行检查、文档构建和三浏览器 Playwright；`dev` 与 `main` 分支分别触发对应环境部署。

文档维护流程见 [docs/zh/dev/文档维护.md](docs/zh/dev/文档维护.md)。
