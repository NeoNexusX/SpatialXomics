import { computed, ref, watch, type Ref } from 'vue'
import { DEFAULT_ROI_OPACITY, useROI } from '@/features/vizworkbench/composables/useROI'
import { useRoiEditor } from './useRoiEditor'
import { hexToRgb } from '@/features/vizworkbench/utils/regionPalette'
import { importMask } from '@/features/vizworkbench/utils/maskExport'

export function useResultROI(
  ionMatrix: Ref<Float32Array | null>,
  ionCols: Ref<number>,
  ionRows: Ref<number>,
  runId = ref(''),
) {
  const {
    confirmedROIs,
    roiOpacities,
    updateRoiOpacity,
    selectedRoiIds,
    isRoiSelected,
    toggleRoiSelection,
    selectAllRois,
    clearRoiSelection,
    confirmMask,
    deleteROI,
    clearAllROIs,
  } = useROI()

  const editor = useRoiEditor(ionCols, ionRows, runId)
  const viewingROI = ref(false)

  watch([ionCols, ionRows], editor.reset)

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
      if (roi.shape[0] !== h || roi.shape[1] !== w) continue
      for (let i = 0; i < mask.length; i++) {
        if (roi.mask[i]) mask[i] = 1
      }
    }
    return mask
  })

  /** Filled ROI layer in creation order. It composites independently from the base image and other overlays. */
  const roiHighlightOverlay = computed<Uint8ClampedArray | null>(() => {
    const w = ionCols.value
    const h = ionRows.value
    if (!w || !h) return null

    let rgba: Uint8ClampedArray | null = null
    for (const roi of confirmedROIs.value) {
      if (!isRoiSelected(roi.id)) continue
      const color = hexToRgb(roi.color)
      const alpha = Math.round((roiOpacities.value.get(roi.id) ?? DEFAULT_ROI_OPACITY) * 255)
      if (!color || !alpha) continue

      if (roi.shape[0] !== h || roi.shape[1] !== w) continue
      rgba ??= new Uint8ClampedArray(w * h * 4)
      const remaining = 1 - alpha / 255
      for (let i = 0; i < roi.mask.length; i++) {
        if (!roi.mask[i]) continue
        const off = i * 4
        const previousAlpha = rgba[off + 3]! * remaining
        const combinedAlpha = alpha + previousAlpha
        // Source-over in straight RGBA, as expected by ImageData.
        const weight = previousAlpha / combinedAlpha
        rgba[off] = color.r + (rgba[off]! - color.r) * weight
        rgba[off + 1] = color.g + (rgba[off + 1]! - color.g) * weight
        rgba[off + 2] = color.b + (rgba[off + 2]! - color.b) * weight
        rgba[off + 3] = combinedAlpha
      }
    }
    return rgba
  })

  const displayMatrix = computed(() => {
    const matrix = ionMatrix.value
    const mask = roiUnionMask.value
    if (!matrix || !mask) return matrix
    const filtered = new Float32Array(mask.length)
    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) filtered[i] = matrix[i] ?? 0
    }
    return filtered
  })

  function roiConfirm() {
    const matrix = ionMatrix.value
    const mask = editor.previewMask
    if (!matrix || !editor.canSave || !mask) return
    if (confirmMask(matrix, ionCols.value, ionRows.value, mask, editor.type, editor.label)) {
      editor.reset()
    }
  }

  /**
   * Add mask files exported by this app as ROIs named after the file. Each file
   * is independent: a bad one is reported without blocking the rest.
   */
  async function importRois(files: File[], datasetName: string) {
    const imported: string[] = []
    const failed: { name: string; error: string }[] = []
    for (const file of files) {
      try {
        const { mask } = await importMask(file, {
          expectedShape: [ionRows.value, ionCols.value],
          expectedDatasetName: datasetName,
        })
        const label = file.name.replace(/\.(npz|npy|csv)$/i, '') || file.name
        if (!confirmMask(ionMatrix.value, ionCols.value, ionRows.value, mask, 'imported', label))
          throw new Error('Invalid mask file: the mask selects no pixels')
        imported.push(file.name)
      } catch (err) {
        failed.push({ name: file.name, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { imported, failed }
  }

  function roiClearAll() {
    clearAllROIs()
    editor.reset()
    viewingROI.value = false
  }

  function roiDelete(id: string) {
    if (`roi:${id}` === editor.pendingRegion?.id) editor.discardShape()
    deleteROI(id)
  }

  return {
    editor,
    confirmedROIs,
    roiOpacities,
    updateRoiOpacity,
    selectedRoiIds,
    toggleRoiSelection,
    selectAllRois,
    clearRoiSelection,
    viewingROI,
    displayMatrix,
    roiUnionMask,
    roiHighlightOverlay,
    roiConfirm,
    importRois,
    roiDelete,
    roiClearAll,
  }
}
