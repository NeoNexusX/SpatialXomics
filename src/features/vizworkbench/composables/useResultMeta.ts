import { computed, ref, shallowRef, watch, onUnmounted, type Ref } from 'vue'
import { metadataAttrsRef, polarityRef } from '@/features/vizworkbench/composables/useZarrIonImage'
import { getFileMetadata, listMyProcesses } from '@/features/datasets/api/datasetApi'
import { mapItemToDataset } from '@/features/datasets/mappers/datasetMapper'
import type { File } from '@/features/datasets/types/dataset'
import type { Acquisition } from '@/features/vizworkbench/types/acquisition'
import { deriveAcquisition } from '@/features/vizworkbench/utils/acquisition'
import { parseAlgorithms } from '@/shared/utils/methodsNormalize'

interface VizWorkbenchState {
  runId?: string
  processName?: string
  datasetName?: string
  filename?: string
  filePublicId?: string
  methods?: string[]
  status?: string
}

/**
 * 结果页元数据。三个原始来源：zarr attrs（随结果加载）、源文件记录（按 filePublicId 请求）、
 * 处理记录（history.state，缺失时回查「我的处理记录」）。展示字段全部由它们推导，
 * 不管哪个请求先返回，结果都一样；各字段以谁为准见 types/acquisition.ts。
 */
export function useResultMeta(runId: Ref<string>) {
  const stateName = ref('')
  const processName = ref('')
  const status = ref('')
  const methods = ref<string[]>([])
  const loading = ref(false)

  /**
   * 源数据集的完整文件记录（GET /files/{public_id}/metadata）。
   * 基质、溶剂、物种等上传时填写的元信息只存在这里，zarr attrs 里没有。
   */
  const sourceFile = shallowRef<File | null>(null)

  let disposed = false
  onUnmounted(() => {
    disposed = true
  })
  /** true when a response fetched for `id` must be discarded: the component
   *  unmounted, or runId already moved on to another result (same-instance
   *  reuse on /viz). */
  const isStale = (id: string) => disposed || runId.value !== id

  const acquisition = computed<Acquisition>(() =>
    deriveAcquisition(metadataAttrsRef.value, sourceFile.value, methods.value),
  )

  /** 像素尺寸原始数值（µm），供 mask 导出等需要数字的消费方；缺一边为 null */
  const pixelSizeUm = computed<{ x: number; y: number } | null>(() => {
    const a = metadataAttrsRef.value
    if (a?.pixel_size_horizontal != null && a.pixel_size_vertical != null) {
      return { x: a.pixel_size_horizontal, y: a.pixel_size_vertical }
    }
    const f = sourceFile.value
    if (f?.pixelSizeHorizontal != null && f.pixelSizeVertical != null) {
      return { x: f.pixelSizeHorizontal, y: f.pixelSizeVertical }
    }
    return null
  })
  const pixelSize = computed(() =>
    pixelSizeUm.value ? `${pixelSizeUm.value.x} × ${pixelSizeUm.value.y} µm` : '',
  )

  const datasetName = computed(
    () => stateName.value || metadataAttrsRef.value?.name || processName.value,
  )

  // 极性同步到模块级 polarityRef（AI 助手的数据集概览读取它）
  watch(
    () => acquisition.value.polarity,
    (p) => (polarityRef.value = p),
    { immediate: true },
  )

  /**
   * 处理记录兜底：history.state 缺名称 / 状态 / methods 时（Explore 入口不带 status）
   * 回查「我的处理记录」。只能查到当前用户自己的 run，查不到时这几项留空。
   */
  async function fetchProcessMetaFromApi(id: string) {
    if (datasetName.value && status.value && methods.value.length) return

    const result = await listMyProcesses(1, 100)
    if (isStale(id)) return
    const process = (result.data || []).find((p: any) => String(p.id) === id)
    if (!process) return

    processName.value = (process.filename || '').replace(/\.[^.]+$/, '')
    if (!status.value) status.value = (process.status || '').toLowerCase()
    if (!methods.value.length && process.params_json) {
      methods.value = parseAlgorithms(process.params_json)
    }
  }

  /**
   * 按源文件 ID 取完整文件记录。两个入口（工作区列表、数据集 Explore）都随 runId
   * 携带 filePublicId；该接口任意登录用户可读，别人的公开数据、较早的 run 都能查到。
   */
  async function fetchSourceFile(id: string, filePublicId: string | undefined) {
    if (!filePublicId) return
    try {
      const file = mapItemToDataset(await getFileMetadata(filePublicId))
      if (!isStale(id)) sourceFile.value = file
    } catch (e) {
      // 源文件已删除（404）等：只显示 zarr 自带的元信息
      if (!isStale(id)) console.warn('[useResultMeta] source file metadata unavailable:', e)
    }
  }

  let requestId = 0

  async function fetchMeta(id: string) {
    const currentRequest = ++requestId
    loading.value = true
    try {
      const state = history.state as VizWorkbenchState | null
      stateName.value = state?.datasetName || ''
      processName.value = ''
      status.value = (state?.status || '').toLowerCase()
      methods.value = state?.methods || []
      sourceFile.value = null

      // 源文件元信息与处理记录兜底互不依赖，并行请求
      await Promise.all([fetchSourceFile(id, state?.filePublicId), fetchProcessMetaFromApi(id)])
    } catch (e) {
      if (currentRequest === requestId) console.error('[useResultMeta] fetch failed:', e)
    } finally {
      if (currentRequest === requestId) loading.value = false
    }
  }

  watch(
    runId,
    (id) => {
      if (id) fetchMeta(id)
    },
    { immediate: true },
  )

  return {
    datasetName,
    acquisition,
    spectrumMode: computed(() => acquisition.value.spectrumMode),
    storageMode: computed(() => acquisition.value.storageMode),
    pixelSize,
    pixelSizeUm,
    status,
    methods,
    loading,
    sourceFile,
  }
}
