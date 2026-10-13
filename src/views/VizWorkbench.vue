<script setup lang="ts">
import { computed, ref, watch, onUnmounted, nextTick, shallowRef } from 'vue'
import VizInfoPanel from '@/features/vizworkbench/components/visuals/VizInfoPanel.vue'
import ResultVisualizationLayout from '@/features/vizworkbench/components/ResultVisualizationLayout.vue'
import ResultHeader from '@/features/vizworkbench/components/visuals/ResultHeader.vue'
import IonImageSection from '@/features/vizworkbench/components/IonImageSection.vue'
import SpectrumSection from '@/features/vizworkbench/components/SpectrumSection.vue'
import OverlayControls from '@/features/vizworkbench/components/OverlayControls.vue'
import AnnotationPanel from '@/features/vizworkbench/components/annotation/AnnotationPanel.vue'
import CompareRegionsPanel from '@/features/vizworkbench/components/CompareRegionsPanel.vue'
import ComparisonResultsTable from '@/features/vizworkbench/components/ComparisonResultsTable.vue'
import RegionPreviewThumbnail from '@/features/vizworkbench/components/RegionPreviewThumbnail.vue'
import {
  useZarrIonImage,
  ticMatrix,
  pixelSpectrum,
  loadPixelSpectrum,
  dataModeRef,
  mzAxisRef,
  getSharedZarrContext,
  disposeZarrState,
  loadIonMatrixByIndex,
  findClosestMzIndex,
} from '@/features/vizworkbench/composables/useZarrIonImage'
import { useDisplayRange } from '@/features/vizworkbench/composables/useDisplayRange'
import { useOverlayData } from '@/features/vizworkbench/composables/useOverlayData'
import { useResultROI } from '@/features/vizworkbench/composables/useResultROI'
import { useIonChannels } from '@/features/vizworkbench/composables/useIonChannels'
import { MAX_ION_CHANNELS } from '@/features/vizworkbench/utils/ionChannelBlend'
import { useResultMeta } from '@/features/vizworkbench/composables/useResultMeta'
import { useRegionComparison } from '@/features/vizworkbench/composables/useRegionComparison'
import { ZARR_STORE } from '@/shared/config/defaults'
import { rgbCss } from '@/features/vizworkbench/utils/regionPalette'
import {
  createMask,
  exportMask,
  importMask,
  labelsToUnionMask,
  orMask,
  summarizeImportedMask,
  type ImportedMaskSummary,
  type MaskExportPayload,
} from '@/features/vizworkbench/utils/maskExport'
import {
  registerContextProviders,
  unregisterContextProviders,
} from '@/features/assistant/providers/analysisContext'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'
import type { DataMode } from '@/services/zarr/types/zarr'

interface VizWorkbenchState {
  runId?: string
  processName?: string
  datasetName?: string
  filename?: string
  filePublicId?: string
  methods?: string[]
  status?: string
}

const state = history.state as VizWorkbenchState | null
const runId = computed(() => (state?.runId != null ? String(state.runId) : ''))
const isStale = computed(() => state?.runId == null)

// ---- 元数据 ----

const {
  datasetName,
  acquisition,
  pixelSize,
  pixelSizeUm,
  spectrumMode,
  storageMode,
  status,
  methods,
  sourceFile,
} = useResultMeta(runId)

// ---- 可视化参数 ----

const colormap = ref('inferno')
const intensityScale = ref('linear')
const gamma = ref(1)

// ---- 注释面板（左侧） ----
// 默认收起（桌面为细条，小屏为页面流里的一条按钮）
const annotationExpanded = ref(false)

// ---- Zarr 数据加载 ----

const zarr = useZarrIonImage()
const {
  selectedMz,
  selectedMzIndex,
  mzTolerance,
  ionMatrix,
  ionCols,
  ionRows,
  loading,
  error: ionError,
  loadNormalization,
  clearNormalization,
  normalizationFactors,
  normalizationLoading,
  normalizationError,
  hasTic,
  ready: zarrReady,
  onSpectrumClickByIndex,
  isContinuous,
  isProcessed,
} = zarr

