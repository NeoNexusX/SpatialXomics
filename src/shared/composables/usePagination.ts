import { computed, reactive, ref } from 'vue'
import type { PageMeta } from '@/shared/api/response'
import { getConfig } from '@/shared/config/runtimeConfig'
import { buildPageList } from '@/shared/utils/pagination'

/**
 * 服务端分页的状态：页码、每页条数、接口返回的 meta，以及给 PaginationFooter 的页码序列。
 * load 按当前 page / size 取数，拿到结果后调用 setMeta；翻页和改条数都会调用它。
 */
export function usePagination(load: () => unknown, initialSize = getConfig().pagination.defaultPageSize) {
  const page = ref(1)
  const size = ref(initialSize)
  const meta = reactive<PageMeta>({ current_page: 1, total_pages: 1, total_records: 0 })
  const pageRange = computed(() => buildPageList(meta.current_page, meta.total_pages))

  /** 写入接口返回的 meta。后端会把越界的页码收回来，以它返回的为准 */
  function setMeta(next: PageMeta) {
    Object.assign(meta, next)
    page.value = next.current_page
  }

  function goToPage(target: number) {
    const clamped = Math.min(Math.max(target, 1), meta.total_pages)
    if (clamped === page.value) return
    page.value = clamped
    return load()
  }

  function changeSize(next: number) {
    size.value = next
    page.value = 1
    return load()
  }

  /** 回到第一页、零条，比如退出登录后清空列表 */
  function reset() {
    setMeta({ current_page: 1, total_pages: 1, total_records: 0 })
  }

  return { page, size, meta, pageRange, setMeta, goToPage, changeSize, reset }
}
