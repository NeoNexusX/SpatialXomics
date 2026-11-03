import { auth_api } from '@/shared/api/httpClient'
import type { UserQuota } from '@/shared/types/quota'

// Get user storage and processing quota
// GET /users/quota
//
// 说明：本接口描述的是「当前登录用户的配额」，属于跨业务的通用用户关注点，
// 与 datasets 业务无耦合，故放在 shared/api 层（原位于 features/datasets/api/datasetApi，
// 曾导致 shared/composables/useUserQuota -> features/datasets 的反向依赖环）。
export async function getUserQuota(signal?: AbortSignal): Promise<UserQuota> {
  const res = await auth_api.get('/users/quota', ...(signal ? [{ signal }] : []))
  return res.data
}
