import { useLatestRequest } from '@/shared/composables/useLatestRequest'
import { usePagination } from '@/shared/composables/usePagination'
import { computed, onMounted, reactive, ref } from 'vue'
import { listMyProcesses, deleteProcess, getProcessingStats, type ProcessRunFilter } from '@/features/datasets/api/datasetApi'
import type { ProcessItem } from '@/features/datasets/types/dataset'
import { parseAlgorithms } from '@/shared/utils/methodsNormalize'
import { parseUtcDate } from '@/shared/utils/date'
import { formatDate, formatDateTime, formatTime } from '@/shared/utils/format'
import { t } from '@/i18n'

export interface TaskRow {
  id: string
  name: string
  dataset: string
  filename: string
  filePublicId: string
  methods: string[]
  status: string
  created: string
  createdDate: string
  createdTime: string
  createdAt: string
  finishedDate: string
  finishedTime: string
  finishedAt: string | null
  errorMessage: string | null
}

export function useWorkspaceDashboard() {
  const requests = useLatestRequest()
  const processes = ref<ProcessItem[]>([])
  const loading = ref(false)

  // Pagination (后端分页)
  const pager = usePagination(() => fetchProcesses())
  const { page, size } = pager

  // ── Computed ────────────────────────────────────────────────────
  function toTaskRow(p: ProcessItem): TaskRow {
    const createdDate = parseUtcDate(p.created_at)
    const finishedDate = parseUtcDate(p.finished_at)
    return {
      id: String(p.id),
      name: t('workspace.table.processName', { id: p.id }),
      dataset: getFileName(p),
      filename: p.filename || '',
      filePublicId: p.source_file_public_id,
      methods: parseAlgorithms(p.params_json),
      status: p.status,
      created: formatDateTime(createdDate),
      createdDate: formatDate(createdDate),
      createdTime: formatTime(createdDate),
      createdAt: p.created_at,
      finishedDate: formatDate(finishedDate),
      finishedTime: formatTime(finishedDate),
      finishedAt: p.finished_at,
      errorMessage: p.error_message || null,
    }
  }

  /** 后端已按最新在前返回，直接映射 */
  const recentResults = computed<TaskRow[]>(() =>
    (processes.value ?? []).map(toTaskRow),
  )

  const summary = reactive({ running: 0, completed: 0, failed: 0 })

  // ── Methods ─────────────────────────────────────────────────────
  function getFileName(p: ProcessItem): string {
    return (p.filename || t('workspace.table.unknownFile')).replace(/\.[^.]+$/, '')
  }

  async function fetchStats() {
    try {
      const stats = await getProcessingStats()
      summary.running = stats.processing ?? 0
      summary.completed = stats.completed ?? 0
      summary.failed = stats.failed ?? 0
    } catch (e) {
      console.error('Failed to fetch processing stats:', e)
    }
  }

  // 已提交的模糊筛选。只按源文件名（filename）匹配，与 PublicDatasets 搜索一致；
  // params 字段暂空置——RunFilter 是 AND 语义，同时发 filename+params 会互相收窄
  // 导致几乎搜不到，所以一次只发一个字段。
  const filter = ref<ProcessRunFilter>({})

  /** 提交搜索：非空则按文件名模糊匹配并回到第 1 页，空串清空筛选 */
  function applySearch(query: string) {
    const q = query.trim()
    filter.value = q ? { filename: q } : {}
    return fetchProcesses({ page: 1, size: size.value })
  }

  async function fetchProcesses(opts?: { page?: number; size?: number }) {
    if (opts?.page) page.value = opts.page
    if (opts?.size) size.value = opts.size
    const isCurrent = requests.begin()
    loading.value = true
    try {
      const result = await listMyProcesses(page.value, size.value, filter.value)
      if (!isCurrent()) return
      processes.value = result.data
      pager.setMeta(result.meta)
    } catch (e) {
      if (!isCurrent()) return
      console.error('Failed to fetch processes:', e)
      processes.value = []
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  // ── Delete ──────────────────────────────────────────────────────
  async function deleteResult(id: string) {
    try {
      await deleteProcess(id)
      // 从服务端刷新当前页，保持 meta 一致
      await fetchProcesses({ page: page.value, size: size.value })
      // 如果当前页已空且不是第一页，回退一页
      if (processes.value.length === 0 && page.value > 1) {
        fetchProcesses({ page: page.value - 1, size: size.value })
      }
      fetchStats()
    } catch (e) {
      console.error('Failed to delete process:', e)
      throw e
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────
  onMounted(() => {
    fetchStats()
    fetchProcesses()
  })

  return {
    loading,
    recentResults,
    summary,
    page,
    size,
    meta: pager.meta,
    pagination: pager.pageRange,
    goToPage: pager.goToPage,
    changeSize: pager.changeSize,
    deleteResult,
    applySearch,
  }
}
