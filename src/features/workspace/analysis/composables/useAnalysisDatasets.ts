import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listUserFiles, listFiles } from '@/features/datasets/api/datasetApi'
import { useDatasetList } from '@/features/datasets/composables/useDatasetList'

export function useAnalysisDatasets() {
  // My Datasets
  const {
    datasets: myDatasets,
    loading: myLoading,
    error: myError,
    fetchFiles: fetchMyFiles,
    meta: myMeta,
    page: myPage,
    size: mySize,
    pagination: myPagination,
    goToPage: myGoToPage,
    applyFilters: myApplyFilters,
  } = useDatasetList((filters, page, size) => listUserFiles(filters, page, size))

  // Public Datasets
  const {
    datasets: publicDatasets,
    loading: publicLoading,
    error: publicError,
    fetchFiles: fetchPublicFiles,
    meta: publicMeta,
    page: publicPage,
    size: publicSize,
    pagination: publicPagination,
    goToPage: publicGoToPage,
    applyFilters: publicApplyFilters,
  } = useDatasetList((filters, page, size) => listFiles(filters, page, size, true))

  // State
  const activeTab = ref<'my' | 'public'>('my')
  const datasetQuery = ref('')
  const selectedDataset = ref<any>(null)

  // Derive current tab's data
  const datasets = computed(() => (activeTab.value === 'public' ? publicDatasets.value : myDatasets.value))
  const loading = computed(() => (activeTab.value === 'public' ? publicLoading.value : myLoading.value))
  const error = computed(() => (activeTab.value === 'public' ? publicError.value : myError.value))
  const meta = computed(() => (activeTab.value === 'public' ? publicMeta : myMeta))
  const page = computed(() => (activeTab.value === 'public' ? publicPage.value : myPage.value))
  const pagination = computed(() => (activeTab.value === 'public' ? publicPagination.value : myPagination.value))

  const goToPage = (np: number) => {
    if (activeTab.value === 'public') publicGoToPage(np)
    else myGoToPage(np)
  }

  // Methods
  const selectDataset = (dataset: any) => {
    selectedDataset.value = dataset
  }

  // Watchers

  // 防抖服务器端搜索。过滤键与数据集列表页一致用 filename（不是 name）。
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const runSearch = (query: string) => {
    const filters = { filename: query.trim() }
    if (activeTab.value === 'public') {
      publicApplyFilters(filters)
      fetchPublicFiles({ page: 1, size: publicSize.value })
    } else {
      myApplyFilters(filters)
      fetchMyFiles({ page: 1, size: mySize.value })
    }
  }
  watch(datasetQuery, (query) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => runSearch(query), 300)
  })

  // 切 tab 时用当前搜索词重新拉取，避免沿用上一个 tab 的过滤结果
  watch(activeTab, () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    runSearch(datasetQuery.value)
  })

  // Clear any pending debounced search on unmount so it can't fire
  // fetch on a destroyed component
  onBeforeUnmount(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  })

  // Lifecycle
  onMounted(() => {
    fetchMyFiles().catch(() => {})
    fetchPublicFiles().catch(() => {})
  })

  return {
    activeTab,
    datasetQuery,
    selectedDataset,
    datasets,
    loading,
    error,
    meta,
    page,
    pagination,
    goToPage,
    selectDataset,
  }
}
