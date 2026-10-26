/**
 * 全站 i18n 实例与消息加载器。
 *
 * 语言包分两层加载，和现有的路由级分包对齐：
 * - **core**（CORE_NS）：全站共用，启动时在 main.ts 里与 `loadConfig()` **并行** await，
 *   不增加任何串行往返；
 * - **feature**（FeatureNs）：随路由懒加载，写法照抄 router/index.ts 里首页
 *   `Promise.all([import(view), loadContent()])` 的先例——组件渲染时消息必然已就位，
 *   所以组件内不需要处理 pending 态。
 *
 * 两条硬约束，改动前务必先读：
 *
 * 1. **语言包必须放在 `src/i18n/locales/`，不能放 `src/shared/`。**
 *    vite.config.ts 的 manualChunks 把 `src/shared/**`（除 config/）整个合并成一个
 *    eager chunk；语言包一旦落进去，en + zh 两份、所有 feature 的文案都会被打进首屏，
 *    懒加载就白做了。那里另有一条针对 `/src/i18n/locales/` 的护栏，别删。
 *
 * 2. **语言包必须是 .json，不能是 .ts。**
 *    @intlify/eslint-plugin-vue-i18n 读语言包只认 .js/.json/.json5/.yaml/.yml
 *    （见其 dist/utils/locale-messages.js）；而 .js 那条路走 CommonJS require()，
 *    本项目是 "type": "module" 也走不通。用 .ts 会让 no-unused-keys、no-missing-keys、
 *    no-missing-keys-in-other-locales 三条规则全部静默失效。
 */
import { createI18n } from 'vue-i18n'
import type { Locale, MessageSchema } from './types'

export type { Locale, MessageSchema } from './types'

/** 语言选项。label 一律用该语言自己的写法（英文项写 English、中文项写简体中文），不参与翻译。 */
export const LOCALES: readonly { value: Locale; label: string; short: string }[] = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'zh-CN', label: '简体中文', short: '中' },
] as const

/**
 * 启动即加载的核心命名空间。
 * 列在这里但对应 json 还不存在的，loadNs 会静默跳过，等文件补上即自动生效。
 *
 * auth 放 core 而不是随路由加载：除了登录/注册/找回密码页，验证码发送、密码强度、
 * 「请先登录」提示这些 auth 文案还会在 users、datasets 等其他路由里用到。
 */
const CORE_NS = ['common', 'auth'] as const

/** 随路由懒加载的 feature 命名空间（与 features/ 目录一一对应） */
export type FeatureNs =
  | 'datasets'
  | 'collections'
  | 'upload'
  | 'users'
  | 'workspace'
  | 'vizworkbench'
  | 'home'
  | 'databases'

/**
 * Vite 在构建期把每个 json 切成独立 chunk，只有真正 import 到的语言/命名空间才会下载。
 * 路径写死成字面量是 import.meta.glob 的硬性要求（构建期静态分析），不能用变量拼。
 */
const messageModules = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', {
  import: 'default',
})

/** 已加载（或正在加载）的 `${locale}:${ns}`。存 Promise 而非布尔量，见下方 loadNs 注释。 */
const inflight = new Map<string, Promise<void>>()

/**
 * 三个泛型参数缺一不可，否则类型会整条崩掉：
 * - MessageSchema：key 的类型来源，让 t() 能逐段校验路径
 * - Locale：不写的话 vue-i18n 默认只认 'en-US'，传 'en' / 'zh-CN' 直接报错
 * - false：把 global 从「Composer | VueI18n 联合」收窄成 Composer，
 *          否则 `i18n.global.locale` 会被当成 legacy 模式下的 string（没有 .value）
 *
 * 不传初始 messages：语言包全部走懒加载，由 mergeLocaleMessage 逐个命名空间合并进来。
 */
export const i18n = createI18n<MessageSchema, Locale, false>({
  legacy: false, // Composition 模式
  globalInjection: true, // 模板里直接用 $t，省掉每个组件的 useI18n() 样板
  locale: 'en', // 真正的初始语言由 main.ts 的 initLocale() 覆盖
  fallbackLocale: 'en', // 缺译文时回退英文，绝不把裸 key 显示给用户
  missingWarn: import.meta.env.DEV,
  fallbackWarn: false, // 回退是设计内的正常行为，不刷警告
})

