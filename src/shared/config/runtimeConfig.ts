/**
 * 运行时配置（人来编辑的 public/config.json）。
 *
 * - 文件位于 `public/config.json`，构建时原样拷贝到产物根目录；
 *   部署后运维/管理员可直接修改服务器上的该文件，**刷新页面即生效，无需重新构建**。
 * - 应用启动时（main.ts 的 bootstrap）先 `await loadConfig()`，再动态导入并挂载应用，
 *   因此任何模块（含模块顶层）都能安全地通过 `getConfig()` 读取配置。
 * - 注意：与「部署环境/构建工具链」相关的后端地址仍走 env/ 目录的 .env 文件（见 env.ts），不在此文件中。
 *
 * 界面上显示的文案字段（导航 label、guestHint 等）类型是 {@link LocalizedText}：
 * 既可写纯字符串（所有语言通用，旧配置照常可用），也可写 `{ "en": "...", "zh-CN": "..." }`；
 * 组件里经 `localized()` 按当前界面语言解析，见 localizedText.ts。
 *
 * 这里只放**全站都要用的部署开关**。两类内容已分出去，以免它们的体积压在启动关键路径上：
 * - 首页展示内容（团队、时间线、Hero 文案……）→ `public/content.json`，
 *   见 features/home/config/contentConfig.ts，由 `/` 路由按需加载；
 * - 表单词表与离子源规则 → 编译进包，见 features/datasets/constants/datasetMetadata.ts
 *   与 features/upload/utils/ionSourceRules.ts。
 */

import type { LocalizedText } from './localizedText'

/**
 * 侧边导航栏菜单项（config.json 的 `nav` 块）。
 *
 * 字段说明：
 * - active:        静态总开关（默认 true）。设为 false → 强制不显示，**优先级高于任何动态条件**。
 * - requireAuth:   仅登录用户可见
 * - requireAdmin:  仅管理员可见
 * - requireGuest:  仅未登录访客可见
 *
 * 这些权限字段是「与」关系：必须同时满足；任意一个不满足即不显示。
 * 父级（group）若被过滤掉，其 children 也整体隐藏。
 */
export interface NavVisibility {
  /** 静态总开关；缺省视为 true。设为 false 时强制隐藏，覆盖所有动态条件 */
  active?: boolean
  /** 仅登录用户可见 */
  requireAuth?: boolean
  /** 仅管理员可见 */
  requireAdmin?: boolean
  /** 仅未登录访客可见 */
  requireGuest?: boolean
}

/**
 * 判断一项（nav / fab 均适用）是否应当显示。
 * 静态开关 `active` 优先级最高：显式设为 false 即强制隐藏，不再看动态条件。
 *
 * 不直接依赖 `User` 类型，避免 shared 层反向依赖 features 层。
 */
export function isNavVisible(
  item: NavVisibility,
  ctx: { isAuthenticated: boolean; isAdmin?: boolean },
): boolean {
  if (item.active === false) return false
  if (item.requireAuth && !ctx.isAuthenticated) return false
  if (item.requireGuest && ctx.isAuthenticated) return false
  if (item.requireAdmin && !ctx.isAdmin) return false
  return true
}

/**
 * 过滤导航菜单（navbar 与 drawer 共用同一份规则）：
 * 先按可见性过滤顶层项，再过滤分组的 children；子项被过滤光的分组整组隐藏。
 */
export function filterNavItems(
  items: NavItem[],
  ctx: { isAuthenticated: boolean; isAdmin?: boolean },
): NavItem[] {
  const visible = (i: NavVisibility): boolean => isNavVisible(i, ctx)
  return items
    .filter(visible)
    .map((it) => (it.kind === 'group' ? { ...it, children: it.children.filter(visible) } : it))
    .filter((it) => it.kind !== 'group' || it.children.length > 0)
}

