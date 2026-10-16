import { computed, onMounted, reactive, ref } from 'vue'
import { t } from '@/i18n'
import { buildPageList } from '@/shared/utils/pagination'
import { getConfig } from '@/shared/config/runtimeConfig'
import { DATABASE_SOURCES } from '../sources'
import type { DatabaseRow, DatabaseSource } from '../types/database'

/**
 * 数据库浏览页的列表状态：当前数据源 + 关键词 + 分页。
 *
 * 骨架照抄 useUserManagement（同款 meta 信封、页码钳位与重置逻辑），去掉了管理端
 * 的抽屉 / 配额部分。数据源切换是内存操作：关键词与页码复位后按新 source 的
 * fetcher 重新拉取。
 */
export function useDatabaseList() {
  const sources = DATABASE_SOURCES
  const activeId = ref(DATABASE_SOURCES[0]!.id)
  const activeSource = computed<DatabaseSource>(
    () => DATABASE_SOURCES.find((s) => s.id === activeId.value) ?? DATABASE_SOURCES[0]!,
  )

  // Pagination — same pattern as useUserManagement
  const currentPage = ref(1)
  const pageSize = ref<number>(getConfig().pagination.defaultPageSize)
  const pageSizeOptions = getConfig().pagination.pageSizeOptions
  const meta = reactive({ current_page: 1, total_pages: 1, total_records: 0 })

  const pageRange = computed<(number | string)[]>(() =>
    buildPageList(meta.current_page, meta.total_pages),
  )

  // State
  const rows = ref<DatabaseRow[]>([])
  const loading = ref(true)
  const error = ref('')
  const keyword = ref('')

  const fetchPage = async () => {
    loading.value = true
    error.value = ''
    try {
      const res = await activeSource.value.fetcher({
        keyword: keyword.value,
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

  /** 切换数据源 tab：关键词与页码复位后按新 fetcher 重拉 */
  const switchSource = (id: string) => {
    if (id === activeId.value) return
    activeId.value = id
    keyword.value = ''
    currentPage.value = 1
    fetchPage()
  }

  const handleSearch = () => {
    currentPage.value = 1
    fetchPage()
  }

  const resetKeyword = () => {
    keyword.value = ''
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

  return {
    sources,
    activeId,
    activeSource,
    rows,
    loading,
    error,
    keyword,
    currentPage,
    pageSize,
    pageSizeOptions,
    meta,
    pageRange,
    fetchPage,
    switchSource,
    handleSearch,
    resetKeyword,
    goToPage,
    changeSize,
  }
}
