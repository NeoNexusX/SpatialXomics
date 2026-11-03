import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'
import { formatBytes } from '@/shared/utils/format'
import {
  MIN_PUBLIC_IBD_SIZE,
  MAX_UPLOAD_BYTES,
  tooLargeMessage,
  parseImzmlUploadMetadata,
  uploadImzmlDataset,
  sourceIdentityOf,
  sourceMatches,
  type ImzmlFilePair,
  type UnifiedUploadProgress,
} from '@/features/upload/services/imzmlUploadService'
import type { PartRetryInfo, ImzmlMilestone } from '@/features/upload/utils/imzmlHelper'
import { useUploadMetadataForm } from '@/features/upload/composables/useUploadMetadataForm'
import { useUploadResume } from '@/features/upload/composables/useUploadResume'
import { isAbortLike, makeAbortReason } from '@/features/upload/utils/uploadAbort'

type UploadStage = 'select' | 'uploading' | 'success'

interface UseUploadFlowOptions {
  close: () => void
  uploadSuccess: (datasetName: string) => void
}

export function useUploadFlow(options: UseUploadFlowOptions) {
  // External composables
  const { showToast } = useToast()
  const metadataForm = useUploadMetadataForm()
  const resumeState = useUploadResume()

  // State
  const selectedPair = ref<ImzmlFilePair | null>(null)
  const uploading = ref(false)
  const progress = ref(0)
  const uploadMessage = ref('')
  /**
   * 三种「出错」语义分开，不再共用一个 ref。
   *
   * 旧实现让选文件的报错和上传的致命错误挤在同一个 `error` 里，
   * 于是一次失败的上传结束后，红框会挂在文件选择器上，读起来像是
   * 「你选的文件有问题」。
   */
  const pickerError = ref('') // 选文件不合法 / 超限
  const uploadError = ref('') // 上传致命失败
  const retryInfo = ref<PartRetryInfo | null>(null) // 分片重试中，非致命
  const stage = ref<UploadStage>('select')
  const parsingMetadata = ref(false)
  const speed = ref('') // 端到端
  const eta = ref('')
  // 端到端速度的两个拆解项，只在上传阶段有值
  const compressSpeed = ref('')
  const uploadSpeed = ref('')
  const bottleneck = ref<'upload' | 'compress' | null>(null)
  /** imzML 段完成的一次性结算，触发后常驻到本轮上传结束 */
  const imzmlMilestone = ref<ImzmlMilestone | null>(null)
  const doneSourceBytes = ref(0)
  const totalSourceBytes = ref(0)
  const pickerResetKey = ref(0)
  /** 已发出中止、正在等在途分片收尾。见 abortUpload 的注释 */
  const aborting = ref(false)
  let abortController: AbortController | null = null
  let parseRequest = 0
  const showPublicConfirm = ref(false)

  // Computed
  const formattedSize = computed(() => {
    if (!selectedPair.value) return ''
    return formatBytes(selectedPair.value.ibd.size + selectedPair.value.imzml.size)
  })

  /**
   * 续传就绪判断。压缩产物不再缓存到本地，续传要重新压一遍，
   * 所以必须先拿到**同一对**源文件；名称+大小在这里先挡一道，
   * 最终判据是上传流水线里的哈希比对。
   */
  const resumeReady = computed(() => {
    if (!resumeState.pendingResume.value || !selectedPair.value) return false
    const expected = resumeState.pendingSource.value
    return !!expected && sourceMatches(expected, sourceIdentityOf(selectedPair.value))
  })

  const resumeHint = computed(() => {
    if (!resumeState.pendingResume.value) return ''
    if (!selectedPair.value) {
      return t('upload.resume.hintSelect')
    }
    return resumeReady.value ? '' : t('upload.resume.hintMismatch')
  })

  const expectedResumeFiles = computed(() => {
    const source = resumeState.pendingSource.value
    return source ? { imzmlName: source.imzmlName, ibdName: source.ibdName } : null
  })

  // Methods
  const handleProgress = (progressInfo: UnifiedUploadProgress) => {
    progress.value = progressInfo.percent
    uploadMessage.value = progressInfo.message || t('upload.progress.stage', { stage: progressInfo.stage })
    speed.value = progressInfo.speedStr || ''
    eta.value = progressInfo.etaStr || ''
    compressSpeed.value = progressInfo.compressSpeedStr || ''
    uploadSpeed.value = progressInfo.uploadSpeedStr || ''
    bottleneck.value = progressInfo.bottleneck ?? null
    // 里程碑是一次性事件但要常驻：不带这个字段的阶段（syncing/completed）
    // 不该把它抹掉，所以只在拿到非空值时覆盖
    if (progressInfo.imzmlMilestone) imzmlMilestone.value = progressInfo.imzmlMilestone
    doneSourceBytes.value = progressInfo.doneSourceBytes ?? 0
    totalSourceBytes.value = progressInfo.totalSourceBytes ?? 0
    // undefined 表示这条消息不携带重试状态，保持现状；只有显式的 null 才清除告警。
    // 重试期间压缩进度照常流动，若无差别覆盖会把刚亮起的告警立刻抹掉。
    if (progressInfo.retry !== undefined) retryInfo.value = progressInfo.retry
  }

  /**
   * 清空所有进度读数。`resetAll` 和每轮上传开始时都要调。
   *
   * 漏掉任何一项都会把上一轮的数字带进下一轮 —— `imzmlMilestone` 尤其明显：
   * 它是刻意常驻的（handleProgress 只在拿到非空值时才覆盖），而上传失败后
   * 模态框并不关闭，所以不在开传时清掉的话，上一轮的「✓ imzML transferred」
   * 会一直挂到新一轮自己的里程碑触发为止。
   */
  const clearProgress = () => {
    progress.value = 0
    uploadMessage.value = ''
    speed.value = ''
    eta.value = ''
    compressSpeed.value = ''
    uploadSpeed.value = ''
    bottleneck.value = null
    imzmlMilestone.value = null
    doneSourceBytes.value = 0
    totalSourceBytes.value = 0
    retryInfo.value = null
  }

  const resetAll = () => {
    clearProgress()
    selectedPair.value = null
    uploading.value = false
    pickerError.value = ''
    uploadError.value = ''
    aborting.value = false
    stage.value = 'select'
    abortController = null
    metadataForm.resetForm()
    pickerResetKey.value += 1
  }

  const closeModal = () => {
    if (uploading.value) return
    options.close()
    setTimeout(resetAll, 300)
  }

  const handlePairError = (message: string) => {
    showToast(message, 'error')
    pickerError.value = message
    selectedPair.value = null
    pickerResetKey.value += 1
  }

  const handlePairSelected = async (pair: ImzmlFilePair) => {
    // File.size 选完就有，没必要等到点上传才告诉用户超限
    const sourceBytes = pair.imzml.size + pair.ibd.size
    if (sourceBytes > MAX_UPLOAD_BYTES) {
      handlePairError(tooLargeMessage(sourceBytes))
      return
    }

    pickerError.value = ''
    uploadError.value = ''
    selectedPair.value = pair
    metadataForm.resetParsedFields()
    parsingMetadata.value = true
    // 解析期间又选了别的文件：这次的结果已经不属于当前文件
    const request = ++parseRequest

    try {
      const settings = await parseImzmlUploadMetadata(pair.imzml)
      if (request === parseRequest) metadataForm.applyParsedSettings(settings)
    } catch (err: any) {
      if (request === parseRequest) showToast(err?.message || t('upload.toast.parseFailed'), 'error')
    } finally {
      if (request === parseRequest) parsingMetadata.value = false
    }
  }

  const startUploading = (message: string) => {
    clearProgress()
    uploading.value = true
    stage.value = 'uploading'
    uploadMessage.value = message
    uploadError.value = ''
    aborting.value = false
    abortController = new AbortController()
  }

  const finishSuccessfully = (datasetName: string, reused = false) => {
    showToast(
      reused ? t('upload.toast.reused') : t('upload.toast.completed'),
      'success',
    )
    uploading.value = false
    options.uploadSuccess(datasetName)
    closeModal()
  }

  const handleUploadError = (err: any, fallbackMessage: string) => {
    console.error(fallbackMessage, err)
    if (isAbortLike(err)) {
      showToast(t('upload.toast.aborted'), 'info')
      uploadError.value = t('upload.toast.abortedDetail')
    } else {
      uploadError.value = err.message || fallbackMessage
      showToast(uploadError.value, 'error')
    }
    retryInfo.value = null
    aborting.value = false
    stage.value = 'select'
    resumeState.checkResume()
  }

  const resumeUpload = async () => {
    if (!selectedPair.value || !resumeReady.value) return
    const pair = selectedPair.value
    resumeState.pendingResume.value = false
    startUploading(t('upload.progress.resuming'))

    try {
      const result = await uploadImzmlDataset({
        files: pair,
        datasetName: resumeState.pendingDatasetName.value,
        signal: abortController!.signal,
        resume: true,
        onProgress: handleProgress,
      })
      finishSuccessfully(result?.datasetName || resumeState.pendingDatasetName.value)
    } catch (err: any) {
      handleUploadError(err, t('upload.toast.resumeFailed'))
    } finally {
      uploading.value = false
      abortController = null
    }
  }

  /**
   * 用户主动放弃。带上 'user-cancel' 意图，pipeline 的 catch 据此
   * 作废 OSS 分片并清空分片轮次（组件卸载走的是另一条分支，会保留它们）。
   *
   * 不在这里清 abortController —— doUpload/resumeUpload 的 finally 负责。
   */
  const abortUpload = () => {
    if (aborting.value) return
    // 中止是同步的：压缩流水线当场 reject，作废分片的 DELETE 丢到后台，
    // 一个 tick 内就回到 select 阶段。所以 aborting 只剩防连点这一个作用，
    // 用户看得见的说明放在中止后的 uploadError 里（后台残留流量那句）。
    aborting.value = true
    abortController?.abort(makeAbortReason('user-cancel'))
  }

  const confirmAndUpload = async () => {
    if (!selectedPair.value) return

    const validationError = metadataForm.validateMetadata()
    if (validationError) {
      showToast(validationError, 'error')
      return
    }

    if (metadataForm.form.value.is_public && selectedPair.value.ibd.size < MIN_PUBLIC_IBD_SIZE) {
      const minSizeMB = MIN_PUBLIC_IBD_SIZE / (1024 * 1024)
      showToast(t('upload.toast.ibdTooSmall', { mb: minSizeMB }), 'error')
      return
    }

    if (metadataForm.form.value.is_public) {
      showPublicConfirm.value = true
      return
    }

    await doUpload()
  }

  const proceedPublicUpload = async () => {
    showPublicConfirm.value = false
    await doUpload()
  }

  const cancelPublicUpload = () => {
    showPublicConfirm.value = false
  }

  const doUpload = async () => {
    if (!selectedPair.value) return
    const pair = selectedPair.value

    startUploading(t('upload.progress.initializing'))

    try {
      const payload = metadataForm.buildMetadataPayload()
      const result = await uploadImzmlDataset({
        files: pair,
        datasetName: pair.baseName,
        metadata: { ...payload, file_type: 'zip', is_public: metadataForm.form.value.is_public },
        signal: abortController!.signal,
        onProgress: handleProgress,
      })
      finishSuccessfully(result?.datasetName || pair.baseName, !!result?.reused)
    } catch (err: any) {
      handleUploadError(err, t('upload.toast.uploadFailed'))
    } finally {
      uploading.value = false
      abortController = null
    }
  }

  // Lifecycle
  onMounted(resumeState.checkResume)

  /**
   * 组件卸载时中止上传，避免后台继续浪费带宽 + 回调已销毁的组件。
   *
   * 意图是 'component-unmount' 而非 'user-cancel'：这不是用户放弃，
   * 已传到 OSS 的分片和续传会话都要原样保留，下次进来可以接着传。
   */
  onBeforeUnmount(() => {
    abortController?.abort(makeAbortReason('component-unmount'))
    abortController = null
  })

  return {
    ...metadataForm,
    ...resumeState,
    selectedPair,
    uploading,
    progress,
    uploadMessage,
    pickerError,
    uploadError,
    retryInfo,
    aborting,
    stage,
    parsingMetadata,
    speed,
    eta,
    compressSpeed,
    uploadSpeed,
    bottleneck,
    imzmlMilestone,
    doneSourceBytes,
    totalSourceBytes,
    pickerResetKey,
    formattedSize,
    resumeReady,
    resumeHint,
    expectedResumeFiles,
    handlePairSelected,
    handlePairError,
    confirmAndUpload,
    proceedPublicUpload,
    cancelPublicUpload,
    showPublicConfirm,
    resumeUpload,
    abortUpload,
    closeModal,
  }
}
