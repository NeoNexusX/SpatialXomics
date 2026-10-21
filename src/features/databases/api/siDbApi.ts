/**
 * SI 注释数据库（/annotations/si-db）的 HTTP 封装，契约见后端 Swagger
 * （http://<后端地址>/docs 搜 annotation）。
 *
 * 两个能力：① 分页查询（POST /list，body 必传，筛选字段模糊匹配、字段间取
 * 交集）；② 整库 CSV 两步下载（先换内嵌短时 token 的直链，再交给浏览器）。
 * 所有接口需登录态，未登录一律 401。
 */
import { auth_api } from '@/shared/api/httpClient'
import { ENV } from '@/shared/config'
import type { DatabasePageMeta } from '../types/database'

// 约定：本模块所有函数都返回**解包后的响应体**（res.data），调用方不再处理 axios 信封。

/** 列表行（后端 snake_case；entry_key 即 HMDB ID，如 HMDB0001234） */
export interface SiDbEntry {
  entry_key: string
  name: string
  formula: string
  mass: number
  origin: string
  inchi: string
}

/** body 筛选项：每个字段一个值、模糊匹配（质量区间除外），字段间取交集 */
export interface SiDbFilters {
  entry_key?: string
  name?: string
  formula?: string
  origin?: string
  mass_min?: number
  mass_max?: number
}

/** 服务端排序白名单（与后端一致，非法值 422） */
export type SiDbSortBy = 'entry_key' | 'name' | 'mass' | 'origin'

export interface SiDbListResult {
  meta: DatabasePageMeta & { current_records?: number }
  data: SiDbEntry[]
}

/**
 * POST /annotations/si-db/list?page&size&sort_by&order — 唯一查询接口。
 * body 必传（不筛选传空对象，与文件列表接口用法一致）；分页/排序走 query。
 */
export async function listSiDb(
  filters: SiDbFilters = {},
  page = 1,
  size = 10,
  sort?: { sortBy: SiDbSortBy; order: 'asc' | 'desc' },
): Promise<SiDbListResult> {
  const res = await auth_api.post<SiDbListResult>('/annotations/si-db/list', filters, {
    params: { page, size, sort_by: sort?.sortBy ?? 'entry_key', order: sort?.order ?? 'asc' },
  })
  return res.data
}

/** GET /annotations/si-db/download — 两步下载的第一步：换取内嵌短时 token 的直链 */
export interface SiDbDownloadInfo {
  filename: string
  url: string
  /** 文件字节数（≈38.5 MB），用于下载前提示 */
  size: number
}

export async function getSiDbDownload(): Promise<SiDbDownloadInfo> {
  const res = await auth_api.get<SiDbDownloadInfo>('/annotations/si-db/download')
  return res.data
}

/**
 * 把后端回传的 relay 直链（绝对地址）改写成走同源 /api 代理的相对地址：
 * /api 前缀在 dev（vite proxy）与部署（nginx proxy_pass）里都被剥掉后转发后端，
 * 列表接口走的正是这条路。fetch 整库 CSV 需要读响应体，直连绝对地址会跨域，
 * 改写后三个环境行为一致。浏览器整库下载（downloadSiDbCsv）不经这里——契约
 * 要求用 <a> 直连直链以保留进度条与断点续传。
 */
export function toProxiedRelayUrl(url: string): string {
  const u = new URL(url)
  return `${ENV.apiBase.replace(/\/+$/, '')}${u.pathname}${u.search}`
}

/**
 * 轻量探测整库文件元信息（文件名 / 字节数），不下载文件体。注释面板用它判断
 * 本地已保存的副本是否过期；也用作「另存为」默认文件名的来源之一。
 */
export async function probeSiDbCsv(): Promise<{ fileName: string; size: number }> {
  const info = await getSiDbDownload()
  return { fileName: info.filename, size: info.size }
}

/**
 * 下载整库 CSV 原始字节（注释面板「平台库」导入用：写盘与解析共用这一份）。
 * onProgress 回报累计已下载字节数与总字节数（来自第一步回传的 size），供按钮
 * 显示下载百分比。
 */
export async function fetchSiDbCsv(
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const info = await getSiDbDownload()
  const res = await fetch(toProxiedRelayUrl(info.url))
  if (!res.ok) throw new Error(`HTTP ${res.status} for SI_DB csv`)

  let bytes: Uint8Array
  if (onProgress && res.body) {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        loaded += value.byteLength
        onProgress(loaded, info.size)
      }
    }
    bytes = new Uint8Array(loaded)
    let offset = 0
    for (const c of chunks) {
      bytes.set(c, offset)
      offset += c.byteLength
    }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer())
  }
  return { fileName: info.filename, bytes }
}