// 当前数据模式
const dataMode = computed<DataMode | null>(() => dataModeRef.value)

// processed 模式下的图像矩阵（TIC）
const currentIonMatrix = computed(() => (isProcessed.value ? ticMatrix.value : ionMatrix.value))

// 当前显示强度标度对应的图像矩阵；TIC 仅在用户选择后按需计算
const normalizedIonMatrix = computed(() => {
  const matrix = currentIonMatrix.value
  const factors = normalizationFactors.value
  if (!matrix || !factors || intensityScale.value === 'linear' || intensityScale.value === 'log')
    return matrix
  // Processed 数据本身就是 TIC 图像，不重复对 TIC 做归一化
  if (isProcessed.value) return matrix
  const result = new Float32Array(matrix.length)
  for (let i = 0; i < matrix.length; i++) {
    const denominator = factors[i]!
    result[i] = denominator > 0 ? matrix[i]! / denominator : 0
  }
  return result
})

const displaySourceMatrix = computed(() => normalizedIonMatrix.value)

// 数据集没有 stats/tic（旧数据/processed）时归一化选项会被隐藏；
// 若当前还停在 TIC，强制回到 Linear，避免值与选项不一致。
watch(hasTic, (v) => {
  if (!v && intensityScale.value === 'tic') {
    intensityScale.value = 'linear'
    clearNormalization()
  }
})

// ---- 初始化 ----

// init/dispose 的并发守卫（代次检查）在 useZarrIonImage 内部完成：
// init() 期间发生 disposeZarrState() 或重新 init() 时，旧的 init 会自行
// dispose 孤儿 store 并放弃写入模块状态。

// AI 助手桥：数据集切换时清空助手对话。不能在此静态 import useAssistant——
// 那会把整个 agent 栈（双适配器、工具模块、skills glob）拉进本路由 chunk，
// 违反 plugins/index.ts 记录的懒加载契约（助手首次打开才经动态 import 加载，
// 独立 chunk）。改为写一个待清空标志，由 useAssistant 消费（模块初始化、
// useAssistant() 调用、每次 send() 前——覆盖面板常开跨数据集导航的场景）。
// 桥接挂在 watch(runId) 上而非挂载快照：runId 可在不重挂组件的情况下变化
// （同路由换参），只看快照会漏判切换；历史里的 tool 结果（旧样本的离子图
// 统计、注释等）与新样本的 Dataset Context 会对不上，残留会误导模型。
function syncAssistantDatasetBridge(id: string): void {
  if (!id) return
  let prevRun: string | null = null
  try {
    prevRun = localStorage.getItem(STORAGE_KEYS.assistantDatasetRun)
    if (prevRun !== id) localStorage.setItem(STORAGE_KEYS.assistantDatasetRun, id)
    if (prevRun != null && prevRun !== id) {
      localStorage.setItem(STORAGE_KEYS.assistantPendingClear, '1')
    }
  } catch {
    // localStorage 不可用（隐私模式等）时静默跳过
  }
}

watch(
  runId,
  (id) => {
    zarr.init(id)
    syncAssistantDatasetBridge(id)
  },
  { immediate: true },
)

watch(runId, () => {
  importedMask.value = null
  importedMaskSummary.value = null
  importedMaskActive.value = true
})

// 离开页面时释放模块级状态，避免大数组（mzAxis、meanChartData、ticMatrix 等）
// 和 ZarrOssStore 缓存在 SPA 导航后仍驻留内存
onUnmounted(() => {
  unregisterContextProviders()
  cmpReset()
  resetChannels()
  disposeZarrState()
})

// ---- 显示范围 ----

