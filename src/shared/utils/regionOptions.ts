import { ref } from 'vue'
import countries from 'i18n-iso-countries'
import enLocale from 'i18n-iso-countries/langs/en.json'
import { i18n } from '@/i18n'

countries.registerLocale(enLocale)

const COUNTRY_OVERRIDES: Record<string, string> = {
  CN: 'China',
  US: 'United States',
  GB: 'United Kingdom',
  RU: 'Russia',
  KR: 'South Korea',
  KP: 'North Korea',
  // 只缩短显示名，提交值仍是 ISO 代码 TW；中文名来自 zh.json，不受这里影响
  TW: 'Taiwan',
}

/**
 * 中文国家名按需加载。
 *
 * 本文件在 src/shared/ 下，会被并进首屏 eager 的 shared chunk；静态导入 zh.json 会让
 * 所有用户（包括英文用户）首屏多下约 2.6KB gzip。改为界面语言是中文时才动态导入，
 * 加载完成前先显示英文名，就绪后经 zhReady 触发依赖它的 computed / 模板重算。
 * vite.config.ts 的 manualChunks 里有配套规则，防止它被并回 vendor chunk。
 */
const zhReady = ref(false)
let zhPending: Promise<void> | null = null

function ensureZhNames() {
  zhPending ??= import('i18n-iso-countries/langs/zh.json')
    .then((m) => {
      countries.registerLocale(m.default)
      zhReady.value = true
    })
    .catch(() => {
      zhPending = null // 下载失败继续显示英文名，下次调用再重试
    })
}

let cache: { key: string; options: Record<string, string> } | null = null

/**
 * 地区下拉选项：{ 显示名: ISO 代码 }。显示名随界面语言变化，值始终是 ISO 代码，
 * 所以提交给后端的内容、已选中的值都不受切语言影响。
 *
 * 在 computed 或模板里调用才会随语言切换刷新（依赖 locale 与 zhReady 两个响应式值）。
 */
export function getRegionOptions(): Record<string, string> {
  const wantZh = i18n.global.locale.value === 'zh-CN'
  if (wantZh && !zhReady.value) ensureZhNames()
  const useZh = wantZh && zhReady.value

  const key = useZh ? 'zh' : 'en'
  if (cache?.key === key) return cache.options

  const zhNames = useZh ? countries.getNames('zh') : null
  const entries: [string, string][] = []
  for (const [code, name] of Object.entries(countries.getNames('en'))) {
    const enName = COUNTRY_OVERRIDES[code] ?? name
    // 按英文名长度筛选，保证两种语言下可选的国家集合一致
    if (enName.length > 28) continue
    entries.push([zhNames?.[code] ?? enName, code])
  }
  // 英文保持原有顺序；中文名按代码排列没有规律，改按拼音排序
  if (zhNames) entries.sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))

  cache = { key, options: Object.fromEntries(entries) }
  return cache.options
}

export function getRegionName(code: string): string {
  const regionMap = getRegionOptions()
  const entry = Object.entries(regionMap).find(([, c]) => c === code)
  return entry ? entry[0] : code
}
