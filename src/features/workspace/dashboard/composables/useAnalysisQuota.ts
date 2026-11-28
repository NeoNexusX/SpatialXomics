import { ref } from 'vue'
import { ANALYSIS_LIMIT, countNonDirectProcesses } from '@/features/datasets/api/datasetApi'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'

/**
 * 新建分析前的配额检查。
 *
 * 规则：当前用户的非直转处理任务（直转的 `__RAW_CONVERT__` 不计）达到
 * ANALYSIS_LIMIT 个时，不允许进入创建分析页。数量在进入路由时实时查询，
 * 用户删除任务后再次进入即可放行。
 *
 * 查询失败时拦截并提示（fail-closed）：无法确认数量就不应放行，否则会绕过
 * 配额规则；原始错误只进 console，界面上只显示一句本地化提示。
 *
 * checking / blockedCount 放在模块级：工作台按钮的 loading 状态和路由守卫
 * 共用同一份状态，避免按钮和守卫各查一次。
 */
const checking = ref(false)
const blockedCount = ref(0)
const { showToast } = useToast()
/** 进行中的检查；并发入口（守卫 / 按钮）复用同一请求。 */
let inflight: Promise<AnalysisQuotaResult> | null = null

export interface AnalysisQuotaResult {
  /** 是否允许进入创建分析页 */
  allowed: boolean
  /** 已统计到的非直转任务数（封顶为 ANALYSIS_LIMIT）；查询失败时为 0 */
  count: number
  /** 是否因为查询失败而拦截 */
  failed: boolean
}

/** 查询一次配额，供路由守卫和工作台按钮共用；并发调用复用同一个请求。 */
export function inspectAnalysisQuota(): Promise<AnalysisQuotaResult> {
  if (inflight) return inflight

  checking.value = true
  inflight = (async (): Promise<AnalysisQuotaResult> => {
    try {
      const count = await countNonDirectProcesses(ANALYSIS_LIMIT)
      blockedCount.value = count
      return { allowed: count < ANALYSIS_LIMIT, count, failed: false }
    } catch (e) {
      // 清掉可能残留的旧计数，守卫据此只提示查询失败、不误报达到上限。
      blockedCount.value = 0
      console.error('Failed to check analysis quota:', e)
      showToast(t('workspace.dashboard.analysisCheckFailed'), 'error')
      return { allowed: false, count: 0, failed: true }
    } finally {
      checking.value = false
      inflight = null
    }
  })()

  return inflight
}

/** 布尔版：保留原有调用方式。 */
export async function checkAnalysisQuota(): Promise<boolean> {
  return (await inspectAnalysisQuota()).allowed
}

export function useAnalysisQuota() {
  return { checking, blockedCount, limit: ANALYSIS_LIMIT, check: checkAnalysisQuota }
}