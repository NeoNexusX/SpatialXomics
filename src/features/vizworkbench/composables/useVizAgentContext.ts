import { onUnmounted } from 'vue'
import {
  registerContextProviders,
  unregisterContextProviders,
  type AnalysisContextProviders,
} from '@/features/agent/bridge/analysisContext'
import { metadataAttrsRef, pixelSpectrum, spectrumView, type ZarrSession } from './useZarrIonImage'
import type { IonImageDisplay } from './useIonImageDisplay'
import type { ResultMeta } from './useResultMeta'
import type { IonChannelState } from './useIonChannels'
import type { RoiState } from './useROI'
import type { ClusteringState } from './useOverlayData'

/** The page modules the assistant's page tools read. */
export interface VizContextSources {
  zarr: ZarrSession
  display: IonImageDisplay
  meta: ResultMeta
  multiIon: IonChannelState
  roi: RoiState
  clustering: ClusteringState
}

/** The provider keys this page owns; the annotation panel registers its own. */
const PAGE_KEYS = ['selectedIon', 'kmeans', 'umap', 'datasetInfo', 'pageHeader'] as const

type PageProviders = Required<Pick<AnalysisContextProviders, (typeof PAGE_KEYS)[number]>>

/** Placeholder of an image statistic that is not available yet. */
function present(value: string) {
  return value === '--' ? null : value
}

/**
 * What the assistant sees of the result page. Every getter reads the current
 * state when a tool runs, so registering once is enough.
 */
export function vizContextProviders(sources: VizContextSources): PageProviders {
  const { zarr, display, meta, multiIon, roi, clustering } = sources
  return {
    selectedIon: () => {
      const matrix = zarr.imageMatrix
      if (!matrix) return null
      // Processed data shows its TIC image, which has no m/z.
      const mz = zarr.isProcessed ? 0 : zarr.selectedMz
      const tolerance = zarr.isProcessed ? 0 : zarr.mzTolerance
      return {
        mz,
        tolerance,
        matrix,
        width: zarr.ionCols,
        height: zarr.ionRows,
        // get_ion 的完整视图：显示参数 / 谱图区 / 通道列表 / ROI / 掩膜（实时值）
        view: {
          mz,
          tolerance,
          dataMode: zarr.dataMode ?? 'continuous',
          display: {
            colormap: display.colormap,
            intensityScale: display.intensityScale,
            gamma: display.gamma,
            displayMin: display.displayMin,
            displayMax: display.displayMax,
            globalMin: display.globalMin,
            globalMax: display.globalMax,
          },
          spectrum: {
            view: spectrumView.value,
            selectedPixel: pixelSpectrum.value
              ? { x: pixelSpectrum.value.x, y: pixelSpectrum.value.y }
              : null,
          },
          channels: {
            enabled: multiIon.enabled,
            overlayActive: multiIon.overlayActive,
            list: multiIon.channels.map((c) => ({
              id: c.id,
              mz: c.mz,
              color: [c.color.r, c.color.g, c.color.b],
              visible: c.visible,
              opacity: c.opacity ?? 1,
              loading: c.loading,
              error: c.error,
            })),
          },
          roi: {
            confirmed: roi.confirmedROIs.length,
            selected: roi.confirmedROIs.filter((r) => roi.isRoiSelected(r.id)).length,
          },
          // 导入的掩膜就是 ROI，这里只统计其中来自文件的数量
          masks: { imported: roi.confirmedROIs.filter((r) => r.type === 'imported').length },
        },
      }
    },
    kmeans: () => {
      const { kmeansClusters, kmeansK, kmeansComputing, selectedKmeansIds } = clustering
      if (kmeansClusters.length === 0 && kmeansK == null && !kmeansComputing) return null
      return {
        k: kmeansK,
        clusterSizes: kmeansClusters.map((c) => c.count),
        // null = every cluster is selected
        selectedIds: [...(selectedKmeansIds ?? kmeansClusters.map((c) => c.id))],
        // get_kmeans 的完整视图与叠加栅格
        view: {
          clusters: kmeansClusters.map((c) => ({
            id: c.id,
            color: [...c.color] as [number, number, number],
            count: c.count,
          })),
          labelsAvailable: clustering.kmeansLabelsAvailable,
          computing: kmeansComputing,
          visible: clustering.kmeansVisible,
          labels: () => clustering.getKmeansLabels(),
          rgb: () => clustering.getKmeansRgb(),
          dims: () => clustering.getOverlayDims(),
        },
      }
    },
    umap: () => ({
      ready: clustering.clusteringReady,
      visible: clustering.umapVisible,
      computing: clustering.clusteringComputing,
      error: clustering.overlayError,
      grid: { width: zarr.ionCols, height: zarr.ionRows },
      rgb: () => clustering.getUmapRgb(),
      occupancyMask: () => clustering.getUmapOccupancyMask(),
    }),
    // 右侧数据集信息面板整体（get_dataset；bridge 侧做 raw 展开 + 双命名排除投影）
    datasetInfo: () => {
      if (!meta.datasetName && !meta.sourceFile) return null
      const { imageInfo } = display
      return {
        attrs: { ...(metadataAttrsRef.value ?? {}) },
        acquisition: { ...meta.acquisition },
        sourceFile: meta.sourceFile as unknown as Record<string, unknown> | null,
        methods: [...meta.methods],
        displayRange: {
          globalMin: display.globalMin,
          globalMax: display.globalMax,
          displayMin: display.displayMin,
          displayMax: display.displayMax,
        },
        imageInfo: {
          pixels: present(imageInfo.pixels),
          nonZero: present(imageInfo.nonZero),
          totalIon: present(imageInfo.totalIon),
          pixelSize: meta.pixelSize || null,
        },
      }
    },
    // 页头（get_page.header）：数据集名 + 处理状态徽章
    pageHeader: () => ({ datasetName: meta.datasetName, status: meta.status }),
  }
}

/** Register the page's providers now and remove exactly those when the page unmounts. */
export function useVizAgentContext(sources: VizContextSources) {
  registerContextProviders(vizContextProviders(sources))
  onUnmounted(() => unregisterContextProviders([...PAGE_KEYS]))
}
