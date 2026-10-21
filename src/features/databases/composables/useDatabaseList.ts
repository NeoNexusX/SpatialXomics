import { computed, onMounted, reactive, ref, watch } from 'vue'
import { t } from '@/i18n'
import { useAuthStore } from '@/shared/auth/authStore'
import { buildPageList } from '@/shared/utils/pagination'
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
 * auth store 的 token 变化自动取数或清空。骨架照抄 useUserManagement（同款
 * meta 信封、页码钳位与重置逻辑）。数据源切换是内存操作：关键词、筛选与页码
 * 复位后按新 source 的 fetcher 重新拉取。
 */
export function useDatabaseList() {
  const auth = useAuthStore()
  const loggedIn = computed(() => !!auth.token)

  const sources = DATABASE_SOURCES
  const activeId = ref(DATABASE_SOURCES[0]!.id)
  const activeSource = computed<DatabaseSource>(
    () => DATABASE_SOURCES.find((s) => s.id === activeId.value) ?? DATABASE_SOURCES[0]!,
  )

  // Pagination — same pattern as useUserManagement. 本页每页条数独立于全局
  // config.json：参考库单页信息量大，默认 50、可切 100（后端 size 上限 100，
  // 不再提供更大的档位）。
  const PAGE_SIZE_OPTIONS = [50, 100]
  const currentPage = ref(1)
  const pageSize = ref<number>(PAGE_SIZE_OPTIONS[0]!)
  const pageSizeOptions = PAGE_SIZE_OPTIONS
  const meta = reactive({ current_page: 1, total_pages: 1, total_records: 0 })

  const pageRange = computed<(number | string)[]>(() =>
    buildPageList(meta.current_page, meta.total_pages),
  )

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
    rows.value = []
    meta.current_page = 1
    meta.total_pages = 1
    meta.total_records = 0
    loading.value = false
    error.value = ''
  }

  const fetchPage = async () => {
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
      rows.value = res.data
      meta.current_page = res.meta?.current_page || currentPage.value
      meta.total_pages = res.meta?.total_pages || 1
      meta.total_records = res.meta?.total_records || rows.value.length
    } catch (e) {
      console.error('Failed to load database page:', e)
      error.value =
        e instanceof Error && e.message
          ? e.message
          : t('common.feedback.loadFailed', { target: t('databases.title') })
    } finally {
      loading.value = false
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

  const goToPage = (np: number) => {
    const clamped = Math.max(1, Math.min(meta.total_pages || 1, np))
    if (clamped === currentPage.value) return
    currentPage.value = clamped
    fetchPage()
  }

  const changeSize = (newSize: number) => {
    pageSize.value = newSize
    currentPage.value = 1
    fetchPage()
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
  )

  return {
    sources,
    activeId,
    activeSource,
    loggedIn,
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
    meta,
    pageRange,
    fetchPage,
    switchSource,
    handleSearch,
    resetSearch,
    goToPage,
    changeSize,
  }
}
