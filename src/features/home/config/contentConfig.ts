/**
 * 首页展示内容（人来编辑的 `public/content.json`）。
 *
 * 与 `shared/config/runtimeConfig.ts` 的 `config.json` 是**两份不同用途的运行时配置**：
 * - config.json  ：全站都要用的部署开关（导航、分页、验证码……），在 main.ts 里阻塞 await；
 * - content.json ：只有首页用到的展示内容（团队、时间线、Hero 文案……）。
 *
 * 拆开是为了让首页那 5KB 不再压在全站启动的关键路径上。它由路由在进入 `/` 时与 HomeView
 * 的 chunk 并行加载（见 router/index.ts），因此 HomeView 及其子组件渲染时 `getContent()`
 * 必然已就位，用法与 `getConfig()` 完全一致，无需在组件里处理 pending 状态。
 *
 * 两份文件都在构建时原样拷贝到产物根目录，部署后可直接改、刷新即生效，无需重新构建。
 *
 * 放在 features/home/ 而不是 shared/config/：这份内容只服务首页，与它的消费者同处一个
 * feature 目录；也避开了 vite.config.ts 里为 `shared/config/` 设的分包特例（那条特例是为
 * runtimeConfig 的 `_config` 求值时序设的，与这里无关）。
 */

import type { LocalizedText } from '@/shared/config/localizedText'

/**
 * 功能展示项（FeatureScene 联动画廊的「联动单元」：词语 + 图片 + 卡片文案，按数组顺序一一对应）。
 *
 * 悬停画廊里第 i 张图时，左侧卡片同步展示第 i 项的 word/title/desc，实现「图 ↔ 卡片」联动。
 * - word:  画廊图片上方的词，如 'OPEN' / 'FAST' / 'INTELLIGENT'
 * - title: 左侧卡片标题（可选）
 * - desc:  左侧卡片描述（可选）
 * - image: 图片 URL（可选）；留空则回退到 hero.gallery 中同序号的图，便于先复用 Hero 的配图
 */
export interface FeatureItem {
  /** 画廊图片上方的词，如 'OPEN' */
  word: string
  /** 左侧卡片标题 */
  title?: LocalizedText
  /** 左侧卡片描述 */
  desc?: LocalizedText
  /** 图片 URL；留空回退到 hero.gallery 同序号图 */
  image?: string
}

/**
 * 版本时间线项。
 * - date:     时间节点，如 '2024 Q1'
 * - version:  版本号，如 '1.0' / '2.5'
 * - features: 该版本新增特性列表
 */
export interface TimelineItem {
  /** 时间节点 */
  date: LocalizedText
  /** 版本号 */
  version: string
  /** 版本更新特性 */
  features: LocalizedText[]
}

/**
 * 开发团队成员（非技术同学可直接编辑 content.json 的 `team`，刷新即生效）。
 *
 * - name:     姓名（可本地化，如 { "en": "Zongwei Cai", "zh-CN": "蔡宗苇" }）
 * - role:     职位 / 角色
 * - degree:   学位，如 'Ph.D.' / 'M.Sc.' / 'B.Sc.'（可选，不需要时填 "" 或删除该键）
 * - school:   学校 / 机构（可选）
 * - avatar:   头像 URL（OSS 链接）；留空或加载失败时，卡片自动回退为
 *             「姓名首字母 + 渐变背景」头像
 * - homepage: 个人主页链接；填写后整张卡片可点击跳转（新标签页打开），
 *             留空则卡片不可点击
 */
export interface TeamMember {
  /** 姓名（可本地化；中文页面显示中文名） */
  name: LocalizedText
  /** 职位 / 角色 */
  role: LocalizedText
  /** 学位，如 'Ph.D.' / 'M.Sc.' / 'B.Sc.' */
  degree?: LocalizedText
  /** 学校 / 机构 */
  school?: LocalizedText
  /** 头像 URL（OSS 链接）；可选 */
  avatar?: string
  /** 个人主页链接；填写后点击卡片跳转 */
  homepage?: string
}

