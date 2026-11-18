import { computed, onMounted, ref } from 'vue'
import { t } from '@/i18n'
import {
  getDatasetCategoryStats,
  getDatasetIonSourceStats,
  getOrganismStats,
  getAnalyzerStats,
  getPlatformOverview,
  getVisitsStats,
} from '../api/statsApi'
import type { DatasetCategoryItem, DatasetCategoryStats } from '@/features/home/types/stats'
import { collapseTopCategories } from '../utils/collapseCategories'

/**
 * 首页统计的响应式状态封装。
 *
 * 取数全部在 {@link ../api/statsApi} 里，这里只把结果接到 loading / error / data 三态，
 * 组件不直接 fetch（与 useCommitHeatmap 的分层一致）。各环形图 / stat 来自互相独立的接口，
 * 因此每个都拆成各自维护加载/错误状态的 composable，互不影响。
 */

/**
 * 「分类分布环形图」通用三态封装：分类分布与离子源类型分布结构一致
 * （{ category, count } + total），共用同一份取数→三态逻辑，只是注入不同的 fetcher。
 */
function useCategoryDistribution(
  fetcher: () => Promise<DatasetCategoryStats>,
  errorMessage: () => string,
) {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const items = ref<DatasetCategoryItem[]>([])
  const total = ref(0)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const r = await fetcher()
      const rawItems = r.items ?? []
      // 环形图只展示前 10 项，其余合并为 Other；total 仍按完整数据计算
      items.value = collapseTopCategories(rawItems, 'Other')
      // 后端未返回 total 时，用各分段计数自行累加兜底
      total.value = r.total ?? rawItems.reduce((s, i) => s + i.count, 0)
    } catch (e) {
      error.value = e instanceof Error ? e.message : errorMessage()
      items.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  const isEmpty = computed(() => !loading.value && !error.value && items.value.length === 0)

  onMounted(load)

  return { loading, error, items, total, isEmpty, reload: load }
}

// 物种分布
export function useOrganismStats() {
  return useCategoryDistribution(getOrganismStats, () => t('home.stats.loadFailed.organism'))
}

// 数据集分类分布（上方环形图）
export function useDatasetCategoryStats() {
  return useCategoryDistribution(getDatasetCategoryStats, () => t('home.stats.loadFailed.category'))
}

// 数据集离子源类型分布（下方环形图）
export function useDatasetIonSourceStats() {
  return useCategoryDistribution(getDatasetIonSourceStats, () => t('home.stats.loadFailed.ionSource'))
}

// 分析器类型分布
export function useAnalyzerStats() {
  return useCategoryDistribution(getAnalyzerStats, () => t('home.stats.loadFailed.analyzer'))
}

/**
 * 单值统计（平台总览 / 访问量）通用三态封装：loading / error / data + onMounted 加载。
 * 与 useCategoryDistribution 同一骨架，只是注入不同的 fetcher。
 */
function useRemoteStat<T>(fetcher: () => Promise<T>, errorMessage: () => string) {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const stats = ref<T | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      stats.value = await fetcher()
    } catch (e) {
      error.value = e instanceof Error ? e.message : errorMessage()
      stats.value = null
    } finally {
      loading.value = false
    }
  }

  onMounted(load)

  return { loading, error, stats, reload: load }
}

// 平台总览（总用户 / 总数据集 / 总下载）
export function usePlatformOverview() {
  return useRemoteStat(getPlatformOverview, () => t('home.stats.loadFailed.platform'))
}

// 全站访问量（当日 / 当月 / 总计）
export function useVisitsStats() {
  return useRemoteStat(getVisitsStats, () => t('home.stats.loadFailed.visits'))
}
