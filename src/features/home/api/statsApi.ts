/**
 * 首页统计数据层。
 * 这些是**首页公开数据**，统一走公开的 `api`（不带 token），不要用 auth_api。
 */

import { api } from '@/shared/api/httpClient'
import { unwrap } from '@/shared/api/response'
import type {
  DatasetCategoryStats,
  PlatformOverviewStats,
  VisitsStats,
  VisitsHistoryStats,
} from '@/features/home/types/stats'

// ──────────────────────────────────────────────────────────────────────────
// 数据集分类 / 离子源类型分布（环形图数据源）
// ──────────────────────────────────────────────────────────────────────────

/** GET /stats/files/classification?field= - 按指定字段统计文件分类数量 */
async function getFilesClassification(
  field: string,
  signal?: AbortSignal,
): Promise<DatasetCategoryStats> {
  const data = await unwrap<Record<string, number>>(
    api.get('/stats/files/classification', { params: { field }, signal }),
  )
  return classificationToCategoryStats(data)
}

/** 将 { key: count } 映射为分布图所需的 { items, total } 格式（按数量从多到少） */
function classificationToCategoryStats(data: Record<string, number>): DatasetCategoryStats {
  const items = Object.entries(data)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
  const total = items.reduce((sum, item) => sum + item.count, 0)
  return { items, total }
}

/** GET /stats/files/classification?field=organism -- 数据集物种分布 */
export function getOrganismStats(signal?: AbortSignal): Promise<DatasetCategoryStats> {
  return getFilesClassification('organism', signal)
}

/** GET /stats/files/classification?field=organism_part -- 数据集组织部位分布 */
export function getDatasetCategoryStats(signal?: AbortSignal): Promise<DatasetCategoryStats> {
  return getFilesClassification('organism_part', signal)
}

/** GET /stats/files/classification?field=ionisation_source -- 数据集离子源类型分布 */
export function getDatasetIonSourceStats(signal?: AbortSignal): Promise<DatasetCategoryStats> {
  return getFilesClassification('ionisation_source', signal)
}

/** GET /stats/files/classification?field=analyzer -- 分析器类型分布 */
export function getAnalyzerStats(signal?: AbortSignal): Promise<DatasetCategoryStats> {
  return getFilesClassification('analyzer', signal)
}

// ──────────────────────────────────────────────────────────────────────────
// ③ 平台总览（首页三个 stat）
// ──────────────────────────────────────────────────────────────────────────

const PLATFORM_OVERVIEW_PATH = '/stats/overview'

/** GET /stats/overview -- 获取平台总览（总用户 / 总数据集 / 总下载） */
export async function getPlatformOverview(signal?: AbortSignal): Promise<PlatformOverviewStats> {
  return unwrap(api.get(PLATFORM_OVERVIEW_PATH, { signal }))
}

// ──────────────────────────────────────────────────────────────────────────
// ④ 网站访问量
// ──────────────────────────────────────────────────────────────────────────

/** GET /stats/visits -- 获取全站访问统计（当日 / 当月 / 总计） */
export async function getVisitsStats(signal?: AbortSignal): Promise<VisitsStats> {
  return unwrap(api.get('/stats/visits', { signal }))
}

/** Let the server choose today's UTC end date so a browser timezone cannot exceed the window. */
export async function getVisitsHistory(signal?: AbortSignal): Promise<VisitsHistoryStats> {
  return unwrap(api.get('/stats/visits/history', { params: { days: 90 }, signal }))
}
