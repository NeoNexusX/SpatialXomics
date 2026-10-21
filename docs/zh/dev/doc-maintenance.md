# 文档维护

文档使用 VitePress，源码位于 `docs/`，生产站点部署到 `/docs/`。用户指南和开发文档都维护中英文版本。

## 目录与 URL

```text
docs/
├── .vitepress/config.ts     # 站点、语言、导航、侧边栏和构建配置
├── .vitepress/theme/        # 自定义主题
├── archit_image/            # 独立架构图（自包含 HTML）
├── en/                      # 默认英文源文件
│   ├── guide/
│   └── dev/
└── zh/
    ├── guide/
    └── dev/
```

`rewrites` 会把英文源路径 `en/...` 改写为不带 `/en` 的 URL；中文保留 `/zh`。例如：

- `docs/en/guide/dataset-overview.md` → `/docs/guide/dataset-overview`
- `docs/zh/guide/dataset-overview.md` → `/docs/zh/guide/dataset-overview`

两种语言的同名文档**基名必须一致**（中文侧不使用编号前缀）。语言切换按钮按当前路径一对一映射到另一种语言，基名不一致会导致切换后 404。

## 修改和新增页面

修改现有 `.md` 后运行本地文档服务即可热更新。新增页面时：

1. 在 `docs/en` 和 `docs/zh` 下添加对应页面。
2. 在 `docs/.vitepress/config.ts` 的英文、中文 sidebar 中分别添加入口。
3. 更新所有引用旧路径的文档和代码注释。
4. 运行生产构建验证链接。

普通页面不强制 frontmatter，首个 `#` 标题会作为页面标题。需要自定义标题或大纲时可使用：

```markdown
---
title: 文档维护
outline: [2, 3]
---
```

## 链接和资源

- 同一目录优先用相对链接，如 `[数据集总览](./dataset-overview)`。
- 英文绝对站内路径不带 `/en`；中文路径需要 `/zh`。
- 当前 `ignoreDeadLinks` 只豁免以 `/mydatasets` 和 `/datasets` 开头的 SPA 路径；其他死链仍会让构建失败。它不是全局关闭死链检查。
- 截图等文档专用资源应放在 `docs/` 下明确的资源目录并使用相对链接，或使用稳定的外部地址。不要放进根 `public/`，否则会作为 SPA 静态文件发布且不属于文档导航。
- 架构图放在 `docs/archit_image/`，是自包含 HTML。每个节点标签在 `data-node-label`、`aria-label`、`<title>` 和 SVG `<text>` 里各存一份，改动时四处要一起改，信息卡备注也要同步对照代码。注意 `npm run docs:build` 不会把这些文件输出到 `dist-docs/`，因此线上 `/docs/` 站点访问不到它们——请从仓库直接打开；若需随文档发布，要另加构建步骤。
- 不要在文档中复制已失效接口或推测未来行为。以当前代码、运行时配置和接口契约为准。

VitePress 还支持提示容器、数学公式、emoji、`[[toc]]` 和代码导入。示例：

```markdown
::: warning 注意
这里写容易误用的当前限制。
:::
```

## 本地验证

```bash
npm run docs:dev         # http://localhost:5174/docs/
npm run docs:type-check  # VitePress 配置/主题类型
npm run docs:build       # 输出到 dist-docs/
npm run docs:preview     # 预览生产构建
```

`npm run dev` 会并行启动 SPA（5173）和文档（5174）。

## CI 和部署

- `test` 分支的 workflow 会运行 `npm run check` 和 `npm run docs:build`，随后在另一个 job 构建 SPA 并执行三个浏览器的 E2E。
- `docker/Dockerfile` 会在镜像构建中再次构建 SPA 和文档，并把 `dist-docs/` 复制到 Nginx 的 `/docs` 目录。
- `base: '/docs/'` 必须和 `docker/nginx.conf.template` 的路由保持一致。
- `.dockerignore` 默认排除根目录 `*.md`，但显式保留 `docs/**`，所以正式文档必须放在 `docs/` 内。

## 提交前检查

- [ ] 中英文内容都已同步。
- [ ] 新页面已加入两种语言的 sidebar。
- [ ] 接口、字段、限制和默认值已对照当前代码。
- [ ] 旧页面和错误内容已删除，没有留下重复入口。
- [ ] `npm run docs:type-check` 和 `npm run docs:build` 通过。
