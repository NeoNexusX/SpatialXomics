/**
 * SI_DB 数据源 fetcher：DatabaseListParams → POST /annotations/si-db/list 的装配。
 *
 * 页面数据只来自后端注释服务（/database 路由要求登录）。后端「不可用」——无响应
 * （连不上）、5xx、404——换成一句话本地化错误上抛（原始错误只进 console），由
 * 页面的错误态 + 重试按钮承接；401 走全局拦截器的会话清理与登录跳转；403/422
 * 等「后端明确拒绝」原样上抛，保留后端信息。
 */
import { isAxiosError } from 'axios'
import { t } from '@/i18n'
import { useToast } from '@/shared/composables/useToast'
import { formatBytes } from '@/shared/utils/format'
import type { DatabaseFetcher, DatabaseFilterValues } from '../types/database'
import { getSiDbDownload, listSiDb, type SiDbFilters } from './siDbApi'

/**
 * 单一关键词 → 后端逐字段筛选的映射（后端每个字段只收一个值，无法跨字段 OR）：
 * HMDB 前缀 → 编号；分子式形状（元素符号+计数的序列且含数字）→ 分子式；其余 → 名称。
 * 判断顺序很重要："HMDB0001" 同样满足分子式形状，须先认 HMDB 前缀。
 */
export function buildSiDbFilters(
  keyword: string,
  controls: DatabaseFilterValues = {},
): SiDbFilters {
  const filters: SiDbFilters = {}
  const kw = keyword.trim()
  if (/^hmdb/i.test(kw)) filters.entry_key = kw
  else if (/^(?:[A-Z][a-z]?\d*)+$/.test(kw) && /\d/.test(kw)) filters.formula = kw
  else if (kw) filters.name = kw

  // 控件键契约：'origin'（select）/ 'mass'（number-range），与 sources/hmdb.ts 的
  // filterControls 声明一一对应
  if (typeof controls.origin === 'string' && controls.origin.trim()) {
    filters.origin = controls.origin.trim()
  }
  const mass = controls.mass
  if (mass && typeof mass === 'object') {
    if (Number.isFinite(mass.min)) filters.mass_min = mass.min
    if (Number.isFinite(mass.max)) filters.mass_max = mass.max
  }
  return filters
}

/**
 * 后端「不在/不可用」：无响应（连接不上）、5xx、404。这些情形下后端给不出有
 * 意义的报错文本，统一换成本地化的一句话提示。401/403/400/422 属于「后端
 * 明确拒绝」，保留原始错误上抛。
 */
function isServiceUnavailable(error: unknown): boolean {
  if (!isAxiosError(error)) return false
  const status = error.response?.status
  return status === undefined || status >= 500 || status === 404
}

export const listSiDbPage: DatabaseFetcher = async ({
  keyword = '',
  filters: controls = {},
  page,
  size,
}) => {
  const filters = buildSiDbFilters(keyword, controls)
  try {
    const res = await listSiDb(filters, page, size)
    return {
      // entry_key → id：列定义（sources/hmdb.ts）的行字段形状
      data: res.data.map((e) => ({
        id: e.entry_key,
        name: e.name,
        formula: e.formula,
        mass: e.mass,
        origin: e.origin,
        inchi: e.inchi,
      })),
      meta: res.meta,
    }
  } catch (e) {
    if (isServiceUnavailable(e)) {
      console.error('SI_DB backend unavailable:', e)
      throw new Error(t('databases.hmdb.serviceUnavailable'))
    }
    throw e
  }
}

/**
 * 整库 CSV 两步下载：先（登录态）换直链，再把 url 交给浏览器直接下载——对接
 * 说明明确要求用 <a>/跳转而非 fetch/XHR（会丢进度条和断点续传）。直链内嵌短时
 * token（约 60 分钟），过期重新调第一步即可，前端无需解析。
 */
export async function downloadSiDbCsv(): Promise<void> {
  let info
  try {
    info = await getSiDbDownload()
  } catch (e) {
    console.error('SI_DB download failed to start:', e)
    throw new Error(t('databases.hmdb.downloadFailed'))
  }

  const link = document.createElement('a')
  link.href = info.url
  // 跨域时 download 属性被忽略，文件名以响应头为准；同源时兜底用第一步回传的
  link.setAttribute('download', info.filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  const { showToast } = useToast()
  showToast(
    t('databases.hmdb.downloadStarted', { filename: info.filename, size: formatBytes(info.size) }),
    'success',
  )
}
