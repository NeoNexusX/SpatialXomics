import { useLatestRequest } from '@/shared/composables/useLatestRequest'
import { usePagination } from '@/shared/composables/usePagination'
import { reactive, ref } from 'vue'
import { mapItemToDataset } from '@/features/datasets/mappers/datasetMapper'
import type { Page } from '@/shared/api/response'
import type { File } from '@/features/datasets/types/dataset'
import type { FileListSort } from '@/features/datasets/api/datasetApi'
import { t } from '@/i18n'

export type DatasetFetcher = (
  filters: Record<string, any>,
  page: number,
  size: number,
  sort?: FileListSort,
) => Promise<Page<unknown>>

/** 前端排序键 → 后端 sort_by 白名单（submission_time=上传时间，size_bytes=文件大小） */
function toServerSort(key: string): FileListSort['sortBy'] {
  return key === 'size_bytes' ? 'size' : 'uploaded_at'
}

export function useDatasetList(
  // Arguments
  fetcher: DatasetFetcher,
  opts?: { defaultFilters?: Record<string, any>; initialSort?: string; initialDesc?: boolean },
) {
  const defaultFilters = opts?.defaultFilters || {}
  const initialSort = opts?.initialSort || 'submission_time'
  const initialDesc = opts?.initialDesc ?? true

  // State
  const requests = useLatestRequest()
  const datasets = ref<File[]>([])
  const loading = ref(false)
  const error = ref('')

  const pager = usePagination(() => fetchFiles())
  const { page, size } = pager

  const filters = reactive({ ...defaultFilters })

  const currentSort = ref<string>(initialSort)
  const sortDesc = ref<boolean>(initialDesc)

  // Methods
  const normalizeFilters = (f: Record<string, any>) => {
    const out: Record<string, any> = {}
    for (const k in f) {
      const v = (f as any)[k]
      if (v === null || v === undefined) {
        out[k] = ''
      } else if (Array.isArray(v)) {
        out[k] = v.length === 0 ? '' : v
      } else {
        out[k] = v
      }
    }
    return out
  }

  const fetchFiles = async (opts?: { page?: number; size?: number }) => {
    if (opts?.page) page.value = opts.page
    if (opts?.size) size.value = opts.size
    const isCurrent = requests.begin()
    loading.value = true
    error.value = ''
    const sort: FileListSort = {
      sortBy: toServerSort(currentSort.value),
      order: sortDesc.value ? 'desc' : 'asc',
    }
    try {
      const res = await fetcher(normalizeFilters(filters as Record<string, any>), page.value, size.value, sort)
      if (!isCurrent()) return
      // The server owns ordering and may clamp an out-of-range page.
      datasets.value = res.data.map((it, idx) => mapItemToDataset(it, idx))
      pager.setMeta(res.meta)
    } catch (err: any) {
      if (!isCurrent()) return
      // 不向外显底层错误内容（状态码/堆栈），统一一句话；原因留控制台
      console.error('[useDatasetList] load failed:', err)
      error.value = t('common.feedback.loadFailed', { target: t('datasets.list.target') })
      datasets.value = []
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  const applyFilters = (payload: Record<string, any>) => {
    Object.assign(filters, payload)
    page.value = 1
  }

  const handleSort = (sortValue: string) => {
    // 复合值 'field:order'（DatasetFilterBar 下拉产生）：方向显式携带，直接生效；
    // 兼容不带方向的旧值（缺省 desc）
    const [field, order] = sortValue.split(':')
    currentSort.value = field || 'submission_time'
    sortDesc.value = order !== 'asc'
    // 服务端排序：换排序后回到第一页重新拉取
    fetchFiles({ page: 1, size: size.value })
  }

  return {
    datasets,
    loading,
    error,
    meta: pager.meta,
    page,
    size,
    filters,
    fetchFiles,
    applyFilters,
    handleSort,
    goToPage: pager.goToPage,
    changeSize: pager.changeSize,
    pagination: pager.pageRange,
  }
}
