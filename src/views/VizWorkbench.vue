<script setup lang="ts">
import { computed, onUnmounted, ref, toRef } from 'vue'
import VizInfoPanel from '@/features/vizworkbench/components/visuals/VizInfoPanel.vue'
import ResultVisualizationLayout from '@/features/vizworkbench/components/ResultVisualizationLayout.vue'
import ResultHeader from '@/features/vizworkbench/components/visuals/ResultHeader.vue'
import IonImageSection from '@/features/vizworkbench/components/IonImageSection.vue'
import SpectrumSection from '@/features/vizworkbench/components/SpectrumSection.vue'
import IonChannelPanel from '@/features/vizworkbench/components/visuals/IonChannelPanel.vue'
import ClusteringPanel from '@/features/vizworkbench/components/ClusteringPanel.vue'
import ROIPanel from '@/features/vizworkbench/components/visuals/ROIPanel.vue'
import MaskExportPanel from '@/features/vizworkbench/components/visuals/MaskExportPanel.vue'
import SectionHelp from '@/features/vizworkbench/components/SectionHelp.vue'
import CollapsibleSection from '@/shared/components/CollapsibleSection.vue'
import AnnotationPanel from '@/features/vizworkbench/components/annotation/AnnotationPanel.vue'
import RegionComparisonSection from '@/features/vizworkbench/components/RegionComparisonSection.vue'
import {
  useZarrIonImage,
  pixelSpectrum,
  loadPixelSpectrum,
  mzAxisRef,
  getSharedZarrContext,
  disposeZarrState,
  loadIonMatrixByIndex,
  findClosestMzIndex,
} from '@/features/vizworkbench/composables/useZarrIonImage'
import { useIonImageDisplay } from '@/features/vizworkbench/composables/useIonImageDisplay'
import { useOverlayData } from '@/features/vizworkbench/composables/useOverlayData'
import { useROI } from '@/features/vizworkbench/composables/useROI'
import { useRoiCollect } from '@/features/vizworkbench/composables/useRoiCollect'
import { useIonChannels } from '@/features/vizworkbench/composables/useIonChannels'
import { useResultMeta } from '@/features/vizworkbench/composables/useResultMeta'
import { useVizAgentContext } from '@/features/vizworkbench/composables/useVizAgentContext'
import { exportMask, type ExportFormat } from '@/features/vizworkbench/utils/maskExport'
import { buildRegionMask, type Region, type RegionGrid } from '@/features/vizworkbench/utils/region'
import { setAgentDataset, markAgentDatasetReady } from '@/features/agent/bridge/datasetBinding'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'

interface VizWorkbenchState {
  runId?: string
  processName?: string
  datasetName?: string
  filename?: string
  filePublicId?: string
  methods?: string[]
  status?: string
}

// One page instance shows one run: both entries (the workspace list and Explore
// on the datasets page) navigate here from another page with the run in
// history.state, which is read once. Nothing below handles a run change.
const state = history.state as VizWorkbenchState | null
const runId = state?.runId != null ? String(state.runId) : ''
const isStale = state?.runId == null

const { showToast } = useToast()

// 注释面板（左侧）默认收起：桌面为细条，小屏为页面流里的一条按钮
const annotationExpanded = ref(false)

// ---- 数据集与元数据 ----

const meta = useResultMeta(runId)
const zarr = useZarrIonImage()

// init/dispose 的并发守卫（代次检查）在 useZarrIonImage 内部完成：离开页面时
// disposeZarrState() 会让进行中的 init 自行 dispose 孤儿 store 并放弃写入模块状态。
// The bridge contains only dataset identity and never imports the agent runtime.
const agentGeneration = setAgentDataset(runId)
void zarr.init(runId).then(() => {
  if (!zarr.error) markAgentDatasetReady(agentGeneration)
})

// ---- 离子图显示 ----

