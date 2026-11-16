/**
 * 首页统计数据层（StatsScene 左侧面板用）。
 * 这些是**首页公开数据**，统一走公开的 `api`（不带 token），不要用 auth_api。
 */

import { api } from '@/shared/api/httpClient'
import { unwrap } from '@/shared/api/response'
import type {
  DatasetCategoryStats,
  PlatformOverviewStats,
  VisitsStats,
} from '@/features/home/types/stats'

// ──────────────────────────────────────────────────────────────────────────
// 数据集分类 / 离子源类型分布（环形图数据源）
// ──────────────────────────────────────────────────────────────────────────

/** GET /stats/files/classification?field= - 按指定字段统计文件分类数量 */
async function getFilesClassification(field: string): Promise<Record<string, number>> {
  return unwrap(api.get('/stats/files/classification', { params: { field } }))
}

/** 将 { key: count } 映射为 DonutStatSection 所需的 { items, total } 格式 */
function classificationToCategoryStats(data: Record<string, number>): DatasetCategoryStats {
  const items = Object.entries(data)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
  const total = items.reduce((sum, item) => sum + item.count, 0)
  return { items, total }
}

/** GET /stats/files/classification?field=organism -- 数据集物种分布 */
export async function getOrganismStats(): Promise<DatasetCategoryStats> {
  const data = await getFilesClassification('organism')
  return classificationToCategoryStats(data)
}

/** GET /stats/files/classification?field=organism_part -- 数据集组织部位分布 */
export async function getDatasetCategoryStats(): Promise<DatasetCategoryStats> {
  const data = await getFilesClassification('organism_part')
  return classificationToCategoryStats(data)
}

/** GET /stats/files/classification?field=ionisation_source -- 数据集离子源类型分布 */
export async function getDatasetIonSourceStats(): Promise<DatasetCategoryStats> {
  const data = await getFilesClassification('ionisation_source')
  return classificationToCategoryStats(data)
}

/** GET /stats/files/classification?field=analyzer -- 分析器类型分布 */
export async function getAnalyzerStats(): Promise<DatasetCategoryStats> {
  const data = await getFilesClassification('analyzer')
  return classificationToCategoryStats(data)
}

// ──────────────────────────────────────────────────────────────────────────
// ③ 平台总览（首页三个 stat）
// ──────────────────────────────────────────────────────────────────────────

const PLATFORM_OVERVIEW_PATH = '/stats/overview'

/** GET /stats/overview -- 获取平台总览（总用户 / 总数据集 / 总下载） */
export async function getPlatformOverview(): Promise<PlatformOverviewStats> {
  return unwrap(api.get(PLATFORM_OVERVIEW_PATH))
}

// ──────────────────────────────────────────────────────────────────────────
// ④ 网站访问量
// ──────────────────────────────────────────────────────────────────────────

/** GET /stats/visits -- 获取全站访问统计（当日 / 当月 / 总计） */
export async function getVisitsStats(): Promise<VisitsStats> {
  return unwrap(api.get('/stats/visits'))
}
