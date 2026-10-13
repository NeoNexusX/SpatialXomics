import { ref, shallowRef, markRaw, type Ref } from 'vue'
import { roiColorAt, rgbCss } from '@/features/vizworkbench/utils/regionPalette'

export type ROIType = 'rectangle' | 'freehand'

export interface ROIPoint {
  x: number
  y: number
}

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
  type: ROIType
  label: string
  color: string
  mask: boolean[][]
  stats: ROIStats | null
  spectrum: { mz: number; intensity: number }[] | null
}

export interface DraftROI {
  type: ROIType
  rect: { x0: number; y0: number; x1: number; y1: number } | null
  path: ROIPoint[]
}

export function useROI(
  // Arguments
  imageWidth: Ref<number>,
  imageHeight: Ref<number>,
) {
  // State
  const selectedTool = ref<ROIType | null>(null)
  const draft = ref<DraftROI | null>(null)
  // shallowRef: ROI masks are large boolean[][] arrays — deep-proxying them
  // costs significant memory/CPU. All updates below are replace-style, and
  // consumers only read, so shallow reactivity is behavior-identical.
  const confirmedROIs = shallowRef<ConfirmedROI[]>([])
  // Selected ROI ids: null = all selected (same convention as
  // selectedKmeansIds in useOverlayData). Drives the ion-image highlight and
  // the export mask. Always replaced wholesale, never mutated in place — a
  // computed tracking this ref would not see an in-place Set mutation.
  const selectedRoiIds = ref<Set<string> | null>(null)

  let nextId = 1
  let nextColorIdx = 0
  // ROI colors come from the shared region palette, starting past the slots
  // KMeans can occupy - a ROI never shares a color with any cluster.

  // Methods
  function selectTool(type: ROIType | null) {
    selectedTool.value = type
    draft.value = type ? { type, rect: null, path: [] } : null
  }

  function clearDraft() {
    draft.value = null
    selectedTool.value = null
  }

  function generateMask(draftROI: DraftROI, w: number, h: number): boolean[][] {
    const mask: boolean[][] = []
    for (let r = 0; r < h; r++) {
      mask.push(new Array(w).fill(false))
    }

    if (draftROI.type === 'rectangle' && draftROI.rect) {
      const { x0, y0, x1, y1 } = draftROI.rect
      const minX = Math.max(0, Math.min(x0, x1))
      const maxX = Math.min(w - 1, Math.max(x0, x1))
      const minY = Math.max(0, Math.min(y0, y1))
      const maxY = Math.min(h - 1, Math.max(y0, y1))
      for (let r = minY; r <= maxY; r++) {
        for (let c = minX; c <= maxX; c++) {
          mask[r]![c] = true
        }
      }
    }

    if (draftROI.type === 'freehand' && draftROI.path.length > 2) {
      const path = draftROI.path
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.beginPath()
        ctx.moveTo(path[0]!.x, path[0]!.y)
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(path[i]!.x, path[i]!.y)
        }
        ctx.closePath()
        ctx.fill('evenodd')
        const imgData = ctx.getImageData(0, 0, w, h)
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            if (imgData.data[(r * w + c) * 4 + 3]! > 0) {
              mask[r]![c] = true
            }
          }
        }
      }
    }

    return mask
  }

  function computeStats(
    matrix: Float32Array,
    w: number,
    h: number,
    mask: boolean[][],
  ): ROIStats | null {
    let sum = 0,
      count = 0,
      min = Infinity,
      max = -Infinity
    for (let r = 0; r < h; r++) {
      const rowOff = r * w
      const maskRow = mask[r]!
      for (let c = 0; c < w; c++) {
        if (!maskRow[c]) continue
        const v = matrix[rowOff + c] ?? 0
        if (!Number.isFinite(v)) continue
        sum += v
        count++
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    if (count === 0) return null
    const mean = sum / count
    let sumSq = 0
    for (let r = 0; r < h; r++) {
      const rowOff = r * w
      const maskRow = mask[r]!
      for (let c = 0; c < w; c++) {
        if (!maskRow[c]) continue
        const v = matrix[rowOff + c] ?? 0
        if (!Number.isFinite(v)) continue
        sumSq += (v - mean) ** 2
      }
    }
    return {
      pixelCount: count,
      mean,
      std: Math.sqrt(sumSq / count),
      min,
      max,
      sum,
    }
  }

  function confirmROI(
    matrix: Float32Array,
    w: number,
    h: number,
    draftROI: DraftROI,
    label?: string,
  ): ConfirmedROI | null {
    if (!w || !h) return null
    const mask = generateMask(draftROI, w, h)
    const pixelCount = mask.flat().filter(Boolean).length
    if (pixelCount === 0) return null

    const stats = computeStats(matrix, w, h, mask)
    const roi: ConfirmedROI = markRaw({
      id: `roi-${nextId++}`,
      type: draftROI.type,
      label: label ?? `ROI ${nextId - 1}`,
      color: rgbCss(roiColorAt(nextColorIdx)),
      mask,
      stats,
      spectrum: null,
    })
    nextColorIdx++
    confirmedROIs.value = [...confirmedROIs.value, roi]
    // Keep the just-confirmed ROI visible: with an explicit selection set,
    // add the new id so it highlights immediately (null = all already covers it).
    if (selectedRoiIds.value !== null) {
      selectedRoiIds.value = new Set(selectedRoiIds.value).add(roi.id)
    }
    clearDraft()
    return roi
  }

  function deleteROI(id: string) {
    confirmedROIs.value = confirmedROIs.value.filter((r) => r.id !== id)
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
    selectedRoiIds.value = null
    clearDraft()
    nextId = 1
    nextColorIdx = 0
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
    selectedTool,
    confirmedROIs,
    selectedRoiIds,
    isRoiSelected,
    toggleRoiSelection,
    selectAllRois,
    clearRoiSelection,
    selectTool,
    confirmROI,
    deleteROI,
    clearAllROIs,
  }
}