const display = useIonImageDisplay(zarr)
const displayMatrix = toRef(display, 'matrix')

// ---- 工具箱：ROI、多离子叠加、UMAP/KMeans ----

/** The ion-image grid every region (ROI, KMeans cluster) is defined on. */
const regionGrid = computed<RegionGrid>(() => ({ runId, shape: [zarr.ionRows, zarr.ionCols] }))

const roi = useROI(displayMatrix, regionGrid)

const multiIon = useIonChannels({
  currentMzIndex: toRef(zarr, 'selectedMzIndex'),
  currentMz: toRef(zarr, 'selectedMz'),
  tolerance: toRef(zarr, 'mzTolerance'),
  isContinuous: toRef(zarr, 'isContinuous'),
  ready: toRef(zarr, 'ready'),
  loadMatrix: loadIonMatrixByIndex,
})

// ROI collect tool: the current single image's pixels with or without signal.
const roiCollect = useRoiCollect(roi.editor, {
  matrix: displayMatrix,
  acquired: toRef(zarr, 'acquiredMask'),
  image: computed(() => (zarr.isProcessed ? 'TIC' : zarr.ionMatrixMz)),
  available: computed(() => !multiIon.overlayActive),
  loading: toRef(zarr, 'loading'),
})

const clustering = useOverlayData(runId, toRef(zarr, 'ionRows'), toRef(zarr, 'ionCols'))

/** Saved ROIs and KMeans clusters: what the editor, the export and the comparison work on. */
const regions = computed<Region[]>(() => [...clustering.kmeansRegions, ...roi.confirmedROIs])

// ---- SXO-Harness 上下文（页面卸载时只注销自己注册的几项） ----

useVizAgentContext({ zarr, display, meta, multiIon, roi, clustering })

// 离开页面时释放模块级状态，避免大数组（mzAxis、meanChartData、ticMatrix 等）
// 和 ZarrStore 缓存在 SPA 导航后仍驻留内存
onUnmounted(() => {
  setAgentDataset('', true)
  multiIon.reset()
  disposeZarrState()
})

// ---- 掩膜导出 / 导入 ----

async function handleExportMasks(format: ExportFormat, selected: Region[]) {
  const grid = regionGrid.value
  if (!grid.shape[0] || !grid.shape[1]) {
    showToast(t('vizworkbench.page.ionImageNotLoaded'), 'error')
    return
  }

  const mask = buildRegionMask(selected, grid)
  if (!mask) {
    showToast(t('vizworkbench.page.nothingToExport'), 'warning')
    return
  }

  try {
    await exportMask({ data: mask, shape: grid.shape }, format, {
      datasetName: meta.datasetName,
      pixelSizeUm: meta.pixelSizeUm,
    })
    showToast(t('common.feedback.exported'), 'success')
  } catch (err) {
    console.error('[ROI] mask export failed', err)
    showToast(t('common.feedback.exportFailed'), 'error')
  }
}

async function handleImportMasks(files: File[]) {
  if (!zarr.ionCols || !zarr.ionRows) {
    showToast(t('vizworkbench.page.ionImageNotLoaded'), 'error')
    return
  }
  // 每个文件独立导入为 ROI：个别文件无效时其余仍然生效，失败逐个提示
  const { imported, failed } = await roi.importRois(files, meta.datasetName)
  for (const f of failed) {
    console.error('[Mask] import failed:', f.name, f.error)
    showToast(t('vizworkbench.page.maskImportFailed', { error: `${f.name}: ${f.error}` }), 'error')
  }
  if (imported.length) {
    showToast(t('vizworkbench.page.masksImported', { count: imported.length }), 'success')
  }
}

// ---- m/z 与像素选择 ----

/** 选中像素坐标（processed 模式在离子图上标出） */
const selectedPixelCoord = computed(() => {
  const spec = pixelSpectrum.value
  return spec ? { x: spec.x, y: spec.y } : null
})

