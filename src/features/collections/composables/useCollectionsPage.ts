import { useLatestRequest } from '@/shared/composables/useLatestRequest'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useAuthStore } from '@/shared/auth/authStore'
import { getConfig } from '@/shared/config/runtimeConfig'
import { buildPageList } from '@/shared/utils/pagination'
import {
  collectionErrorMessage,
  deleteCollection,
  listAllCollections,
  listCollections,
} from '../api/collectionApi'
import type { CollectionListMeta, CollectionSummary } from '../types/collection'
import { t } from '@/i18n'

// 每页条数与数据集列表一致，走全局 config（默认 10，选项 [6,10,20]）

/**
 * Collections 列表页装配：取数（服务端分页）/ 范围切换 / 搜索 / 删除。
 *
 * 数据源（均按 updated_at 倒序，服务端分页 {meta, data}）：
 * - 默认 POST /collections/list_all —— 全库集合（浏览全部，含他人集合）；
 * - 勾选「My collections only」后走 POST /collections/list —— 仅当前登录用户的集合。
 * 后端未提供集合搜索/排序参数：排序固定 updated_at 倒序（无控件），
 * search 通过 name 字段走服务端筛选，跨全部分页生效。
 * 写操作（删除）仅对 owner/admin 开放（canEdit）。Create 走独立页面 /collections/new；
 * Edit 内嵌在 overview 页。
 */
export function useCollectionsPage() {
  const requests = useLatestRequest()
  const auth = useAuthStore()

  // 当前页服务端数据；筛选和搜索均由后端执行
  const rows = ref<CollectionSummary[]>([])
  const loading = ref(false)
  const error = ref('')
  const page = ref(1)
  const size = ref(getConfig().pagination.defaultPageSize || 10)
  const mineOnly = ref(false)
  const search = ref('')

  const meta = reactive<CollectionListMeta>({
    current_page: 1,
    current_records: 0,
    total_pages: 1,
    total_records: 0,
  })

  // 服务端筛选体（§4.3）：name/title/journal_name/owner_username 模糊、
  // member_type/collection_type 精确、词表字段「集合内包含」；多值数组 = OR。
  // 空数组/空串后端视为不筛选，直接透传即可
  const filters = ref<Record<string, string | string[]>>({})

  // 严格归属（不含 admin），卡片据此显示 My Collection 徽标
  const isMine = (c: CollectionSummary) =>
    !!auth.user && c.ownerUsername === auth.user.username

  // 所有者或管理员才能删除/编辑（列表含他人集合，与后端写权限一致）
  const canEdit = (c: CollectionSummary) => isMine(c) || auth.isAdmin

  async function fetchPage(targetPage = page.value) {
    const isCurrent = requests.begin()
    loading.value = true
    error.value = ''
    try {
      const fetcher = mineOnly.value ? listCollections : listAllCollections
      const res = await fetcher(targetPage, size.value, filters.value)
      if (!isCurrent()) return
      rows.value = res.data
      Object.assign(meta, res.meta)
      page.value = res.meta.current_page || targetPage
    } catch (err: any) {
      if (!isCurrent()) return
      error.value = collectionErrorMessage(
        err,
        t('common.feedback.loadFailed', { target: t('collections.list.target') }),
      )
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  const pagination = computed(() => buildPageList(page.value, meta.total_pages))

  /** 搜索走服务端 name 模糊（跨全部分页）；title 命中不再覆盖——
   *  后端筛选字段间是 AND，表达不了 name/title 的 OR。
   *  与筛选面板的 name 字段同源：面板 Apply 会整体替换 filters（含 name），
   *  与数据集页 search ↔ filename 的既有行为一致 */
  const handleSearch = (q: string) => {
    search.value = q
    filters.value = { ...filters.value, name: q || '' }
    fetchPage(1)
  }

  const clearSearch = () => handleSearch('')

  /** 应用筛选面板的 payload：整体替换并回第一页重新拉取 */
  const applyFilters = (payload: Record<string, string | string[]>) => {
    filters.value = payload
    fetchPage(1)
  }

  // 范围切换：回到第一页重新拉取（两个接口的数据集不同，页码不可比）
  watch(mineOnly, () => fetchPage(1))

  const goToPage = (p: number) => {
    fetchPage(p)
  }

  const changeSize = (s: number) => {
    size.value = s
    fetchPage(1)
  }

  /** 删除集合（不动文件）。成功/失败提示由调用方的 useConfirmDelete 统一负责；
   *  服务端分页下重拉当前页，尾页删尽则回落一页 */
  async function removeCollection(publicId: string) {
    await deleteCollection(publicId)
    const target = rows.value.length <= 1 && page.value > 1 ? page.value - 1 : page.value
    await fetchPage(target)
  }

  onMounted(() => fetchPage())

  return {
    collections: rows,
    loading,
    error,
    meta,
    page,
    size,
    mineOnly,
    search,
    pagination,
    canEdit,
    isMine,
    handleSearch,
    clearSearch,
    applyFilters,
    goToPage,
    changeSize,
    removeCollection,
  }
}
