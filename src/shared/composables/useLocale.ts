import { computed } from 'vue'
import { STORAGE_KEYS } from '@/shared/config'
import { i18n, loadCoreMessages, loadActiveFeatureMessages, LOCALES, type Locale } from '@/i18n'

/**
 * 全站界面语言的单一数据源，与 useTheme 同构：模块级单例 + localStorage 持久化 +
 * 挂载前初始化，任何组件 `useLocale()` 拿到的都是同一份状态，切换即全局同步。
 *
 * 语言**不进 URL**：偏好存 localStorage，首访按浏览器语言探测。这意味着分享出去的
 * 链接（/collections/:publicId、/s/:shareToken 等）不携带语言，接收者按自己的浏览器
 * 语言自动决定看到中文还是英文——这正是期望的行为，无需为分享链接做特殊处理。
 */

export type { Locale }

function isLocale(v: unknown): v is Locale {
  return LOCALES.some((l) => l.value === v)
}

/**
 * 决定初始语言，**不产生任何副作用**（供 initLocale 与单测分别使用）。
 *
 * 优先级：用户显式保存过的偏好 > 浏览器语言探测 > en 兜底。
 * 探测只看语言主标签：zh / zh-CN / zh-TW / zh-Hant 一律归 zh-CN——本期只提供简体，
 * 繁体用户拿到简体也好过直接掉回英文。非 zh 非 en 的语言（如 ja、de）走 en 兜底。
 */
export function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEYS.locale)
  if (isLocale(saved)) return saved

  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of prefs) {
    const lower = tag?.toLowerCase() ?? ''
    if (lower.startsWith('zh')) return 'zh-CN'
    if (lower.startsWith('en')) return 'en'
  }
  return 'en'
}

/**
 * 同步到 <html lang>。
 * 除了语义与 SEO，站内还有两处实际依赖：浏览器的「翻译此页」提示，以及
 * style.css 里用 :lang(zh-CN) 给中文放开字重合成（font-synthesis）。
 */
function applyHtmlLang(locale: Locale) {
  document.documentElement.setAttribute('lang', locale)
}

/**
 * 初始化语言。应在挂载应用前尽早调用（main.ts），且必须在 await loadCoreMessages()
 * **之前**——它只定语言、不碰消息，消息随后并行加载即可。
 *
 * 返回值交给调用方去 loadCoreMessages(locale)，避免这里再读一次状态。
 */
export function initLocale(): Locale {
  const locale = detectLocale()
  i18n.global.locale.value = locale
  applyHtmlLang(locale)
  return locale
}

/**
 * 运行时切换语言。
 *
 * 顺序不能调换：**先把目标语言的消息（核心 + 已访问过的 feature）拉齐，再切 locale**。
 * 反过来的话，切换瞬间当前页面会先回退成英文、等消息到位才变中文，闪一下。
 */
export async function setLocale(locale: Locale): Promise<void> {
  if (locale === i18n.global.locale.value) return

  await Promise.all([loadCoreMessages(locale), loadActiveFeatureMessages(locale)])

  i18n.global.locale.value = locale
  applyHtmlLang(locale)
  localStorage.setItem(STORAGE_KEYS.locale, locale)
}

/** 「切换语言」按钮要切到的那门语言（目前只有两门，即当前语言之外的另一门） */
const nextLocale = computed(
  () => LOCALES.find((l) => l.value !== i18n.global.locale.value) ?? LOCALES[0]!,
)

/** 在两门语言之间切换，与 useTheme 的 toggleTheme 对称 */
export function toggleLocale(): Promise<void> {
  return setLocale(nextLocale.value.value)
}

export function useLocale() {
  const locale = computed(() => i18n.global.locale.value)
  return { locale, nextLocale, toggleLocale }
}
