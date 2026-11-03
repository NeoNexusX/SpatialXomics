import { auth_api } from '@/shared/api/httpClient'
import type {
  UserListFilters,
  UserQuotaLimits,
  UsersClassification,
} from '@/features/users/types/user'

export async function listAdminUsers(filters: UserListFilters, page: number, size: number) {
  const payload = {
    username: filters.username,
    active: filters.status === 'Inactive' ? false : true,
    institution: filters.institution,
    region: filters.region,
  }

  return auth_api.post('/list_users', payload, {
    params: { page, size },
  })
}

export function deleteAdminUser(userId: number) {
  return auth_api.delete(`/user_delete/${userId}`)
}

/** 管理员更新用户配额限制 */
export async function updateUserQuota(userId: number, limits: Partial<UserQuotaLimits>) {
  return auth_api.post(`/users/${userId}/quota`, limits)
}

/** GET /stats/users/classification?field= - 按指定字段统计用户分类数量 */
export async function getUsersClassification(field: string): Promise<UsersClassification> {
  const res = await auth_api.get('/stats/users/classification', { params: { field } })
  return res.data
}
