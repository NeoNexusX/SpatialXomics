import type { MarkdownDocument } from 'comark'
import type { Locale } from '@/i18n'
import { formatDate } from '@/shared/utils/format'
import { buildLUT, colormapGradient } from '@/shared/viz/colormapLut'

type ByLocale = Partial<Record<Locale, string>>

export interface NewsItem {
  /** 文件名去掉 .md，以发布日期开头，也是详情页地址 /news/<id> */
  id: string
  /** YYYY-MM-DD */
  date: string
  /** 文件名以 -v<版本号> 结尾的是版本更新，其余是公告 */
  version?: string
  title: ByLocale
  summary: ByLocale
  /** 各语言正文的模块路径，用 localized() 取当前语言那份 */
  file: ByLocale
}

// 由 vite.config.ts 的 newsMarkdown 插件转换：?meta 只有 title 和 summary，正文按需加载
const metas = import.meta.glob<{ title: string; summary: string }>('../content/*/*.md', {
  eager: true,
  query: '?meta',
  import: 'default',
})
const bodies = import.meta.glob<MarkdownDocument>('../content/*/*.md', { import: 'default' })

const items = new Map<string, NewsItem>()
for (const [path, meta] of Object.entries(metas)) {
  const [locale, name] = path.split('/').slice(-2) as [Locale, string]
  const id = name.replace(/\.md$/, '')
  const item = items.get(id) ?? {
    id,
    date: id.slice(0, 10),
    version: /-v(\d+(?:\.\d+)*)$/.exec(id)?.[1],
    title: {},
    summary: {},
    file: {},
  }
  item.title[locale] = meta.title
  item.summary[locale] = meta.summary
  item.file[locale] = path
  items.set(id, item)
}

/** 新的在前。id 以日期开头，按字符串倒序就是按日期倒序 */
export const NEWS = [...items.values()].sort((a, b) => b.id.localeCompare(a.id))

export const loadNewsBody = (file: string) => bodies[file]!()

/** 按本地零点格式化。new Date('YYYY-MM-DD') 是 UTC 零点，西半球会显示成前一天 */
export const formatNewsDate = (item: NewsItem, options: Intl.DateTimeFormatOptions) =>
  formatDate(`${item.date}T00:00`, options)

const VIRIDIS = buildLUT('viridis')

/** 第 index 篇的标记色：在离子图的 viridis 色标上按新旧取色，最新的最亮 */
export function newsColor(index: number): string {
  const t = 1 - index / Math.max(NEWS.length - 1, 1)
  return `rgb(${VIRIDIS[Math.round(t * 255)]!.join(' ')})`
}

/** 横向的 viridis 色标，详情页标题下用 */
export const VIRIDIS_BAR = colormapGradient('viridis')