const {
  globalMin,
  globalMax,
  sortedNonZero,
  displayMin,
  displayMax,
  stripRef,
  gradientCSS,
  intensityHistogram,
  imageInfo,
  getIntensityRange,
  resetRange,
  calcHandleTop,
  clampPct,
  onStripMouseDown,
  startStripDrag,
  formatVal,
} = useDisplayRange(displaySourceMatrix, colormap, ionCols, ionRows)

// ---- ROI ----

const {
  roiOverlayRef,
  roiTool,
  confirmedROIs,
  selectedRoiIds,
  toggleRoiSelection,
  selectAllRois,
  clearRoiSelection,
  draftReady,
  viewingROI,
  displayMatrix,
  roiUnionMask,
  roiHighlightOverlay,
  roiSelectTool,
  roiConfirm,
  roiCancel,
  roiDelete,
  roiClearAll,
  onDraftUpdated,
  onDraftCleared,
} = useResultROI(displaySourceMatrix, ionCols, ionRows)

// A file-imported mask is kept separate from drawn ROIs. It is applied as an
// additional filter, so importing never mutates the user's ROI/KMeans state.
const importedMask = shallowRef<Uint8Array | null>(null)
// ROI 模块下展示的摘要（name/format/统计）；导出面板的「已导入」标签也取 name
const importedMaskSummary = ref<ImportedMaskSummary | null>(null)
// 导入掩膜过滤是否生效：false = 暂停过滤显示原图（导入保留，可随时重新应用）
const importedMaskActive = ref(true)

const visualMatrix = computed(() => {
  const matrix = displayMatrix.value
  const mask = importedMaskActive.value ? importedMask.value : null
  const w = ionCols.value
  const h = ionRows.value
  if (!matrix || !mask || !w || !h || mask.length !== w * h) return matrix
  const filtered = new Float32Array(matrix.length)
  const n = Math.min(matrix.length, mask.length)
  for (let i = 0; i < n; i++) if (mask[i]) filtered[i] = matrix[i] ?? 0
  return filtered
})

/** Intersection of the active ROI-only filter and imported mask. */
const effectiveRoiMask = computed<Uint8Array | null>(() => {
  const imported = importedMaskActive.value ? importedMask.value : null
  const roi = roiUnionMask.value
  if (!imported) return roi
  if (!roi) return imported
  const n = Math.min(imported.length, roi.length)
  const result = new Uint8Array(n)
  for (let i = 0; i < n; i++) result[i] = imported[i]! && roi[i]! ? 1 : 0
  return result
})

// ---- Multi-ion overlay ----

const {
  enabled: channelsEnabled,
  channels: ionChannels,
  overlayActive: channelsMode,
  channelsLoading,
  canAdd: canAddChannel,
  hoverChannels,
  addCurrentMz: addIonChannel,
  removeChannel,
  toggleChannelVisible,
  updateChannelColor,
  updateChannelOpacity,
  retryChannel,
  clearChannels,
  reset: resetChannels,
} = useIonChannels({
  currentMzIndex: selectedMzIndex,
  currentMz: selectedMz,
  tolerance: mzTolerance,
  isContinuous,
  ready: zarrReady,
  runId,
  loadMatrix: loadIonMatrixByIndex,
})

const batchAddMode = ref(false)

function toggleBatchAdd() {
  if (!channelsEnabled.value || !canAddChannel.value) {
    batchAddMode.value = false
    return
  }
  batchAddMode.value = !batchAddMode.value
}

function onChannelsEnabledChange(value: boolean) {
  channelsEnabled.value = value
  if (!value) batchAddMode.value = false
}

watch(canAddChannel, (canAdd) => {
  if (!canAdd) batchAddMode.value = false
})
watch(channelsEnabled, (enabled) => {
  if (!enabled) batchAddMode.value = false
})

const { showToast } = useToast()

function onAddCurrentChannel() {
  const res = addIonChannel()
  if (res.ok) return
  const messages: Record<typeof res.reason, string> = {
    'not-continuous': t('vizworkbench.page.channelNotContinuous'),
    'not-ready': t('vizworkbench.page.channelNotReady'),
    full: t('vizworkbench.page.channelFull', { max: MAX_ION_CHANNELS }),
    duplicate: t('vizworkbench.page.channelDuplicate'),
  }
  showToast(messages[res.reason], 'warning')
}