/** 分组下的二级菜单项 */
export interface NavChild extends NavVisibility {
  /** 路由地址 */
  to: string
  /** 图标名（对应 SvgIcon 的 IconType） */
  icon: string
  /** 显示文案（可按语言分写） */
  label: LocalizedText
  /** 是否在新标签页中打开（用 <a target="_blank"> 代替 <router-link>） */
  external?: boolean
}

/** 顶层菜单：普通链接 */
export interface NavLinkItem extends NavVisibility {
  kind: 'link'
  /** 路由地址 */
  to: string
  /** 图标名 */
  icon: string
  /** 显示文案（可按语言分写） */
  label: LocalizedText
  /** 点击后是否关闭抽屉，默认 true（如登录/注册等可设为 false） */
  closeOnClick?: boolean
  /** 是否在新标签页中打开（用 <a target="_blank"> 代替 <router-link>） */
  external?: boolean
}

/** 顶层菜单：可折叠分组 */
export interface NavGroupItem extends NavVisibility {
  kind: 'group'
  /** 图标名 */
  icon: string
  /** 显示文案（可按语言分写） */
  label: LocalizedText
  /** 子菜单 */
  children: NavChild[]
}

export type NavItem = NavLinkItem | NavGroupItem

/** 导航形态：navbar 顶栏 / drawer 左侧抽屉 + 悬浮按钮（FAB）/ none 不渲染任何导航 */
export type NavMode = 'navbar' | 'drawer' | 'none'

/** 登录后账户菜单项：link 跳转路由（navbar 头像下拉与 drawer 菜单尾部都显示）；
 *  action 触发动作（目前仅 logout，仅 navbar 头像下拉显示——drawer 形态的登出由 FAB 承担） */
export interface NavUserLink extends NavChild {
  kind: 'link'
}

export interface NavUserAction extends NavVisibility {
  kind: 'action'
  /** 动作类型 */
  action: 'logout'
  /** 显示文案（可按语言分写） */
  label: LocalizedText
}

export type NavUserItem = NavUserLink | NavUserAction

/** 未登录时的登录/注册入口（仅 navbar 头像下拉显示；drawer 形态不列登录入口） */
export interface NavGuestLink extends NavChild {
  /** navbar 下拉里高亮为主色，缺省普通样式 */
  primary?: boolean
}

/**
 * 统一导航配置（config.json 的 `nav` 块）：一份菜单数据驱动多种形态，
 * 每个页面按 mode + modeByPath 在 navbar / drawer / none 之间选择。
 */
export interface NavConfig {
  /** 全局默认形态；缺省 'drawer' */
  mode?: NavMode
  /** 按路由覆盖形态。key 为路径前缀（'/' 只精确匹配首页，其余按前缀匹配、最长者生效） */
  modeByPath?: Record<string, NavMode>
  /** navbar 形态：是否显示头像左侧的主题切换按钮，缺省 true */
  themeToggle?: boolean
  /** navbar 形态：是否显示主题按钮左侧的语言切换按钮，缺省 true */
  localeToggle?: boolean
  /** navbar 形态：未登录头像的 tooltip 文案（可按语言分写），缺省为内置的「Sign in / 登录」 */
  guestHint?: LocalizedText
  /** 导航菜单（两种形态共用）：link / group */
  items: NavItem[]
  /** 登录后的账户入口 */
  userMenu: NavUserItem[]
  /** 未登录时的登录/注册入口 */
  guestLinks: NavGuestLink[]
}

/** 解析某路由应使用的导航形态：modeByPath 最长前缀命中优先，否则回退全局 mode（缺省 'drawer'） */
export function resolveNavMode(path: string): NavMode {
  const nav = getConfig().nav!
  let best: NavMode | undefined
  let bestLen = -1
  for (const [prefix, mode] of Object.entries(nav.modeByPath ?? {})) {
    const hit =
      prefix === '/'
        ? path === '/'
        : path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
    if (hit && prefix.length > bestLen) {
      bestLen = prefix.length
      best = mode
    }
  }
  return best ?? nav.mode ?? 'drawer'
}

