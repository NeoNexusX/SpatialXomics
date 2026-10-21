import { computed, reactive, ref } from 'vue'
import { mapItemToDataset } from '@/features/datasets/mappers/datasetMapper'
import { buildPageList } from '@/shared/utils/pagination'
import { getConfig } from '@/shared/config/runtimeConfig'
import type { File } from '@/features/datasets/types/dataset'
import type { FileListSort } from '@/features/datasets/api/datasetApi'
import { t } from '@/i18n'

type Fetcher = (
  filters: Record<string, any>,
  page: number,
  size: number,
  sort?: FileListSort,
) => Promise<any>

/** 前端排序键 → 后端 sort_by 白名单（submission_time=上传时间，size_bytes=文件大小） */
function toServerSort(key: string): FileListSort['sortBy'] {
  return key === 'size_bytes' ? 'size' : 'uploaded_at'
}

export function useDatasetList(
  // Arguments
  fetcher: Fetcher,
  opts?: { defaultFilters?: Record<string, any>; initialSort?: string; initialDesc?: boolean },
) {
  const defaultFilters = opts?.defaultFilters || {}
  const initialSort = opts?.initialSort || 'submission_time'
  const initialDesc = opts?.initialDesc ?? true

  // State
  const datasets = ref<File[]>([])
  const loading = ref(false)
  const error = ref('')

  const meta = reactive({ current_page: 1, current_records: 0, total_pages: 1, total_records: 0 })
  const page = ref<number>(1)
  const size = ref<number>(getConfig().pagination.defaultPageSize)

  const filters = reactive({ ...defaultFilters })

  const currentSort = ref<string>(initialSort)
  const sortDesc = ref<boolean>(initialDesc)

  // Computed
  const pagination = computed<(number | string)[]>(() =>
    buildPageList(meta.current_page, meta.total_pages),
  )

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
    loading.value = true
    error.value = ''
    const p = opts?.page ?? page.value
    const s = opts?.size ?? size.value
    const sort: FileListSort = {
      sortBy: toServerSort(currentSort.value),
      order: sortDesc.value ? 'desc' : 'asc',
    }
    try {
      // fetcher 现已返回解包后的响应体（{ data, meta }），不再是 axios response
      const data = (await fetcher(normalizeFilters(filters as Record<string, any>), p, s, sort)) || {}

      if (data.meta) {
        meta.current_page = data.meta.current_page || p
        meta.current_records =
          data.meta.current_records || (Array.isArray(data.data) ? data.data.length : 0)
        meta.total_pages = data.meta.total_pages || 1
        meta.total_records = data.meta.total_records || meta.current_records
      }

      // 排序已由服务端完成（同值行按 public_id 倒序兜底），前端不再重排
      datasets.value = Array.isArray(data.data)
        ? data.data.map((it: any, idx: number) => mapItemToDataset(it, idx))
        : []
      page.value = p
      size.value = s
    } catch (err: any) {
      // 不向外显底层错误内容（状态码/堆栈），统一一句话；原因留控制台
      console.error('[useDatasetList] load failed:', err)
      error.value = t('common.feedback.loadFailed', { target: t('datasets.list.target') })
      datasets.value = []
    } finally {
      loading.value = false
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

  const goToPage = (np: number) => {
    if (np < 1) np = 1
    if (np > (meta.total_pages || 1)) np = meta.total_pages || 1
    page.value = np
    fetchFiles({ page: np, size: size.value })
  }

  const changeSize = (newSize: number) => {
    size.value = newSize
    page.value = 1
    fetchFiles({ page: 1, size: newSize })
  }

  return {
    datasets,
    loading,
    error,
    meta,
    page,
    size,
    filters,
    fetchFiles,
    applyFilters,
    handleSort,
    goToPage,
    changeSize,
    pagination,
  }
}