// ---- Overlay ----

const {
  umapVisible,
  kmeansVisible,
  overlayData,
  overlayLoading,
  overlayError,
  clusteringCreating,
  clusteringComputing,
  clusteringReady,
  clusteringRefreshing,
  umapAlpha,
  kmeansAlpha,
  kmeansClusters,
  kmeansLabelsAvailable,
  kmeansK,
  kmeansComputing,
  selectedKmeansIds,
  getKmeansLabels,
  setComparisonOverlay,
  exportUmapPng,
  exportKmeansPng,
  toggleOverlay,
  retryClustering,
  createClusteringTask,
  refreshClusteringStatus,
  runKmeans,
  toggleKmeansCluster,
  selectAllKmeansClusters,
  clearKmeansClusters,
} = useOverlayData(runId, ionRows, ionCols)

// ---- Region comparison ----

const {
  regionAIds: cmpRegionAIds,
  regionBIds: cmpRegionBIds,
  minDetectionRate: cmpMinDetectionRate,
  noiseFloorPercentile: cmpNoiseFloorPercentile,
  comparing: cmpComparing,
  progress: cmpProgress,
  error: cmpError,
  results: cmpResults,
  filterStats: cmpFilterStats,
  availableRegions: cmpAvailableRegions,
  canCompare: cmpCanCompare,
  colorA: cmpColorA,
  colorB: cmpColorB,
  buildThumbnailRegions: cmpBuildThumbnailRegions,
  compare: cmpCompare,
  cancel: cmpCancel,
  selectMz: cmpSelectMz,
  reset: cmpReset,
  involvesRoi: cmpInvolvesRoi,
} = useRegionComparison({
  kmeansClusters,
  kmeansLabelsAvailable,
  getKmeansLabels,
  confirmedROIs: confirmedROIs,
  ionCols,
  ionRows,
  dataMode,
  onSelectMzIndex: handleSelectMzIndex,
  setComparisonOverlay,
})

const cmpThumbnail = computed(() => cmpBuildThumbnailRegions())

// Re-running KMeans always invalidates any existing comparison (clusters may
// be renumbered), so reset unconditionally. Clearing/deleting ROIs only
// invalidates the comparison when an ROI was actually one of the compared
// regions — a KMeans-vs-KMeans comparison is unaffected and should survive.
function handleRunKmeans(k: number) {
  cmpReset()
  return runKmeans(k)
}

function handleToggleKmeansCluster(id: number) {
  toggleKmeansCluster(id)
  // The export panel lets the user pick clusters before the KMeans overlay is
  // shown; a click there should also surface the selection on the ion image.
  // (The overlay's own cluster picker only renders while KMeans is visible, so
  // this is a no-op when the toggle came from there.)
  if (!kmeansVisible.value) toggleOverlay('kmeans')
}

function handleRoiClearAll() {
  if (cmpInvolvesRoi()) cmpReset()
  roiClearAll()
}

function handleRoiDelete(id: string) {
  // Only reset when the deleted ROI was one of the compared regions; deleting
  // an unrelated ROI (or any ROI when comparing KMeans-vs-KMeans) is harmless.
  if (cmpInvolvesRoi(id)) cmpReset()
  roiDelete(id)
}

