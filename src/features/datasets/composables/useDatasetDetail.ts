import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getFileMetadata, setFilePublic } from '@/features/datasets/api/datasetApi'
import { getShareOverviewMetadata } from '@/features/datasets/api/overviewShareApi'
import { buildPreviewImageUrl } from '@/features/datasets/utils/imageUtils'
import { mapItemToDataset } from '@/features/datasets/mappers/datasetMapper'
import type { File } from '@/features/datasets/types/dataset'
import { useDownloadProgress } from '@/features/datasets/composables/useDownloadProgress'
import { getDatasetPlaceholderSvg } from '@/features/datasets/utils/datasetPlaceholder'
import { formatBytes } from '@/shared/utils/format'
import { extractBackendError } from '@/shared/api/httpClient'
import { useToast } from '@/shared/composables/useToast'
import { useRequireAuth } from '@/shared/composables/useRequireAuth'
import { useOverviewShare } from '@/features/datasets/composables/useOverviewShare'
import { formatVocabOrText } from '@/features/datasets/constants/vocabLabels'
import { t } from '@/i18n'

export function useDatasetDetail() {
  const router = useRouter()
  const route = useRoute()
  const { handleDownloadRaw, isPacking } = useDownloadProgress()
  const { showToast } = useToast()

  // State
  const dataset = ref<File | null>(null)
  const loading = ref(true)
  const ticImageUrl = ref<string>('')
  const ticImageError = ref(false)

  const { isShareView, sharedToken, isShareCopied, shareCurrent } = useOverviewShare(dataset)
  // 正常入口 public_id 来自路径参数（/overview/{public_id}，刷新不丢）；
  // 分享页沿用 /s/{token} 解析
  const filePublicId = computed(() =>
    isShareView.value ? (sharedToken.value ?? '') : ((route.params.publicId as string) ?? ''),
  )
  // 来源列表走 query ?source=my|public（新标签页打开，history.state 不可用）；
  // 分享页按 public 来源处理：goBack 回公开列表、需登录操作的登录回跳以 /datasets 为基准
  const source = computed<'my' | 'public'>(() =>
    isShareView.value ? 'public' : route.query.source === 'public' ? 'public' : 'my',
  )
  /** 分享 token 不是 16 位 publicId → 无效链接，不发任何请求 */
  const isInvalidShare = computed(() => isShareView.value && !sharedToken.value)
  /** Normal entry needs history state; shared entry needs a valid token. */
  const isStale = computed(() => (isShareView.value ? isInvalidShare.value : !filePublicId.value))
  /** 匿名访问分享链接被 401：渲染「登录 / 注册」引导而不是错误态 */
  const requiresAuth = ref(false)

  // Computed
  const placeholderSvg = computed(() => {
    const targetId = filePublicId.value || (dataset.value?.filename as string)
    return getDatasetPlaceholderSvg({
      id: targetId,
      showGuides: true,
    })
  })

  const goBack = () => {
    if (source.value === 'public') {
      router.push({ name: 'PublicDatasets' })
    } else {
      router.push({ name: 'MyDatasets' })
    }
  }

  /** 匿名 401 的引导落地：登录/注册后带 redirect 回来。两个入口的 URL 都自带
   * 识别参数（/overview/{public_id} 或 /s/{token}），直接回原链接即可 */
  const authRedirectTarget = () => route.fullPath
  const goLogin = () => router.push({ path: '/login', query: { redirect: authRedirectTarget() } })
  const goRegister = () =>
    router.push({ path: '/register', query: { redirect: authRedirectTarget() } })

  /** 下载需要登录：未登录则提示并跳转登录页，与公开数据集列表页行为一致 */
  const { requireAuth } = useRequireAuth(() =>
    source.value === 'public' ? '/datasets' : '/mydatasets',
  )

  const downloadCurrent = async () => {
    const targetId = dataset.value?.publicId ?? ''
    if (!targetId) return
    if (!requireAuth()) return
    await handleDownloadRaw(targetId)
  }

  // Make Public
  const makingPublic = ref(false)
  const showPublicConfirm = ref(false)

  const openPublicConfirm = () => {
    showPublicConfirm.value = true
  }

  const cancelPublicConfirm = () => {
    showPublicConfirm.value = false
  }

  const confirmSetPublic = async () => {
    const targetId = dataset.value?.publicId ?? ''
    if (!targetId) return
    makingPublic.value = true
    try {
      await setFilePublic(targetId)
      // 直接更新本地状态，避免刷新页面
      if (dataset.value) {
        dataset.value.isPublic = true
      }
      showToast(t('datasets.overview.madePublic'), 'success')
    } catch (error) {
      const message = extractBackendError(error, t('common.feedback.updateFailed'))
      showToast(message, 'error')
      console.error('Failed to set file public', error)
    } finally {
      makingPublic.value = false
      showPublicConfirm.value = false
    }
  }

  // ---- 分享：公开/私有统一直接复制 /s/{public_id} 链接（见 useOverviewShare.shareCurrent）；
  //      Make Public 是独立入口，与分享解耦 ----

  let requestId = 0

  const fetchDatasetDetails = async () => {
    const currentRequest = ++requestId
    const token = sharedToken.value
    if (!token && !filePublicId.value) {
      dataset.value = null
      ticImageUrl.value = ''
      loading.value = false
      return
    }

    loading.value = true
    requiresAuth.value = false
    try {
      // 分享页取数走 overviewShareApi（登录态感知，见其头注释）
      const share = token ? await getShareOverviewMetadata(token) : null
      const metadata = share ? share.metadata : await getFileMetadata(filePublicId.value)
      if (currentRequest !== requestId) return
      dataset.value = metadata ? mapItemToDataset(metadata) : null
      ticImageError.value = false
      // image_path 为空 → null → 占位图；不发起注定 404 的图片请求
      ticImageUrl.value = buildPreviewImageUrl(dataset.value?.imagePath) ?? ''
    } catch (error) {
      if (currentRequest !== requestId) return
      console.error('Error fetching dataset details', error)
      // 匿名访问（分享链接 / 公开列表进入）→ 后端 401：转成登录/注册引导
      // （skipAuthRedirect 已挡掉全局跳转，这里能拿到错误自行处置）
      if ((error as { response?: { status?: number } })?.response?.status === 401) {
        requiresAuth.value = true
      }
      dataset.value = null
    } finally {
      if (currentRequest === requestId) loading.value = false
    }
  }

  watch([filePublicId, sharedToken], fetchDatasetDetails, { immediate: true })

  return {
    source,
    isShareView,
    isStale,
    isInvalidShare,
    requiresAuth,
    goLogin,
    goRegister,
    dataset,
    loading,
    isShareCopied,
    ticImageUrl,
    ticImageError,
    placeholderSvg,
    formatSize: formatBytes,
    formatString: formatVocabOrText,
    shareCurrent,
    goBack,
    downloadCurrent,
    isPacking,
    makingPublic,
    showPublicConfirm,
    openPublicConfirm,
    cancelPublicConfirm,
    confirmSetPublic,
  }
}
