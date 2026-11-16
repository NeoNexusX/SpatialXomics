import { onMounted, type Ref } from 'vue'
import type { useAuthStore } from '@/shared/auth/authStore'

type FetchFiles = (opts?: { page?: number; size?: number }) => Promise<void>
type ApplyFilters = (payload: Record<string, any>) => void

interface DatasetRouteStateOptions {
  page: Ref<number>
  size: Ref<number>
  auth: ReturnType<typeof useAuthStore>
  fetchFiles: FetchFiles
  applyFilters: ApplyFilters
  onMountedReady?: () => void
}

export function useDatasetListRouteState(options: DatasetRouteStateOptions) {
  // Methods
  const fetchCurrentPage = () =>
    options.fetchFiles({ page: options.page.value, size: options.size.value })

  const initializeFromRoute = () => {
    // 不再从 URL 读取分页参数，始终从第一页开始
    const load = () => options.fetchFiles({ page: options.page.value, size: options.size.value })
    if (!options.auth.user && options.auth.token) {
      options.auth.fetchUser().finally(load)
    } else {
      load()
    }
    options.onMountedReady?.()
  }

  // applyFilters 已把页码复位到 1
  const applyAndRefresh = (payload: Record<string, any>) => {
    options.applyFilters(payload)
    fetchCurrentPage()
  }

  const handleSearch = (query: string) => {
    applyAndRefresh({ filename: query || '' })
  }

  const handleApplyFilters = (payload: Record<string, any>) => {
    applyAndRefresh(payload)
  }

  // Lifecycle
  onMounted(initializeFromRoute)

  return {
    handleSearch,
    handleApplyFilters,
  }
}
