import { useLatestRequest } from '@/shared/composables/useLatestRequest'
import { usePagination } from '@/shared/composables/usePagination'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { t } from '@/i18n'
import { useAuthStore } from '@/shared/auth/authStore'
import { DATABASE_SOURCES } from '../sources'
import type {
  DatabaseFilterValue,
  DatabaseFilterValues,
  DatabaseRow,
  DatabaseSource,
} from '../types/database'

/**
 * 数据库浏览页的列表状态：当前数据源 + 关键词/筛选控件 + 分页。
 *
 * 页面要求登录（未登录时视图层渲染登录引导）：未登录不取数；登入/登出时随
 * auth store 的 token 变化自动取数或清空。数据源切换是内存操作：关键词、筛选
 * 与页码复位后按新 source 的 fetcher 重新拉取。
 */
export function useDatabaseList() {
  const requests = useLatestRequest()
  const auth = useAuthStore()

  const sources = DATABASE_SOURCES
  const activeId = ref(DATABASE_SOURCES[0]!.id)
  const activeSource = computed<DatabaseSource>(
    () => DATABASE_SOURCES.find((s) => s.id === activeId.value) ?? DATABASE_SOURCES[0]!,
  )

  // 本页每页条数独立于全局 config.json：参考库单页信息量大，默认 50、可切 100
  // （后端 size 上限 100，不再提供更大的档位）。
  const PAGE_SIZE_OPTIONS = [50, 100]
  const pageSizeOptions = PAGE_SIZE_OPTIONS
  const pager = usePagination(() => fetchPage(), PAGE_SIZE_OPTIONS[0])
  const { page: currentPage, size: pageSize } = pager

  // State
  const rows = ref<DatabaseRow[]>([])
  const loading = ref(true)
  const error = ref('')
  const keyword = ref('')

  // 额外筛选控件的当前值（键与 activeSource.filterControls 的 key 对应），
  // 随「搜索」一并提交给 fetcher
  const filterValues = reactive<DatabaseFilterValues>({})
  const setFilter = (key: string, value: DatabaseFilterValue) => {
    filterValues[key] = value
  }
  /** 任一筛选控件有值：控制「清除」按钮的显隐 */
  const filtersActive = computed(() =>
    Object.values(filterValues).some((v) =>
      typeof v === 'string' ? v !== '' : v.min != null || v.max != null,
    ),
  )

  /** 未登录 / 登出：清空列表与分页，视图层显示登录引导 */
  const clearRows = () => {
    requests.invalidate()
    pager.reset()
    rows.value = []
    loading.value = false
    error.value = ''
  }

  const fetchPage = async () => {
    const isCurrent = requests.begin()
    // 页面要求登录：匿名不取数（不打扰后端、也不闪一帧样本数据）
    if (!auth.token) {
      clearRows()
      return
    }
    loading.value = true
    error.value = ''
    try {
      const res = await activeSource.value.fetcher({
        keyword: keyword.value,
        filters: { ...filterValues },
        page: currentPage.value,
        size: pageSize.value,
      })
      if (!isCurrent()) return
      rows.value = res.data
      pager.setMeta(res.meta)
    } catch (e) {
      if (!isCurrent()) return
      console.error('Failed to load database page:', e)
      error.value =
        e instanceof Error && e.message
          ? e.message
          : t('common.feedback.loadFailed', { target: t('databases.title') })
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  /** 清空筛选控件（不动关键词） */
  const clearFilters = () => {
    for (const key of Object.keys(filterValues)) delete filterValues[key]
  }

  /** 切换数据源 tab：关键词、筛选与页码复位后按新 fetcher 重拉 */
  const switchSource = (id: string) => {
    if (id === activeId.value) return
    activeId.value = id
    keyword.value = ''
    clearFilters()
    currentPage.value = 1
    fetchPage()
  }

  const handleSearch = () => {
    currentPage.value = 1
    fetchPage()
  }

  /** 清空整个搜索表单：关键词 + 筛选控件，然后重拉 */
  const resetSearch = () => {
    keyword.value = ''
    clearFilters()
    handleSearch()
  }

  onMounted(fetchPage)

  // 同标签页登录/登出、其他标签页会话变化都会更新 store.token：
  // 登入即取数，登出即清空（视图随之切到登录引导）
  watch(
    () => auth.token,
    (token) => {
      if (token) fetchPage()
      else clearRows()
    },
    { flush: 'sync' },
  )

  return {
    sources,
    activeId,
    activeSource,
    rows,
    loading,
    error,
    keyword,
    filterValues,
    filtersActive,
    setFilter,
    currentPage,
    pageSize,
    pageSizeOptions,
    meta: pager.meta,
    pageRange: pager.pageRange,
    fetchPage,
    switchSource,
    handleSearch,
    resetSearch,
    goToPage: pager.goToPage,
    changeSize: pager.changeSize,
  }
}
