import { defineConfig } from 'vitepress'

// ============================================================
// VitePress 文档站配置（i18n）
//   - 与前端 SPA 共用同一仓库 / 同一 nginx
//   - 产物为纯静态文件，构建输出到项目根 dist-docs/，
//     由 docker/Dockerfile 拷贝到 nginx 的 /docs 路径下
//   - base 必须与 docker/nginx.conf.template 的 location /docs/ 对齐
//
//   层级：语言（最高） → 分类（dev / ...） → 文档
//     docs/en/dev/*.md  → 默认语言 English，URL 去掉 /en 前缀
//     docs/zh/dev/*.md  → 简体中文，URL 带 /zh 前缀
// ============================================================

const REPO = 'https://github.com/NeoNexusX/MassVision'
const YEAR = new Date().getFullYear()

const en = {
  nav: [
    { text: 'Guide', link: '/guide/getting-started' },
    { text: 'Development', link: '/dev/tech-stack' },
  ],
  sidebar: {
    '/guide/': [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Account Management', link: '/guide/account-management' },
          { text: 'Finding Datasets', link: '/guide/finding-datasets' },
          { text: 'Collections', link: '/guide/collections' },
          { text: 'Dataset Overview', link: '/guide/dataset-overview' },
          { text: 'Data Visualization', link: '/guide/data-visualization' },
          { text: 'Database', link: '/guide/database' },
          { text: 'Upload Data', link: '/guide/upload-data' },
          { text: 'Dataset Analysis', link: '/guide/dataset-analysis' },
          { text: 'Workspace', link: '/guide/workspace' },
          { text: 'Navigation', link: '/guide/navigation' },
        ],
      },
    ],
    '/dev/': [
      {
        text: 'Development',
        items: [
          { text: 'Tech Stack', link: '/dev/tech-stack' },
          { text: 'Frontend Architecture', link: '/dev/frontend-architecture' },
          { text: 'Icon Guidelines', link: '/dev/icon-guidelines' },
          { text: 'Documentation Maintenance', link: '/dev/doc-maintenance' },
        ],
      },
    ],
  },
  // 「在 GitHub 上编辑此页」链接（:path 会替换成源文件相对路径）
  editLink: {
    pattern: `${REPO}/edit/main/docs/:path`,
    text: 'Edit this page on GitHub',
  },
  lastUpdated: { text: 'Last Updated' },
  footer: { copyright: `Copyright © ${YEAR} @Bionet Team` },
}

const zh = {
  nav: [
    { text: '指南', link: '/zh/guide/getting-started' },
    { text: '开发', link: '/zh/dev/tech-stack' },
  ],
  sidebar: {
    '/zh/guide/': [
      {
        text: '指南',
        items: [
          { text: '快速开始', link: '/zh/guide/getting-started' },
          { text: '账户管理', link: '/zh/guide/account-management' },
          { text: '查找数据集', link: '/zh/guide/finding-datasets' },
          { text: '数据集合', link: '/zh/guide/collections' },
          { text: '数据集总览', link: '/zh/guide/dataset-overview' },
          { text: '数据可视化', link: '/zh/guide/data-visualization' },
          { text: '数据库', link: '/zh/guide/database' },
          { text: '上传数据集', link: '/zh/guide/upload-data' },
          { text: '数据集分析', link: '/zh/guide/dataset-analysis' },
          { text: '工作区', link: '/zh/guide/workspace' },
          { text: '导航说明', link: '/zh/guide/navigation' },
        ],
      },
    ],
    '/zh/dev/': [
      {
        text: '开发',
        items: [
          { text: '技术栈', link: '/zh/dev/tech-stack' },
          { text: '前端架构边界', link: '/zh/dev/frontend-architecture' },
          { text: '图标使用规范', link: '/zh/dev/icon-guidelines' },
          { text: '文档维护', link: '/zh/dev/doc-maintenance' },
        ],
      },
    ],
  },
  editLink: {
    pattern: `${REPO}/edit/main/docs/:path`,
    text: '在 GitHub 上编辑此页',
  },
  lastUpdated: { text: '最后更新于' },
  docFooter: { prev: '上一页', next: '下一页' },
  footer: { copyright: `版权所有 © ${YEAR} @Bionet Team` },
}

export default defineConfig({
  base: '/docs/',          // 部署在站点的 /docs/ 子路径下
  outDir: '../dist-docs',  // 输出到项目根 dist-docs（供 Dockerfile 拷贝）
  title: 'SpatialXomics',
  description: 'SpatialXomics 项目文档',
  // English 为默认语言：源文件放 en/，URL 去掉 /en 前缀（服务于 /docs/）
  rewrites: { 'en/:rest*': ':rest*' },
  // ignoreDeadLinks 保持默认 false：死链即构建失败，靠修链接保证文档质量
  // 豁免 SPA 路由路径：/mydatasets 和 /datasets 是前端路由，非文档页面
  ignoreDeadLinks: [/^\/mydatasets/, /^\/datasets/],
  lastUpdated: true,       // 启用「最后更新时间」（读取 git 提交时间）
  markdown: {
    math: true,            // 数学公式（需依赖 markdown-it-mathjax3）
    // 提示容器(::: tip/warning/danger/details)、代码导入(<<< @/path)、
    // emoji(:tada:)、目录([[toc]]) 均为 VitePress 默认开启，无需额外配置
  },
  // 站点级共享主题配置（各 locale 的 themeConfig 会在此基础上合并）
  themeConfig: {
    search: { provider: 'local' }, // 站内全文搜索：纯前端，无需后端服务
    socialLinks: [{ icon: 'github', link: REPO }],
  },
  locales: {
    root: { label: 'English', lang: 'en', themeConfig: en },
    zh: { label: '简体中文', lang: 'zh-CN', link: '/zh/', themeConfig: zh },
  },
})
