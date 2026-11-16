import { auth_api } from '@/shared/api/httpClient'
import { toPage, unwrap } from '@/shared/api/response'
import type {
  AdminUser,
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

  return toPage<AdminUser>(await unwrap(auth_api.post('/list_users', payload, { params: { page, size } })))
}

export async function deleteAdminUser(userId: number) {
  return unwrap(auth_api.delete(`/user_delete/${userId}`))
}

/** 管理员更新用户配额限制 */
export async function updateUserQuota(userId: number, limits: Partial<UserQuotaLimits>) {
  return unwrap(auth_api.post<Partial<UserQuotaLimits>>(`/users/${userId}/quota`, limits))
}

/** GET /stats/users/classification?field= - 按指定字段统计用户分类数量 */
export async function getUsersClassification(field: string): Promise<UsersClassification> {
  return unwrap(auth_api.get('/stats/users/classification', { params: { field } }))
}