/**
 * 悬浮按钮（NavFab）配置（config.json 的 `fab` 块）。
 *
 * 主按钮（main）只配置两套图标：drawer 收起时显示 `iconClosed`、展开时显示 `iconOpen`；
 * 主按钮本身就是 drawer 的开关（受控于与 NavDrawer 共享的 `open` model），不再额外派发事件。
 *
 * 子项（items）只有两种 kind：
 * - 'link'   : 跳转到 `to` 指定的路由
 * - 'action' : 触发 `action` 指定的事件（如 'toggle-theme'、'toggle-locale'、'toggle-ai'、'logout'）；
 *              其中 'toggle-theme' 的图标由组件根据当前 isDark 自动在 sun/moon 之间切换，
 *              'toggle-locale' 显示将要切换到的语言简称（EN / 中），
 *              配置里的 `icon` 字段对这两者都会被忽略
 *
 * 每项都支持 NavVisibility 中的 active / requireAuth / requireAdmin / requireGuest 字段。
 */
export interface FabMainConfig {
  /** drawer 关闭时主按钮显示的图标 */
  iconClosed: string
  /** drawer 打开时主按钮显示的图标 */
  iconOpen: string
}

interface FabItemBase extends NavVisibility {
  /** 图标名（'toggle-theme' / 'toggle-locale' action 会忽略此字段） */
  icon: string
  /** tooltip 显示文案（可按语言分写） */
  label: LocalizedText
}

export interface FabLinkItem extends FabItemBase {
  kind: 'link'
  /** 跳转的路由地址 */
  to: string
}

/** FAB 上动作型子项支持的动作枚举（与 NavFab 对外 emit 的事件一一对应） */
export type FabActionKind = 'toggle-theme' | 'toggle-locale' | 'toggle-ai' | 'logout'

export interface FabActionItem extends FabItemBase {
  kind: 'action'
  /** 动作类型 */
  action: FabActionKind
}

export type FabItem = FabLinkItem | FabActionItem

export interface FabConfig {
  /** 主按钮图标（必填） */
  main: FabMainConfig
  /** 子项列表，按声明顺序从外向内排列 */
  items: FabItem[]
}

/**
 * 云端 zarr 读取调优参数（config.json 的 zarr 块），供按部署环境的网络/内存调整。
 * 均可缺省，非法值在 loadConfig 里回退默认。
 */
export interface ZarrConfig {
  /**
   * spectra 组 chunk 缓存上限（LRU，按 chunk 个数计，1 chunk ≈ 1MB，100 ≈ 100MB）。
   * 缓存的价值在跨请求复用：调整区域后重新比较时，重叠部分直接命中，不重新下载。
   */
  spectraChunkCacheSize?: number
  /**
   * spectra 组并发下载窗口（同时在下载/解码的 chunk 数上限）。
   * 1MB chunk 下 ~8 个即可打满常见带宽，16 含裕量；≥1Gbps 链路可到 24-32。
   */
  spectraConcurrency?: number
}

/**
 * OSS 直连配置（config.json 的 `oss` 块）。
 *
 * 预览图等公共读资源不走后端换签名 URL，而是前端直连 OSS；bucket/region 因
 * 部署环境而异（测试/正式服务器不同），故域名放运行时配置：各服务器直接改
 * 服务器上的 config.json 即可切换，无需重新构建。
 */
export interface OssConfig {
  /**
   * 预览图直连 base（末尾不带斜杠）。测试环境形如 https://{bucket}.oss-{region}.aliyuncs.com，
   * 正式环境为绑定该 bucket 的 CDN 域名（https://cdn.neonexus.top）。
   * 完整 URL = {previewImageBase}/{image_path}/preview.jpg（目录取自后端 image_path）；
   * 缺省时在 loadConfig 里回退测试环境域名。
   */
  previewImageBase?: string
}