/**
 * 加载单个命名空间。
 *
 * 缓存的是 **Promise 而不是布尔标记**：若先标记再 await，并发的第二个调用方会在消息
 * 真正 merge 进去之前就拿到 resolve，页面可能一闪而过地渲染出空文案。这与
 * features/home/config/contentConfig.ts 里 `_pending` 的处理是同一个理由。
 *
 * 找不到对应 json 时**静默跳过**（不抛错）：分期迁移过程中 zh 包大量缺席是常态，
 * 缺了就让 fallbackLocale 接管显示英文，不该让路由 resolve 失败、整页白屏。
 */
function loadNs(locale: Locale, ns: string): Promise<void> {
  const cacheKey = `${locale}:${ns}`
  const cached = inflight.get(cacheKey)
  if (cached) return cached

  const loader = messageModules[`./locales/${locale}/${ns}.json`]
  if (!loader) return Promise.resolve()

  // 直接整份合并：命名空间那一层写在 json 文件**内部**（common.json 的顶层键就是 common），
  // 不在这里代码拼。这样 ESLint 插件按原样读文件时看到的 key 路径与运行时完全一致——
  // 若改成在此处包一层 { [ns]: ... }，插件会以为 key 是 action.save 而运行时是
  // common.action.save，no-missing-keys 会对所有正确的 key 全部误报。
  const pending = loader().then((messages) => {
    i18n.global.mergeLocaleMessage(locale, messages)
  })
  inflight.set(cacheKey, pending)
  return pending
}

/**
 * 加载某个命名空间，并在非英文语言下**顺带预热 en 的同一份**。
 *
 * fallbackLocale 只在内存里查 en 的消息，不会自己去下载；不预热的话，中文包缺 key
 * 时回退拿到的是 key 本身而不是英文。两者并行发起，不产生额外延迟；代价是中文用户
 * 每个命名空间多下一份 en（gzip 后 0.7–3.6KB，单个页面合计不到 10KB）。
 *
 * zh 已与 en 逐键对齐，且有 ESLint 的 no-missing-keys-in-other-locales 把关，
 * 这层预热只是兜底。保留它的另一个原因：datasets 的 vocabLabel 用
 * `te(key, 'en')` 判断 datasets 包是否已加载，去掉预热前要先改掉那个探针。
 */
function ensureNs(locale: Locale, ns: string): Promise<unknown> {
  return locale === 'en' ? loadNs('en', ns) : Promise.all([loadNs(locale, ns), loadNs('en', ns)])
}

/** 已经进入过的 feature 命名空间。切语言时需要按新语言把它们补齐，否则当前页会回退成英文。 */
const activeFeatures = new Set<FeatureNs>()

/** 启动时加载核心消息。在 main.ts 里与 loadConfig() 并行 await。 */
export async function loadCoreMessages(locale: Locale): Promise<void> {
  await Promise.all(CORE_NS.map((ns) => ensureNs(locale, ns)))
}

/** 路由进入时加载该 feature 的消息。与视图 chunk 并行发起，见 router/index.ts。 */
export async function loadFeatureMessages(ns: FeatureNs): Promise<void> {
  activeFeatures.add(ns)
  await ensureNs(i18n.global.locale.value, ns)
}

/** 切换语言时，把已访问过的 feature 消息按新语言补齐（必须在切 locale 之前 await）。 */
export async function loadActiveFeatureMessages(locale: Locale): Promise<void> {
  await Promise.all([...activeFeatures].map((ns) => ensureNs(locale, ns)))
}

/**
 * 非组件上下文（composables、纯 .ts 模块）用的翻译函数。
 *
 * **只可用于命令式取值**——toast、confirm 文案、抛错信息这类「取到就用掉」的场景。
 * 凡是需要随语言切换自动重算的（常量表的 label、页面上的 computed 文案），
 * 必须写在 computed 里调用，否则切语言后那段文字不会更新。
 *
 * 组件内部优先用模板里的 `$t`（globalInjection 已开），不需要 import 这个。
 */
export const { t, te } = i18n.global
