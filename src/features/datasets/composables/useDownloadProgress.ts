import { reactive } from 'vue'
import {
  ossDownloadAndSave,
  ossDownloadRaw,
  ossDownloadRawNoauth,
} from '@/features/datasets/utils/downloadHelper'
import { useDownloadStore } from '@/features/datasets/stores/downloadStore'
import { useAuthStore } from '@/shared/auth/authStore'
import { useToast } from '@/shared/composables/useToast'
import { extractBackendError } from '@/shared/api/httpClient'
import { t } from '@/i18n'

const packingIds = reactive(new Set<string>())

/** 下载前须非空的身份字段（GET /user 返回的 profile 键） */
const REQUIRED_PROFILE_FIELDS = ['institution', 'position', 'research_field', 'region'] as const

export function useDownloadProgress() {
  const { showToast, removeToast } = useToast()
  const downloadStore = useDownloadStore()
  const auth = useAuthStore()

  const isPacking = (publicId: string) => packingIds.has(publicId)

  /**
   * 下载前身份校验：登录用户先 GET /user（auth.fetchUser，带并发去重）拉最新
   * profile，四个身份字段任一为空则拦截并橙色提示去补全。匿名（无 token，
   * 公开集合页免登录下载）无从校验，直接放行。前端这层只是引导，真正的
   * 门禁在后端签发 pre-signed URL 处。
   */
  const ensureProfileComplete = async (): Promise<boolean> => {
    if (!auth.token) return true
    await auth.fetchUser()
    if (!auth.token) return false // fetch 中会话失效：401 路径已登出并按全局逻辑处理
    const profile = auth.user
    if (!profile) {
      showToast(t('datasets.download.profileUnavailable'), 'warning')
      return false
    }
    const incomplete = REQUIRED_PROFILE_FIELDS.some((field) => !String(profile[field] ?? '').trim())
    if (incomplete) {
      showToast(t('datasets.download.profileIncomplete'), 'warning')
      return false
    }
    return true
  }

  const handleDownload = async (
    publicId?: string,
    options?: { getFallbackFilename?: () => string | undefined },
  ) => {
    if (!publicId) return
    if (packingIds.has(publicId)) return
    packingIds.add(publicId)
    if (!(await ensureProfileComplete())) {
      packingIds.delete(publicId)
      return
    }
    const toastId = showToast(t('datasets.download.preparing'), 'info', 0)
    try {
      await ossDownloadAndSave(publicId, options)
      removeToast(toastId)
    } catch (error) {
      removeToast(toastId)
      const message = extractBackendError(error, t('datasets.download.failed'))
      showToast(message, 'error')
      console.error('Download error:', error)
    } finally {
      packingIds.delete(publicId)
    }
  }

  /**
   * RAW 下载的公共装配：并发去重（packingIds）、客户端限流（一次/冷却窗，默认 60s）、
   * downloadStore 状态机与 toast 生命周期。auth / no-auth 两个入口只差实际取数
   * 的 runner 与错误信息映射（mapError）。
   */
  const runRawDownload = async (
    publicId: string | undefined,
    runner: (id: string) => Promise<void>,
    mapError?: (error: unknown) => string | undefined,
  ) => {
    if (!publicId) return
    if (packingIds.has(publicId)) return

    // Client-side cooldown check to prevent repeated download requests.
    if (!downloadStore.canDownload()) {
      // 区分"正在下载"和"冷却中"
      if (downloadStore.downloading) {
        showToast(t('datasets.download.inProgress'), 'warning')
      } else {
        const remain = Math.ceil(downloadStore.cooldownRemaining())
        showToast(t('datasets.download.limited', { seconds: remain }), 'warning')
      }
      return
    }

    packingIds.add(publicId)
    if (!(await ensureProfileComplete())) {
      packingIds.delete(publicId)
      return
    }
    downloadStore.startDownload(publicId)
    const toastId = showToast(t('datasets.download.downloading'), 'info', 0)
    try {
      await runner(publicId)
      downloadStore.completeDownload()
      removeToast(toastId)
      showToast(t('datasets.download.started'), 'success')
    } catch (error) {
      downloadStore.failDownload()
      removeToast(toastId)
      const message = mapError?.(error) ?? extractBackendError(error, t('datasets.download.failed'))
      showToast(message, 'error')
      console.error('Download error:', error)
    } finally {
      packingIds.delete(publicId)
    }
  }

  /**
   * RAW pre-signed download: imzML + ibd from /files/{public_id}/download_raw.
   * Zero polling — pre-signed URLs are returned immediately.
   * Rate-limited: one download per cooldown window (60s default).
   */
  const handleDownloadRaw = (
    publicId?: string,
    options?: { getFallbackFilename?: () => string | undefined; isPublic?: boolean },
  ) =>
    runRawDownload(
      publicId,
      (id) => ossDownloadRaw(id, { ...options, isPublic: options?.isPublic ?? false }),
      (error) =>
        (error as { response?: { status?: number } })?.response?.status === 403
          ? t('datasets.download.limitReached')
          : undefined,
    )

  /**
   * RAW no-auth download for the public collection page:
   * /files/{public_id}/download_raw_noauth (backend serves is_public files only).
   */
  const handleDownloadPublicRaw = (publicId?: string) =>
    runRawDownload(publicId, (id) => ossDownloadRawNoauth(id))

  return { handleDownload, handleDownloadRaw, handleDownloadPublicRaw, isPacking, packingIds }
}