// ---- AI 助手上下文注册（selectedIon + kmeans） ----
// 把实例级数据以惰性 getter 形式注册给 assistant 的分析上下文采集器；
// 页面卸载时成对注销（采集器对缺失 provider 优雅降级）。
registerContextProviders({
  selectedIon: () => {
    const matrix = ionMatrix.value
    if (!matrix || selectedMz.value == null) return null
    return {
      mz: selectedMz.value,
      tolerance: mzTolerance.value,
      matrix,
      width: ionCols.value,
      height: ionRows.value,
    }
  },
  kmeans: () => {
    if (kmeansClusters.value.length === 0 || kmeansK.value == null) return null
    return {
      k: kmeansK.value,
      clusterSizes: kmeansClusters.value.map((c) => c.count),
      selectedIds: [...(selectedKmeansIds.value ?? kmeansClusters.value.map((c) => c.id))],
    }
  },
  umap: () => ({
    ready: clusteringReady.value,
    visible: umapVisible.value,
    computing: clusteringComputing.value,
    error: overlayError.value,
    grid: { width: ionCols.value, height: ionRows.value },
  }),
})

async function handleExportMasks(payload: MaskExportPayload) {
  const width = ionCols.value
  const height = ionRows.value
  if (!width || !height) {
    showToast(t('vizworkbench.page.ionImageNotLoaded'), 'error')
    return
  }

  // Merge every selected region (ROIs + KMeans clusters) into one binary mask.
  const mask = createMask(width, height)
  let any = false
  for (const id of payload.roiIds) {
    const roi = confirmedROIs.value.find((r) => r.id === id)
    if (roi) {
      orMask(mask, roi.mask)
      any = true
    }
  }
  const labels = getKmeansLabels()
  if (payload.clusterIds.length && labels && labels.length >= width * height) {
    orMask(mask, labelsToUnionMask(labels, width, height, payload.clusterIds))
    any = true
  }

  if (!any) {
    showToast(t('vizworkbench.page.nothingToExport'), 'warning')
    return
  }

  try {
    await exportMask(mask, payload.format, {
      datasetName: datasetName.value,
      pixelSizeUm: pixelSizeUm.value,
    })
    showToast(t('common.feedback.exported'), 'success')
  } catch (err) {
    console.error('[ROI] mask export failed', err)
    showToast(t('common.feedback.exportFailed'), 'error')
  }
}

async function handleImportMask(file: File) {
  const width = ionCols.value
  const height = ionRows.value
  if (!width || !height) {
    showToast(t('vizworkbench.page.ionImageNotLoaded'), 'error')
    return
  }
  try {
    const result = await importMask(file, {
      expectedShape: [height, width],
      expectedDatasetName: datasetName.value,
    })
    importedMask.value = result.mask
    // 统计以导入时的矩阵定格（与手绘 ROI 同口径），不随 m/z 切换重算
    importedMaskSummary.value = summarizeImportedMask(result, file.name, displaySourceMatrix.value)
    // 新导入立即生效（覆盖此前可能暂停的旧掩膜状态）
    importedMaskActive.value = true
    showToast(t('vizworkbench.page.maskImported'), 'success')
  } catch (err) {
    console.error('[Mask] import failed', err)
    const message = err instanceof Error ? err.message : String(err)
    showToast(t('vizworkbench.page.maskImportFailed', { error: message }), 'error')
  }
}

function handleClearImportedMask() {
  importedMask.value = null
  importedMaskSummary.value = null
  importedMaskActive.value = true
}

// ---- Reference ROI import (local mode) ----

const compareSectionRef = ref<HTMLElement | null>(null)
// compare 面板与结果表共享展开状态。
const comparisonExpanded = ref(false)

// 展开 compare 时将中列平滑滚到该区域顶部，展示完整控件和结果。
watch(comparisonExpanded, async (expanded) => {
  if (!expanded) return
  await nextTick()
  compareSectionRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
})

// ---- 统计信息 ----

const spectrumStats = computed(() => ({
  intensityRange: getIntensityRange(),
}))

const displayInfo = computed(() => ({
  ...imageInfo.value,
  pixelSize: pixelSize.value,
}))

// ---- 选中像素坐标（processed 模式） ----

const selectedPixelCoord = computed(() => {
  const spec = pixelSpectrum.value
  if (!spec) return null
  return { x: spec.x, y: spec.y }
})

// ---- 事件处理 ----