/** 切换 m/z：直接加载新离子的 slice，保持当前强度标度。 */
async function handleSelectMzIndex(idx: number, addToBatch = true) {
  // `selectMzIndex` updates selectedMzIndex synchronously before its image
  // request yields. Starting the request first lets batch mode add the exact
  // clicked index without waiting for a potentially slow image load.
  const selection = zarr.selectMzIndex(idx)
  if (addToBatch) multiIon.addPickedMz()
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
  if (delta > zarr.mzTolerance) {
    const fmtDelta = delta < 0.001 ? delta.toExponential(2) : delta.toFixed(4)
    showToast(
      t('vizworkbench.page.noPeakInTolerance', {
        tolerance: zarr.mzTolerance,
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
        :acquisition="meta.acquisition"
        :select-mz-index="handleSelectMzIndex"
        :selected-mz-index="zarr.selectedMzIndex"
      />
    </template>

    <template #viz>
      <ResultHeader class="shrink-0" :dataset-name="meta.datasetName" :status="meta.status" />
      <IonImageSection
        :is-stale="isStale"
        :zarr="zarr"
        :display="display"
        :roi="roi"
        :multi-ion="multiIon"
        :overlay-data="clustering.overlayData"
        :selected-pixel-coord="selectedPixelCoord"
        @search-mz="onSearchMz"
        @select-pixel="onSelectPixel"
      />

      <SpectrumSection
        :is-stale="isStale"
        :selected-mz="zarr.selectedMz"
        :selected-mz-index="zarr.selectedMzIndex"
        :mz-tolerance="zarr.mzTolerance"
        :intensity-range="display.intensityRange"
        :spectrum-mode="meta.spectrumMode"
        :data-mode="zarr.dataMode"
        @select-mz-index="handleSelectMzIndex"
      />
    </template>

    <template #compare>
      <RegionComparisonSection
        :regions="regions"
        :grid="regionGrid"
        :data-mode="zarr.dataMode"
        :backdrop="zarr.imageMatrix"
        :spectrum-mode="meta.spectrumMode"
        :selected-mz-index="zarr.selectedMzIndex"
        @select-mz="handleSelectMzIndex"
      />
    </template>

    <template #side-panel>
      <VizInfoPanel :display="display" :meta="meta" :channels-mode="multiIon.overlayActive">
        <template #actions>
          <!-- 多离子叠加与 UMAP/KMeans 只适用于 continuous 数据 -->
          <template v-if="meta.storageMode === 'continuous'">
            <CollapsibleSection :title="$t('vizworkbench.overlay.multiIon')" class="mt-5">
              <template #title-help>
                <SectionHelp :label="$t('vizworkbench.overlay.multiIon')">
                  {{ $t('vizworkbench.channels.hint') }}
                </SectionHelp>
              </template>
              <IonChannelPanel :state="multiIon" />
            </CollapsibleSection>
            <CollapsibleSection :title="$t('vizworkbench.overlay.clustering')" class="mt-5">
              <ClusteringPanel :clustering="clustering" :rois="roi.confirmedROIs" />
            </CollapsibleSection>
          </template>
          <CollapsibleSection :title="$t('vizworkbench.overlay.roi')" class="mt-5">
            <ROIPanel :state="roi" :collect="roiCollect" :regions="regions" />
          </CollapsibleSection>
          <CollapsibleSection :title="$t('vizworkbench.mask.title')" class="mt-5">
            <MaskExportPanel
              :regions="regions"
              :selected-roi-ids="roi.selectedRoiIds"
              :kmeans-visible="clustering.kmeansVisible"
              :selected-kmeans-ids="clustering.selectedKmeansIds"
              @export-masks="handleExportMasks"
              @import-masks="handleImportMasks"
            />
          </CollapsibleSection>
        </template>
      </VizInfoPanel>
    </template>
  </ResultVisualizationLayout>
</template>
