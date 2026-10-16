/**
 * SI_DB（HMDB 来源重排版）的过渡期 fetcher：后端还没有 /api/databases/hmdb，
 * 先把样本 CSV 当静态资源取回、在内存里模拟服务端的分页 + 关键词搜索，返回与
 * 未来后端逐字段一致的信封（契约见 types/database.ts 里 DatabaseFetcher 的注释）。
 *
 * 当前加载的是演示样本 public/SI_DB_sample.csv（全量文件前 60 行）。全量
 * SI_DB.csv 有 39MB / 11.3 万行，逐字符解析会卡 UI——接全量前要么改走后端，
 * 要么把解析挪进 worker（解析函数已抽成纯函数，可直接复用）。
 */
import { decodeCsvBytes } from '@/features/vizworkbench/utils/annotation/csv'
import { parseHmdbCsv, type HmdbRow } from '../utils/hmdbCsvParser'
import type { DatabaseFetcher } from '../types/database'

const SI_DB_SAMPLE_URL = `${import.meta.env.BASE_URL}SI_DB_sample.csv`

/** 解析结果缓存。存 Promise 而非值：并发的首批调用共享同一次下载 */
let cached: Promise<HmdbRow[]> | null = null

function loadAll(): Promise<HmdbRow[]> {
  cached ??= fetch(SI_DB_SAMPLE_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${SI_DB_SAMPLE_URL}`)
      return res.arrayBuffer()
    })
    .then((buf) => parseHmdbCsv(decodeCsvBytes(buf)))
    .catch((e) => {
      // 失败不缓存，下次进入页面 / 重试时重新下载
      cached = null
      throw e
    })
  return cached
}

/** 关键词在 ID / 名称 / 分子式上做不区分大小写的子串匹配（InChI 全文不参与） */
function filterRows(rows: HmdbRow[], keyword: string): HmdbRow[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return rows
  return rows.filter(
    (r) =>
      r.id.toLowerCase().includes(kw) ||
      r.name.toLowerCase().includes(kw) ||
      r.formula.toLowerCase().includes(kw),
  )
}

export const listHmdbFromCsv: DatabaseFetcher = async ({ keyword = '', page, size }) => {
  const all = filterRows(await loadAll(), keyword)
  const totalRecords = all.length
  const totalPages = Math.max(1, Math.ceil(totalRecords / size))
  // 与服务端一致：越界的页码钳回有效范围，而不是返回空页
  const current = Math.max(1, Math.min(totalPages, page))
  return {
    data: all.slice((current - 1) * size, current * size),
    meta: { current_page: current, total_pages: totalPages, total_records: totalRecords },
  }
}