/** 切换 m/z：直接加载新离子的 slice，保持当前强度标度。 */
async function handleSelectMzIndex(idx: number, addToBatch = true) {
  // `onSpectrumClickByIndex` updates selectedMzIndex synchronously before its
  // image request yields. Starting the request first lets batch mode add the
  // exact clicked index without waiting for a potentially slow image load.
  const selection = onSpectrumClickByIndex(idx)
  if (addToBatch && batchAddMode.value) addIonChannel()
  await selection
}

/** m/z 搜索：在质量轴上二分查找最近的峰，落在容差内则切换离子，否则提示。 */
async function onSearchMz(raw: string) {
  const target = Number(raw.trim())
  if (!Number.isFinite(target) || target <= 0) {
    showToast(t('vizworkbench.page.invalidMz'), 'error')
    return
  }
  const axis = mzAxisRef.value
  if (!axis || !axis.length) {
    showToast(t('vizworkbench.page.mzAxisNotLoaded'), 'error')
    return
  }
  const idx = findClosestMzIndex(target)
  const nearest = axis[idx]!
  const delta = Math.abs(nearest - target)
  if (delta > mzTolerance.value) {
    const fmtDelta = delta < 0.001 ? delta.toExponential(2) : delta.toFixed(4)
    showToast(
      t('vizworkbench.page.noPeakInTolerance', {
        tolerance: mzTolerance.value,
        target,
        nearest: nearest.toFixed(4),
        delta: fmtDelta,
      }),
      'error',
    )
    return
  }
  await handleSelectMzIndex(idx, false)
}

/** 重置所有控件到默认值 */
const resetControls = () => {
  mzTolerance.value = ZARR_STORE.defaultMzTolerance
  colormap.value = 'inferno'
  intensityScale.value = 'linear'
  gamma.value = 1
  clearNormalization()
  resetRange()
}

/** 切换强度标度（TIC 归一化需异步加载，其他即时切换） */
async function onIntensityScaleChange(value: string) {
  intensityScale.value = value
  if (value === 'tic') await loadNormalization('tic')
  else clearNormalization()
}

const setStripRef = (element: HTMLElement | null) => {
  stripRef.value = element
}

const setRoiOverlayRef = (element: any) => {
  roiOverlayRef.value = element
}

const onDisplayMinChange = (value: number) => {
  displayMin.value = value
}

const onDisplayMaxChange = (value: number) => {
  displayMax.value = value
}

// ---- 图像点击 → 加载像素谱（continuous 读 spectra 组，processed 读主数据组） ----

async function onSelectPixel(col: number, row: number) {
  const ctx = getSharedZarrContext()
  if (!ctx.store) return

  // 在像素坐标中查找最近的像素；点在未采集数据的背景上时提示，谱图保持不变
  const pixelIdx = await ctx.store.findPixelByPosition(col, row)
  if (pixelIdx < 0) {
    showToast(t('vizworkbench.page.noPixelAtPosition'), 'warning')
    return
  }
  await loadPixelSpectrum(pixelIdx)
}
</script>