/** GitHub 提交（commit）热力图配置（StatsScene 展示用） */
export interface GithubHeatmapConfig {
  /** GitHub 仓库拥有者，如 "BioNet-XMU" */
  owner: string
  /** GitHub 仓库名，如 "MassVision" */
  repo: string
  /** 统计哪个分支的提交，默认 "dev" */
  branch?: string
  /** 统计最近多少天，默认 365 */
  days?: number
  /** 热力图标题；缺省时显示 "{owner}/{repo} Commit Activity" */
  title?: LocalizedText
  /** 点击标题跳转的仓库页面地址；缺省时标题不可点击 */
  repoUrl?: string
  /** 热力图朝向：'auto'（大屏纵向/小屏横向，默认）| 'horizontal' | 'vertical' */
  orientation?: 'auto' | 'horizontal' | 'vertical'
}

/** 联系方式（FooterScene 的社交入口，逐项缺省即不显示该入口） */
export interface ContactInfo {
  /** 实验室 / 项目官网 */
  website?: string
  /** 主联系邮箱 */
  email?: string
  /** 备用联系邮箱 */
  emailAlt?: string
  /** GitHub 组织主页 */
  github?: string
  /** 微信公众号 / 二维码页面链接 */
  wechat?: string
  /** 学术招募页面链接 */
  recruitment?: string
}

/** content.json 的结构 */
export interface HomeContent {
  /** 首屏 Hero 区 */
  hero: {
    /** 轮播展示的标语（每行一句，可含符号，如 "FREE ∞"） */
    taglines: LocalizedText[]
    /** 悬停画廊：一组图片 URL，横向并排，悬停某张时展开放大；留空则不显示 */
    gallery?: string[]
  }
  /** 功能展示区（FeatureScene 联动画廊）；为空时该场景回退为占位标题 */
  features: {
    /** 联动单元列表，按序对应画廊从左到右的图片 */
    items: FeatureItem[]
  }
  /** 版本时间线；为空时不显示时间线区域 */
  timeline: TimelineItem[]
  /** 开发团队成员 */
  team: TeamMember[]
  /** 联系方式 */
  contact: ContactInfo
  /** GitHub 提交热力图；缺省时 StatsScene 不显示热力图 */
  githubHeatmap?: GithubHeatmapConfig
}

/**
 * 取不到内容时的兜底：首页各区块自身已处理「列表为空」的情况（画廊不渲染、时间线隐藏、
 * 社交入口不显示），因此降级后首页仍可正常打开，只是少了这些展示区，好过整页起不来。
 */
const EMPTY_CONTENT: HomeContent = {
  hero: { taglines: [], gallery: [] },
  features: { items: [] },
  timeline: [],
  team: [],
  contact: {},
}

let _content: HomeContent | null = null
let _pending: Promise<HomeContent> | null = null

/** 补齐缺省键，让消费端不必到处写 `?? []` */
function normalize(raw: Partial<HomeContent>): HomeContent {
  return {
    hero: raw.hero ?? { taglines: [], gallery: [] },
    features: raw.features ?? { items: [] },
    timeline: raw.timeline ?? [],
    team: raw.team ?? [],
    contact: raw.contact ?? {},
    githubHeatmap: raw.githubHeatmap,
  }
}

/**
 * 加载 content.json。由 `/` 路由与 HomeView 的 chunk 并行发起（见 router/index.ts）。
 * 加 no-cache 以便修改后刷新即可看到最新值。
 *
 * 与 loadConfig() 不同，这里**不会抛错**：内容拉取失败只该让首页少几个展示区，
 * 不该让路由 resolve 失败、整页白屏。重复调用复用同一个 Promise / 结果。
 */
export async function loadContent(): Promise<HomeContent> {
  if (_content) return _content
  if (_pending) return _pending

  const url = `${import.meta.env.BASE_URL}content.json`
  const pending = fetch(url, { cache: 'no-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.json() as Promise<Partial<HomeContent>>
    })
    .then((raw) => {
      _content = normalize(raw)
      return _content
    })
    .catch((err) => {
      console.error(`Failed to load ${url}; home page falls back to empty content.`, err)
      _content = EMPTY_CONTENT
      return _content
    })
    .finally(() => {
      _pending = null
    })

  _pending = pending
  return pending
}

/** 读取已加载的首页内容；在 loadContent() 完成前调用会抛错（属编程错误，用以暴露时序问题）。 */
export function getContent(): HomeContent {
  if (!_content) {
    throw new Error(
      'Home content not loaded yet. Ensure the route awaits loadContent() before use.',
    )
  }
  return _content
}
