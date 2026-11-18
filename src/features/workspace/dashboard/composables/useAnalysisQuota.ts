import { ref } from 'vue'
import { ANALYSIS_LIMIT, countNonDirectProcesses } from '@/features/datasets/api/datasetApi'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'

/**
 * 新建分析前的配额检查。
 *
 * 规则：当前用户的非直转处理任务（直转的 `__RAW_CONVERT__` 不计）达到
 * ANALYSIS_LIMIT 个时，不允许进入创建分析页。数量在点击入口时实时查询，
 * 用户删除任务后再次点击即可放行。
 *
 * 查询失败时拦截并提示（fail-closed）：无法确认数量就不应放行，否则会绕过
 * 配额规则；原始错误只进 console，界面上只显示一句本地化提示。
 */
export function useAnalysisQuota() {
  const checking = ref(false)
  const blockedCount = ref(0)
  const limit = ANALYSIS_LIMIT
  const { showToast } = useToast()

  /** @returns true 表示可以进入创建页 */
  async function check(): Promise<boolean> {
    if (checking.value) return true
    checking.value = true
    try {
      const count = await countNonDirectProcesses(limit)
      blockedCount.value = count
      return count < limit
    } catch (e) {
      console.error('Failed to check analysis quota:', e)
      showToast(t('workspace.dashboard.analysisCheckFailed'), 'error')
      return false
    } finally {
      checking.value = false
    }
  }

  return { checking, blockedCount, limit, check }
}
