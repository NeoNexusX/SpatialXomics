import { computed } from 'vue'
import { t } from '@/i18n'
import {
  getDatasetCategoryStats,
  getDatasetIonSourceStats,
  getOrganismStats,
  getAnalyzerStats,
  getPlatformOverview,
  getVisitsStats,
} from '../api/statsApi'
import type { DatasetCategoryStats } from '../types/stats'
import { useStatRequest } from './useStatRequest'

/** Distribution totals are derived from the same response as their items. */
function useCategoryDistribution(
  fetcher: (signal: AbortSignal) => Promise<DatasetCategoryStats>,
  errorMessage: () => string,
) {
  const { stats, ...request } = useRemoteStat(fetcher, errorMessage)
  const items = computed(() => stats.value?.items ?? [])
  const total = computed(
    () => stats.value?.total ?? items.value.reduce((sum, item) => sum + item.count, 0),
  )
  const isEmpty = computed(
    () => !request.loading.value && !request.error.value && items.value.length === 0,
  )
  return { ...request, items, total, isEmpty }
}

// 物种分布
export function useOrganismStats() {
  return useCategoryDistribution(getOrganismStats, () => t('home.stats.loadFailed.organism'))
}

// 数据集组织部位分布
export function useDatasetCategoryStats() {
  return useCategoryDistribution(getDatasetCategoryStats, () => t('home.stats.loadFailed.category'))
}

// 数据集离子源类型分布
export function useDatasetIonSourceStats() {
  return useCategoryDistribution(getDatasetIonSourceStats, () =>
    t('home.stats.loadFailed.ionSource'),
  )
}

// 分析器类型分布
export function useAnalyzerStats() {
  return useCategoryDistribution(getAnalyzerStats, () => t('home.stats.loadFailed.analyzer'))
}

function useRemoteStat<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  errorMessage: () => string,
) {
  const { data: stats, ...request } = useStatRequest(fetcher, (cause) =>
    cause instanceof Error ? cause.message : errorMessage(),
  )
  return { stats, ...request }
}

// 平台总览（总用户 / 总数据集 / 总下载）
export function usePlatformOverview() {
  return useRemoteStat(getPlatformOverview, () => t('home.stats.loadFailed.platform'))
}

// 全站访问量（当日 / 当月 / 总计）
export function useVisitsStats() {
  return useRemoteStat(getVisitsStats, () => t('home.stats.loadFailed.visits'))
}
