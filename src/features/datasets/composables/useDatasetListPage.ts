import { useRouter } from 'vue-router'
import { useDatasetList, type DatasetFetcher } from '@/features/datasets/composables/useDatasetList'
import { useDatasetListRouteState } from '@/features/datasets/composables/useDatasetListRouteState'
import { useAuthStore } from '@/shared/auth/authStore'

/**
 * MyDatasets / PublicDatasets 两个列表页共用的装配逻辑：
 * useDatasetList（取数/排序/分页）+ useDatasetListRouteState（搜索/筛选/分页状态）
 * + 上传成功后的当前页刷新 + 跳转 Dataset Overview。
 * 页面间的差异（配额条、删除流程、登录门槛、?upload=1 等）仍由各页面自己处理。
 */
export function useDatasetListPage(
  fetcher: DatasetFetcher,
  opts: {
    source: 'my' | 'public'
    defaultFilters?: Record<string, any>
    onMountedReady?: () => void
  },
) {
  const router = useRouter()
  const auth = useAuthStore()

  // Use composable for datasets (fetch/map/pagination/sort)
  const {
    datasets,
    loading,
    error,
    meta,
    page,
    size,
    fetchFiles,
    applyFilters,
    handleSort,
    goToPage,
    changeSize,
    pagination,
  } = useDatasetList(fetcher, {
    defaultFilters: opts.defaultFilters,
    initialSort: 'submission_time',
    initialDesc: true,
  })

  const { handleSearch, handleApplyFilters } = useDatasetListRouteState({
    page,
    size,
    auth,
    fetchFiles,
    applyFilters,
    onMountedReady: opts.onMountedReady,
  })

  /** 上传成功后刷新当前页；弹窗关闭、配额刷新等由页面各自处理 */
  const refreshCurrentPage = () => fetchFiles({ page: page.value, size: size.value })

  /** 新标签页打开 /overview/{public_id}：URL 带参，刷新/收藏/登录回跳都不丢。
   *  来源列表（my/public）走 query —— history.state 出不了本标签，Back 按钮的
   *  去向由 query 恢复；noopener 断开 window.opener，标准新页签安全默认。 */
  const viewOverview = (publicId: string) => {
    const href = router.resolve({
      name: 'DatasetOverview',
      params: { publicId },
      query: { source: opts.source },
    }).href
    window.open(href, '_blank', 'noopener')
  }

  return {
    datasets,
    loading,
    error,
    meta,
    page,
    size,
    pagination,
    fetchFiles,
    handleSort,
    handleSearch,
    handleApplyFilters,
    goToPage,
    changeSize,
    refreshCurrentPage,
    viewOverview,
  }
}
