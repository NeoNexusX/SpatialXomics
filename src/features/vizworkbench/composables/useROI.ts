import type { Region } from '@/features/vizworkbench/utils/region'
import { ref, shallowRef, markRaw } from 'vue'
import { roiColorAt, rgbCss } from '@/features/vizworkbench/utils/regionPalette'

import {
  paintRoiShape,
  summarizeRoiMask,
  type DraftROI,
  type RoiTool,
} from '@/features/vizworkbench/utils/roiMask'

export type { DraftROI, ROIPoint, ROIType } from '@/features/vizworkbench/utils/roiMask'

export const DEFAULT_ROI_OPACITY = 0.4

interface ROIStats {
  pixelCount: number
  mean: number
  std: number
  min: number
  max: number
  sum: number
}

export interface ConfirmedROI {
  id: string
  /** Drawing or collect tool, a multi-step draft ('composite'), or an imported mask file. */
  type: RoiTool | 'composite' | 'imported'
  label: string
  color: string
  mask: Uint8Array
  shape: [height: number, width: number]
  pixelCount: number
  stats: ROIStats | null
  spectrum: { mz: number; intensity: number }[] | null
}

export function roiToRegion(roi: ConfirmedROI, runId: string): Region {
  return {
    id: `roi:${roi.id}`,
    kind: 'roi',
    sourceId: roi.id,
    label: roi.label,
    color: roi.color,
    pixelCount: roi.pixelCount,
    grid: { runId, shape: roi.shape },
    mask: roi.mask,
  }
}

export function useROI() {
  // shallowRef: ROI masks are large arrays — deep-proxying them
  // costs significant memory/CPU. All updates below are replace-style, and
  // consumers only read, so shallow reactivity is behavior-identical.
  const confirmedROIs = shallowRef<ConfirmedROI[]>([])
  const roiOpacities = shallowRef<ReadonlyMap<string, number>>(new Map())
  // Selected ROI ids: null = all selected (same convention as
  // selectedKmeansIds in useOverlayData). Drives the ion-image highlight and
  // the export mask. Always replaced wholesale, never mutated in place — a
  // computed tracking this ref would not see an in-place Set mutation.
  const selectedRoiIds = ref<Set<string> | null>(null)

  let nextId = 1
  // ROI colors come from the shared region palette, starting past the slots
  // KMeans can occupy - a ROI never shares a color with any cluster.

  function confirmROI(
    matrix: Float32Array,
    w: number,
    h: number,
    draftROI: DraftROI,
    label?: string,
  ): ConfirmedROI | null {
    const mask = new Uint8Array(w * h)
    paintRoiShape(mask, w, h, draftROI, 1)
    return confirmMask(matrix, w, h, mask, draftROI.type, label)
  }

  function confirmMask(
    matrix: Float32Array | null,
    w: number,
    h: number,
    raster: Uint8Array,
    type: ConfirmedROI['type'],
    label?: string,
  ): ConfirmedROI | null {
    if (!w || !h || raster.length !== w * h) return null
    const { pixelCount, sampleCount, sum, stats } = summarizeRoiMask(raster, matrix)
    if (!pixelCount) return null
    const number = nextId++
    const roi: ConfirmedROI = markRaw({
      id: `roi-${number}`,
      type,
      label: label ?? `ROI ${number}`,
      color: rgbCss(roiColorAt(number - 1)),
      mask: raster.slice(),
      shape: [h, w],
      pixelCount,
      stats: stats && { ...stats, pixelCount: sampleCount, sum },
      spectrum: null,
    })
    confirmedROIs.value = [...confirmedROIs.value, roi]
    // Keep the just-confirmed ROI visible: with an explicit selection set,
    // add the new id so it highlights immediately (null = all already covers it).
    if (selectedRoiIds.value !== null) {
      selectedRoiIds.value = new Set(selectedRoiIds.value).add(roi.id)
    }
    return roi
  }

  function updateRoiOpacity(id: string, opacity: number) {
    if (!Number.isFinite(opacity) || !confirmedROIs.value.some((roi) => roi.id === id)) return
    const value = Math.max(0, Math.min(1, opacity))
    if (value === (roiOpacities.value.get(id) ?? DEFAULT_ROI_OPACITY)) return
    roiOpacities.value = new Map(roiOpacities.value).set(id, value)
  }

  function deleteROI(id: string) {
    confirmedROIs.value = confirmedROIs.value.filter((r) => r.id !== id)
    if (roiOpacities.value.has(id)) {
      const next = new Map(roiOpacities.value)
      next.delete(id)
      roiOpacities.value = next
    }
    // Drop the id from the selection too. Counts are computed by filtering
    // confirmedROIs (never by Set.size), so stale ids are harmless — but
    // keeping the set honest avoids the trap for future callers.
    if (selectedRoiIds.value?.has(id)) {
      const next = new Set(selectedRoiIds.value)
      next.delete(id)
      selectedRoiIds.value = next
    }
  }

  function clearAllROIs() {
    confirmedROIs.value = []
    roiOpacities.value = new Map()
    selectedRoiIds.value = null
    nextId = 1
  }

  // ---- Selection (mirrors toggleKmeansCluster / selectAll / clearAll) ----

  /** True when the ROI participates in the highlight + export. */
  function isRoiSelected(id: string): boolean {
    return selectedRoiIds.value === null || selectedRoiIds.value.has(id)
  }

  function toggleRoiSelection(id: string) {
    const cur = selectedRoiIds.value ?? new Set(confirmedROIs.value.map((r) => r.id))
    const next = new Set(cur)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedRoiIds.value = next
  }

  function selectAllRois() {
    selectedRoiIds.value = null // null = all
  }

  function clearRoiSelection() {
    selectedRoiIds.value = new Set()
  }

  return {
    confirmedROIs,
    roiOpacities,
    updateRoiOpacity,
    selectedRoiIds,
    isRoiSelected,
    toggleRoiSelection,
    selectAllRois,
    clearRoiSelection,
    confirmROI,
    confirmMask,
    deleteROI,
    clearAllROIs,
  }
}
