import { computed, ref, type Ref } from 'vue'
import ROIOverlay from '@/features/vizworkbench/components/visuals/ROIOverlay.vue'
import { useROI, type DraftROI, type ROIType } from '@/features/vizworkbench/composables/useROI'
import { hexToRgb } from '@/features/vizworkbench/utils/regionPalette'

/**
 * Alpha (0-255) for the selected-ROI outline on the ion image. Only the ROI's
 * boundary pixels are painted — never a fill — so the underlying ion
 * intensities stay readable: the outline marks *which* region is selected
 * without hiding *what's inside it*. Fixed rather than user-controlled
 * (unlike the UMAP/KMeans opacity sliders).
 */
const ROI_OUTLINE_ALPHA = 255

export function useResultROI(
  // Arguments
  ionMatrix: Ref<Float32Array | null>,
  ionCols: Ref<number>,
  ionRows: Ref<number>,
) {
  // External composables
  const {
    selectedTool: roiTool,
    confirmedROIs,
    selectedRoiIds,
    isRoiSelected,
    toggleRoiSelection,
    selectAllRois,
    clearRoiSelection,
    selectTool: roiSelectTool,
    confirmROI: roiConfirmDraft,
    deleteROI: roiDelete,
    clearAllROIs,
  } = useROI(ionCols, ionRows)

  // State
  const roiOverlayRef = ref<InstanceType<typeof ROIOverlay> | null>(null)
  const currentDraft = ref<DraftROI | null>(null)
  const viewingROI = ref(false)

  // Computed
  const draftReady = computed(() => currentDraft.value !== null)

  /**
   * Union of every confirmed ROI as a 0/1 mask (row-major, 1 = inside any ROI).
   * null when the ROI-only view is off or there are no ROIs. Exposed so the
   * multi-ion overlay can mask each channel without copying its matrix.
   */
  const roiUnionMask = computed<Uint8Array | null>(() => {
    const w = ionCols.value
    const h = ionRows.value
    if (!viewingROI.value || !confirmedROIs.value.length || !w || !h) return null
    const mask = new Uint8Array(w * h)
    for (const roi of confirmedROIs.value) {
      const m = roi.mask
      if (!m || !m.length) continue
      for (let r = 0; r < h; r++) {
        const rowOff = r * w
        const maskRow = m[r]
        if (!maskRow) continue
        for (let c = 0; c < w; c++) {
          if (maskRow[c]) mask[rowOff + c] = 1
        }
      }
    }
    return mask
  })

  /**
   * RGBA overlay outlining the SELECTED ROIs in their own palette colors.
   * Only boundary pixels (a mask pixel with any 4-neighbour outside the mask)
   * are painted, so the region's interior stays transparent and the ion
   * intensities under it remain visible. Independent of `viewingROI` (a
   * filter) and of the UMAP/KMeans/comparison overlay layer (which is mutually
   * exclusive) — the renderer draws this as a separate layer so it coexists
   * with any of them. null when there is nothing to highlight (no ROIs, none
   * selected, or the grid size isn't known yet).
   */
  const roiHighlightOverlay = computed<Uint8ClampedArray | null>(() => {
    const w = ionCols.value
    const h = ionRows.value
    const rois = confirmedROIs.value
    if (!w || !h || !rois.length) return null
    const selected = rois.filter((r) => isRoiSelected(r.id))
    if (!selected.length) return null

    const rgba = new Uint8ClampedArray(w * h * 4)
    for (const roi of selected) {
      const c = hexToRgb(roi.color)
      if (!c) continue
      const mask = roi.mask
      if (!mask || !mask.length) continue
      for (let r = 0; r < h; r++) {
        const maskRow = mask[r]
        if (!maskRow) continue
        const rowOff = r * w
        for (let col = 0; col < w; col++) {
          if (!maskRow[col]) continue
          // Interior pixels (fully surrounded on all four sides) are skipped —
          // only the region's outline is painted.
          const up = r > 0 && mask[r - 1]?.[col]
          const down = r < h - 1 && mask[r + 1]?.[col]
          const left = col > 0 && maskRow[col - 1]
          const right = col < w - 1 && maskRow[col + 1]
          if (up && down && left && right) continue
          const off = (rowOff + col) * 4
          rgba[off] = c.r
          rgba[off + 1] = c.g
          rgba[off + 2] = c.b
          rgba[off + 3] = ROI_OUTLINE_ALPHA
        }
      }
    }
    return rgba
  })

  const displayMatrix = computed(() => {
    const matrix = ionMatrix.value
    const w = ionCols.value
    const h = ionRows.value
    if (!matrix || !viewingROI.value || !confirmedROIs.value.length) return matrix
    const size = w * h
    const filtered = new Float32Array(size)
    for (const roi of confirmedROIs.value) {
      const mask = roi.mask
      if (!mask || !mask.length) continue
      for (let r = 0; r < h; r++) {
        const rowOff = r * w
        for (let c = 0; c < w; c++) {
          if (mask[r]?.[c]) filtered[rowOff + c] = matrix[rowOff + c] ?? 0
        }
      }
    }
    return filtered
  })

  // Methods
  const onDraftUpdated = (draft: DraftROI) => {
    currentDraft.value = draft
  }

  const onDraftCleared = () => {
    currentDraft.value = null
  }

  const roiCancel = () => {
    roiOverlayRef.value?.clearAll()
    currentDraft.value = null
    roiSelectTool(null)
  }

  const roiConfirm = () => {
    if (!ionMatrix.value || !currentDraft.value) return
    roiConfirmDraft(ionMatrix.value, ionCols.value, ionRows.value, currentDraft.value)
    roiOverlayRef.value?.clearAll()
    currentDraft.value = null
    roiSelectTool(null)
    // Deliberately NOT enabling the "ROI only" filter here: the new ROI is
    // highlighted by default (selection null = all), which is the feedback.
    // Blacking out the rest of the image on confirm was the jarring part.
  }

  const roiClearAll = () => {
    clearAllROIs()
    currentDraft.value = null
    roiOverlayRef.value?.clearAll()
  }

  return {
    roiOverlayRef,
    roiTool,
    confirmedROIs,
    selectedRoiIds,
    isRoiSelected,
    toggleRoiSelection,
    selectAllRois,
    clearRoiSelection,
    draftReady,
    viewingROI,
    displayMatrix,
    roiUnionMask,
    roiHighlightOverlay,
    roiSelectTool: (value: string | null) => roiSelectTool(value as ROIType | null),
    roiConfirm,
    roiCancel,
    roiDelete,
    roiClearAll,
    onDraftUpdated,
    onDraftCleared,
  }
}
