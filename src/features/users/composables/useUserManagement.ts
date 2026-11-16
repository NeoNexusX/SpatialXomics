import { useLatestRequest } from '@/shared/composables/useLatestRequest'
import { usePagination } from '@/shared/composables/usePagination'
import { onMounted, reactive, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/shared/auth/authStore'
import { useToast } from '@/shared/composables/useToast'
import { useConfirmDelete } from '@/shared/composables/useConfirmDelete'
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
  const requests = useLatestRequest()
  // External composables
  const authStore = useAuthStore()
  const router = useRouter()
  const { showToast } = useToast()

  const pager = usePagination(() => fetchUsers())
  const { page: currentPage, size: pageSize } = pager
  const pageSizeOptions = getConfig().pagination.pageSizeOptions

  // State
  const users = ref<AdminUser[]>([])
  const loading = ref(true)
  const error = ref('')

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
    const isCurrent = requests.begin()
    loading.value = true
    error.value = ''
    try {
      const res = await listAdminUsers(filters.value, currentPage.value, pageSize.value)
      if (!isCurrent()) return
      users.value = res.data
      pager.setMeta(res.meta)
    } catch (err: any) {
      if (!isCurrent()) return
      console.error('Failed to load users:', err)
      error.value =
        err.message || t('common.feedback.loadFailed', { target: t('users.management.target') })
    } finally {
      if (isCurrent()) loading.value = false
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
      const data = (await updateUserQuota(selectedUser.value.id, { ...quotaLimits.value })) || {}
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

  const deleteConfirm = useConfirmDelete({
    onDelete: async (id: number) => {
      await deleteAdminUser(id)
      closeDrawer()
      fetchStats()
      fetchUsers()
    },
  })

  const promptDeleteUser = () => {
    if (selectedUser.value) deleteConfirm.open(selectedUser.value.id)
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
    deleteConfirm,
    filters,
    selectedUser,
    stats,
    currentPage,
    pageSize,
    pageSizeOptions,
    meta: pager.meta,
    pageRange: pager.pageRange,
    fetchUsers,
    resetFilters,
    handleSearch,
    goToPage: pager.goToPage,
    changeSize: pager.changeSize,
    openDrawer,
    closeDrawer,
    promptDeleteUser,
    quotaLimits,
    quotaLoading,
    saveUserQuota,
  }
}