<template>
  <ResultVisualizationLayout :left-panel-collapsed="!annotationExpanded">
    <template #left-panel>
      <AnnotationPanel
        v-model:expanded="annotationExpanded"
        :run-id="runId"
        :acquisition="acquisition"
        :select-mz-index="handleSelectMzIndex"
        :selected-mz-index="selectedMzIndex"
      />
    </template>

    <template #viz>
      <ResultHeader class="shrink-0" :dataset-name="datasetName" :status="status" />
      <IonImageSection
        :is-stale="isStale"
        :ion-matrix="displaySourceMatrix"
        :display-matrix="visualMatrix"
        :selected-mz="selectedMz"
        :mz-tolerance="mzTolerance"
        :colormap="colormap"
        :intensity-scale="intensityScale"
        :gamma="gamma"
        :display-min="displayMin"
        :display-max="displayMax"
        :ion-cols="ionCols"
        :ion-rows="ionRows"
        :roi-tool="roiTool"
        :overlay-data="overlayData"
        :gradient-css="gradientCSS"
        :calc-handle-top="calcHandleTop"
        :clamp-pct="clampPct"
        :format-val="formatVal"
        :data-mode="dataMode"
        :selected-pixel-coord="selectedPixelCoord"
        :ion-loading="loading"
        :ion-error="ionError"
        :normalization-loading="normalizationLoading"
        :normalization-error="normalizationError"
        :has-tic="hasTic"
        :channels-mode="channelsMode"
        :channels="hoverChannels"
        :roi-mask="effectiveRoiMask"
        :roi-highlight-data="roiHighlightOverlay"
        @update:mz-tolerance="mzTolerance = $event"
        @update:colormap="colormap = $event"
        @update:intensity-scale="onIntensityScaleChange"
        @search-mz="onSearchMz"
        @reset-controls="resetControls"
        @reset-range="resetRange"
        @strip-ref="setStripRef"
        @roi-overlay-ref="setRoiOverlayRef"
        @strip-mouse-down="onStripMouseDown"
        @start-strip-drag="startStripDrag"
        @draft-updated="onDraftUpdated"
        @draft-cleared="onDraftCleared"
        @select-pixel="onSelectPixel"
      />

      <SpectrumSection
        :is-stale="isStale"
        :selected-mz="selectedMz"
        :selected-mz-index="selectedMzIndex"
        :mz-tolerance="mzTolerance"
        :intensity-range="spectrumStats.intensityRange"
        :spectrum-mode="spectrumMode"
        :data-mode="dataMode"
        @select-mz-index="handleSelectMzIndex"
      />
    </template>

    <template #compare>
      <!-- Region comparison：左 controls+preview，右结果表。
           桌面端折叠栏保留在首屏，展开后由中列承载滚动。 -->
      <div
        ref="compareSectionRef"
        class="w-full flex flex-col items-stretch gap-4 lg:flex-row lg:items-stretch"
      >
        <!-- 左侧正常参与文档流，它的自然高度决定整个 compare 区域的高度。 -->
        <div class="w-full min-w-0 flex flex-col lg:w-0 lg:flex-[2_1_0%]">
          <CompareRegionsPanel
            :regions="cmpAvailableRegions"
            :spectrum-mode="spectrumMode"
            v-model:region-a-ids="cmpRegionAIds"
            v-model:region-b-ids="cmpRegionBIds"
            v-model:min-detection-rate="cmpMinDetectionRate"
            v-model:noise-floor-percentile="cmpNoiseFloorPercentile"
            v-model:expanded="comparisonExpanded"
            :comparing="cmpComparing"
            :progress="cmpProgress"
            :error="cmpError"
            :can-compare="cmpCanCompare"
            :color-a="cmpColorA"
            :color-b="cmpColorB"
            @compare="cmpCompare"
            @cancel="cmpCancel"
          >
            <template #preview>
              <!-- Only the selected A/B regions are drawn (clusters or ROIs).
                   Unselected confirmed ROIs are NOT shown, so the thumbnail
                   stays focused on the current comparison. -->
              <RegionPreviewThumbnail
                v-if="cmpThumbnail"
                :a="cmpThumbnail.a"
                :b="cmpThumbnail.b"
                :rois="[]"
                :matrix="currentIonMatrix"
                :width="cmpThumbnail.dims.width"
                :height="cmpThumbnail.dims.height"
              />
            </template>
          </CompareRegionsPanel>
        </div>
        <!-- 桌面端右侧不参与父容器高度计算，只填满左侧确定的共享高度。 -->
        <div class="w-full min-w-0 lg:relative lg:w-0 lg:flex-[5_1_0%] lg:min-h-0">
          <ComparisonResultsTable
            class="lg:absolute lg:inset-0"
            :results="cmpResults"
            :selected-mz-index="selectedMzIndex"
            :filter-stats="cmpFilterStats"
            :region-a-color="rgbCss(cmpColorA)"
            :region-b-color="rgbCss(cmpColorB)"
            v-model:expanded="comparisonExpanded"
            @select-mz="cmpSelectMz"
          />
        </div>
      </div>
    </template>

    <template #side-panel>
      <VizInfoPanel
        class="shrink-0 py-4 w-full"
        :global-min="globalMin"
        :global-max="globalMax"
        :display-min="displayMin"
        :display-max="displayMax"
        :channels-mode="channelsMode"
        :histogram="intensityHistogram"
        :info="displayInfo"
        :acquisition="acquisition"
        :source-file="sourceFile"
        :methods="methods"
        :sorted-values="sortedNonZero"
        @update:display-min="onDisplayMinChange"
        @update:display-max="onDisplayMaxChange"
      >
        <template #actions>
          <OverlayControls
            v-model:umap-alpha="umapAlpha"
            v-model:kmeans-alpha="kmeansAlpha"
            :umap-visible="umapVisible"
            :kmeans-visible="kmeansVisible"
            :overlay-loading="overlayLoading"
            :clustering-creating="clusteringCreating"
            :clustering-computing="clusteringComputing"
            :clustering-ready="clusteringReady"
            :clustering-refreshing="clusteringRefreshing"
            :overlay-error="overlayError"
            :kmeans-clusters="kmeansClusters"
            :kmeans-labels-available="kmeansLabelsAvailable"
            :kmeans-k="kmeansK"
            :kmeans-computing="kmeansComputing"
            :selected-kmeans-ids="selectedKmeansIds"
            :storage-mode="storageMode"
            :roi-tool="roiTool"
            :draft-ready="draftReady"
            :viewing-roi="viewingROI"
            :confirmed-rois="confirmedROIs as any"
            :selected-roi-ids="selectedRoiIds"
            :gamma="gamma"
            :channels-mode="channelsMode"
            :channels-enabled="channelsEnabled"
            :ion-channels="ionChannels"
            :can-add-channel="canAddChannel"
            :channels-loading="channelsLoading"
            :selected-mz="selectedMz"
            :max-ion-channels="MAX_ION_CHANNELS"
            :batch-add-mode="batchAddMode"
            :imported-mask="importedMaskSummary"
            :imported-mask-active="importedMaskActive"
            @toggle-overlay="toggleOverlay"
            @retry-clustering="retryClustering"
            @enable-clustering="createClusteringTask"
            @refresh-clustering="refreshClusteringStatus"
            @toggle-kmeans-cluster="handleToggleKmeansCluster"
            @kmeans-select-all="selectAllKmeansClusters"
            @kmeans-clear-all="clearKmeansClusters"
            @run-kmeans="handleRunKmeans"
            @export-umap="exportUmapPng"
            @export-kmeans="exportKmeansPng"
            @update:roi-tool="roiSelectTool"
            @update:viewing-roi="viewingROI = $event"
            @roi-confirm="roiConfirm"
            @roi-cancel="roiCancel"
            @roi-delete="handleRoiDelete"
            @toggle-roi-selection="toggleRoiSelection"
            @roi-select-all="selectAllRois"
            @roi-deselect-all="clearRoiSelection"
            @export-masks="handleExportMasks"
            @import-mask="handleImportMask"
            @clear-imported-mask="handleClearImportedMask"
            @toggle-imported-mask="importedMaskActive = !importedMaskActive"
            @roi-clear-all="handleRoiClearAll"
            @update:gamma="gamma = $event"
            @update:channels-enabled="onChannelsEnabledChange"
            @add-current-channel="onAddCurrentChannel"
            @toggle-batch-add="toggleBatchAdd"
            @update-channel-color="updateChannelColor"
            @update-channel-opacity="updateChannelOpacity"
            @remove-channel="removeChannel"
            @toggle-channel-visible="toggleChannelVisible"
            @retry-channel="retryChannel"
            @clear-channels="clearChannels"
          />
        </template>
      </VizInfoPanel>
    </template>
  </ResultVisualizationLayout>
</template>