/** config.json 的结构 */
export interface AppConfig {
  /** 应用名称 */
  appName: string
  /** 应用版本号，如 "0.3.0" */
  version?: string
  /** AI 助手 LLM 运行时配置；缺省时用 env / 内置默认 */
  llm?: {
    /** 默认模型名（env 默认 → config.json llm 块覆盖） */
    model?: string
  }
  /** 云端 zarr 读取调优参数；缺省时用内置默认（100MB 缓存 / 16 并发） */
  zarr?: ZarrConfig
  /** OSS 直连域名等；缺省时回退内置默认（测试环境 bucket） */
  oss?: OssConfig
  /** 分页 */
  pagination: {
    /** 列表默认每页条数 */
    defaultPageSize: number
    /** 「每页条数」下拉可选项 */
    pageSizeOptions: number[]
  }
  /** 验证码 */
  verification: {
    /** 发送验证码后的倒计时秒数 */
    countdownSeconds: number
    /** 验证码最大尝试次数 */
    maxAttempts: number
  }
  /** 团队轮播（DeveloperCarousel 自动滚动） */
  carousel: {
    /** 自动逐张步进的间隔（ms）：每隔多久平滑翻过一张卡；设 0 禁用自动播放 */
    interval: number
    /** 滚到末尾后停留多久（ms）再平滑返回开头 */
    endPause: number
  }
  /** 统一导航（navbar / drawer 按路由二选一）；缺省时只渲染空导航骨架 */
  nav?: NavConfig
  /** 悬浮按钮（NavFab）；缺省时 NavFab 不渲染任何子项，但仍渲染主按钮以切换 drawer */
  fab?: FabConfig
}

let _config: AppConfig | null = null

/**
 * 加载 config.json。必须在挂载应用、以及导入任何依赖配置的模块之前 await 完成。
 * 加 no-cache 以便修改后刷新即可看到最新值。
 *
 * index.html 顶部的内联脚本已在 HTML 解析阶段发起同一个请求并挂在 window.__configPromise 上，
 * 这里优先复用，把这次往返折叠进入口 JS 的下载窗口。取用后立即清空：Response 的 body 只能
 * 消费一次，清空后万一有第二次调用会走下面的 fetch 兜底，与改动前行为一致。
 * 没有内联脚本的环境（单测的 jsdom 等）__configPromise 为 undefined，同样走 fetch 兜底。
 */
export async function loadConfig(): Promise<AppConfig> {
  const url = `${import.meta.env.BASE_URL}config.json`
  const preloaded = typeof window !== 'undefined' ? window.__configPromise : undefined
  if (typeof window !== 'undefined') window.__configPromise = undefined
  const res = await (preloaded ?? fetch(url, { cache: 'no-cache' }))
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`)
  }
  _config = (await res.json()) as AppConfig
  _config.zarr ??= {}
  if (!Number.isInteger(_config.zarr.spectraChunkCacheSize) || _config.zarr.spectraChunkCacheSize! < 1) {
    _config.zarr.spectraChunkCacheSize = 100
  }
  if (!Number.isInteger(_config.zarr.spectraConcurrency) || _config.zarr.spectraConcurrency! < 1) {
    _config.zarr.spectraConcurrency = 16
  }
  _config.oss ??= {}
  // 缺省回退测试环境域名，保证未配置 oss 块的旧配置行为不变
  _config.oss.previewImageBase ??= 'https://kawaru-oss.oss-cn-hangzhou.aliyuncs.com'
  _config.nav ??= { items: [], userMenu: [], guestLinks: [] }
  _config.fab ??= { main: { iconClosed: 'home', iconOpen: 'close' }, items: [] }
  return _config
}

/** 读取已加载的配置；若在 loadConfig 完成前调用会抛错（属编程错误，用以暴露时序问题）。 */
export function getConfig(): AppConfig {
  if (!_config) {
    throw new Error('App config not loaded yet. Ensure bootstrap awaits loadConfig() before use.')
  }
  return _config
}
