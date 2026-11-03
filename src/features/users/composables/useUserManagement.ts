import { computed, onMounted, reactive, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/shared/auth/authStore'
import { useToast } from '@/shared/composables/useToast'
import { buildPageList } from '@/shared/utils/pagination'
import { getConfig } from '@/shared/config/runtimeConfig'
import {
  deleteAdminUser,
  listAdminUsers,
  updateUserQuota,
  getUsersClassification,
} from '@/features/users/api/userAdminApi'
import type { AdminUser, UserListFilters, UserQuotaLimits } from '@/features/users/types/user'
import { t } from '@/i18n'

export function useUserManagement() {
  // External composables
  const authStore = useAuthStore()
  const router = useRouter()
  const { showToast } = useToast()

  // Pagination — same pattern as useDatasetList
  const currentPage = ref(1)
  const pageSize = ref<number>(getConfig().pagination.defaultPageSize)
  const pageSizeOptions = getConfig().pagination.pageSizeOptions
  const meta = reactive({ current_page: 1, total_pages: 1, total_records: 0 })

  const pageRange = computed<(number | string)[]>(() =>
    buildPageList(meta.current_page, meta.total_pages),
  )


  // State
  const users = ref<AdminUser[]>([])
  const loading = ref(true)
  const error = ref('')
  const isConfirmOpen = ref(false)

  const filters = ref<UserListFilters>({
    username: '',
    status: 'Active',
    institution: '',
    region: '',
  })

  const selectedUser = ref<AdminUser | null>(null)

  // Quota state
  const quotaLimits = ref<UserQuotaLimits>({
    max_total_file_size: 0,
    max_file_count: 0,
    max_processing_size: 0,
    max_download_count: 0,
  })
  const quotaLoading = ref(false)

  // Stats — driven by GET /stats/users/classification
  const stats = reactive({ total: 0, admin: 0, regularUsers: 0, instCount: 0 })

  // Methods
  const fetchStats = async () => {
    try {
      const [identityData, institutionData] = await Promise.all([
        getUsersClassification('identity'),
        getUsersClassification('institution'),
      ])
      stats.total = Object.values(identityData).reduce((sum, v) => sum + v, 0)
      stats.admin = identityData.admin ?? 0
      stats.regularUsers = identityData.user ?? 0
      stats.instCount = Object.keys(institutionData).length
    } catch (e) {
      console.error('Failed to fetch user stats:', e)
    }
  }

  const fetchUsers = async () => {
    loading.value = true
    error.value = ''
    try {
      const res = await listAdminUsers(filters.value, currentPage.value, pageSize.value)
      users.value = res.data?.data || []
      if (res.data?.meta) {
        meta.current_page = res.data.meta.current_page || currentPage.value
        meta.total_pages = res.data.meta.total_pages || 1
        meta.total_records = res.data.meta.total_records || users.value.length
      } else {
        meta.current_page = currentPage.value
        meta.total_pages = Math.ceil(users.value.length / pageSize.value) || 1
        meta.total_records = users.value.length
      }
    } catch (err: any) {
      console.error('Failed to load users:', err)
      error.value =
        err.message || t('common.feedback.loadFailed', { target: t('users.management.target') })
    } finally {
      loading.value = false
    }
  }

  const resetFilters = () => {
    filters.value = { username: '', status: 'Active', institution: '', region: '' }
    currentPage.value = 1
    fetchUsers()
  }

  const handleSearch = () => {
    currentPage.value = 1
    fetchUsers()
  }

  const goToPage = (np: number) => {
    const clamped = Math.max(1, Math.min(meta.total_pages || 1, np))
    if (clamped === currentPage.value) return
    currentPage.value = clamped
    fetchUsers()
  }

  const changeSize = (newSize: number) => {
    pageSize.value = newSize
    currentPage.value = 1
    fetchUsers()
  }

  const openDrawer = (user: AdminUser) => {
    selectedUser.value = user
    quotaLimits.value = {
      max_total_file_size: user.max_total_file_size ?? 0,
      max_file_count: user.max_file_count ?? 0,
      max_processing_size: user.max_processing_size ?? 0,
      max_download_count: user.max_download_count ?? 0,
    }
  }

  const closeDrawer = () => {
    selectedUser.value = null
  }

  const saveUserQuota = async () => {
    if (!selectedUser.value) return
    quotaLoading.value = true
    try {
      const res = await updateUserQuota(selectedUser.value.id, { ...quotaLimits.value })
      const data = res.data || {}
      quotaLimits.value = {
        max_total_file_size: data.max_total_file_size ?? quotaLimits.value.max_total_file_size,
        max_file_count: data.max_file_count ?? quotaLimits.value.max_file_count,
        max_processing_size: data.max_processing_size ?? quotaLimits.value.max_processing_size,
        max_download_count: data.max_download_count ?? quotaLimits.value.max_download_count,
      }
      showToast(t('common.feedback.updated'), 'success')
    } catch (err: any) {
      showToast(err.message || t('common.feedback.updateFailed'), 'error')
    } finally {
      quotaLoading.value = false
    }
  }

  const promptDeleteUser = () => {
    if (selectedUser.value) isConfirmOpen.value = true
  }

  const cancelDeleteUser = () => {
    isConfirmOpen.value = false
  }

  const executeDeleteUser = async () => {
    if (!selectedUser.value) return
    loading.value = true
    try {
      await deleteAdminUser(selectedUser.value.id)
      showToast(t('common.feedback.deleted'), 'success')
      isConfirmOpen.value = false
      closeDrawer()
      fetchStats()
      fetchUsers()
    } catch (err: any) {
      console.error('Failed to delete user:', err)
      showToast(err.message || t('common.feedback.deleteFailed'), 'error')
    } finally {
      loading.value = false
    }
  }

  // Watchers
  watchEffect(() => {
    if (authStore.user !== null && !authStore.isAdmin) {
      router.replace('/')
    }
  })

  // Lifecycle
  onMounted(async () => {
    if (authStore.user) {
      if (authStore.isAdmin) {
        fetchStats()
        fetchUsers()
      }
      return
    }

    if (authStore.token) {
      try {
        await authStore.fetchUser()
        if (authStore.isAdmin) {
          fetchStats()
          fetchUsers()
        }
      } catch {
        /* fetchUser handles invalid auth */
      }
    }
  })

  return {
    users,
    loading,
    error,
    authStore,
    isConfirmOpen,
    filters,
    selectedUser,
    stats,
    currentPage,
    pageSize,
    pageSizeOptions,
    meta,
    pageRange,
    fetchUsers,
    resetFilters,
    handleSearch,
    goToPage,
    changeSize,
    openDrawer,
    closeDrawer,
    promptDeleteUser,
    cancelDeleteUser,
    executeDeleteUser,
    quotaLimits,
    quotaLoading,
    saveUserQuota,
  }
}
