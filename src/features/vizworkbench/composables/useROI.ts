import { computed, markRaw, reactive, shallowRef, type Ref } from 'vue'
import { useRoiEditor } from './useRoiEditor'
import {
  buildRegionMask,
  type RegionGrid,
  type RoiRegion,
} from '@/features/vizworkbench/utils/region'
import { hexToRgb, roiColorAt, rgbCss } from '@/features/vizworkbench/utils/regionPalette'
import { importMask } from '@/features/vizworkbench/utils/maskExport'
import {
  compositeMask,
  summarizeRoiMask,
  type RoiStats,
  type RoiTool,
} from '@/features/vizworkbench/utils/roiMask'

export const DEFAULT_ROI_OPACITY = 0.4

/** A saved ROI. It is a region itself, so comparison, export and the editor use it directly. */
export interface ConfirmedROI extends RoiRegion {
  /** Drawing or collect tool, a multi-step draft ('composite'), or an imported mask file. */
  type: RoiTool | 'composite' | 'imported'
  pixelCount: number
  /** Intensity statistics of the image the ROI was saved on. */
  stats: RoiStats | null
}

/**
 * Saved ROIs, their selection and opacity, and the editor that drafts new ones.
 * `ionMatrix` is the unfiltered current image; ROI statistics are taken from it
 * when an ROI is saved.
 */
export function useROI(
  ionMatrix: Readonly<Ref<Float32Array | null>>,
  grid: Readonly<Ref<RegionGrid>>,
) {
  const editor = useRoiEditor(grid)
  // shallowRef: ROI masks are large arrays — deep-proxying them costs
  // significant memory/CPU. Every update below replaces the value.
  const confirmedROIs = shallowRef<ConfirmedROI[]>([])
  const roiOpacities = shallowRef<ReadonlyMap<string, number>>(new Map())
  // Selected ROI ids: null = all selected (same convention as
  // selectedKmeansIds in useOverlayData). Drives the ion-image highlight and
  // the export mask.
  const selectedRoiIds = shallowRef<Set<string> | null>(null)
  /** When true, the ion image shows only the pixels inside an ROI. */
  const viewingROI = shallowRef(false)

  let nextId = 1

  function addROI(mask: Uint8Array, type: ConfirmedROI['type'], label?: string) {
    const [height, width] = grid.value.shape
    if (!width || !height || mask.length !== width * height) return null
    const { pixelCount, stats } = summarizeRoiMask(mask, ionMatrix.value)
    if (!pixelCount) return null
    const number = nextId++
    const roi: ConfirmedROI = markRaw({
      id: `roi-${number}`,
      kind: 'roi',
      type,
      label: label ?? `ROI ${number}`,
      // ROI colors come from the shared region palette, past the slots KMeans can occupy.
      color: rgbCss(roiColorAt(number - 1)),
      grid: grid.value,
      mask: mask.slice(),
      pixelCount,
      stats,
    })
    confirmedROIs.value = [...confirmedROIs.value, roi]
    // Keep the just-saved ROI visible: with an explicit selection set, add the
    // new id so it highlights immediately (null = all already covers it).
    if (selectedRoiIds.value !== null) {
      selectedRoiIds.value = new Set(selectedRoiIds.value).add(roi.id)
    }
    return roi
  }

  function opacityOf(id: string) {
    return roiOpacities.value.get(id) ?? DEFAULT_ROI_OPACITY
  }

  /** True when the ROI participates in the highlight and the export. */
  function isRoiSelected(id: string) {
    return selectedRoiIds.value === null || selectedRoiIds.value.has(id)
  }

  /**
   * Union of every saved ROI as a 0/1 mask (row-major, 1 = inside any ROI).
   * null while the ROI-only view is off. The renderer hides every pixel outside it.
   */
  const roiUnionMask = computed(() =>
    viewingROI.value && confirmedROIs.value.length
      ? buildRegionMask(confirmedROIs.value, grid.value)
      : null,
  )

  /** Filled ROI layer in creation order. It composites independently from the base image and other overlays. */
  const roiHighlightOverlay = computed<Uint8ClampedArray | null>(() => {
    const [height, width] = grid.value.shape
    let rgba: Uint8ClampedArray | null = null
    for (const roi of confirmedROIs.value) {
      if (!isRoiSelected(roi.id)) continue
      const color = hexToRgb(roi.color)
      const alpha = Math.round(opacityOf(roi.id) * 255)
      if (!color || !alpha) continue

      if (roi.grid.shape[0] !== height || roi.grid.shape[1] !== width) continue
      rgba ??= new Uint8ClampedArray(width * height * 4)
      compositeMask(rgba, roi.mask, color, alpha)
    }
    return rgba
  })

  /** Save the editor's draft as an ROI. */
  function saveDraft() {
    const mask = editor.previewMask
    if (!editor.canSave || !mask) return
    if (addROI(mask, editor.type, editor.label)) editor.reset()
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
          expectedShape: [grid.value.shape[0], grid.value.shape[1]],
          expectedDatasetName: datasetName,
        })
        const label = file.name.replace(/\.(npz|npy|csv)$/i, '') || file.name
        if (!addROI(mask, 'imported', label))
          throw new Error('Invalid mask file: the mask selects no pixels')
        imported.push(file.name)
      } catch (err) {
        failed.push({ name: file.name, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { imported, failed }
  }

  function updateRoiOpacity(id: string, opacity: number) {
    if (!Number.isFinite(opacity) || !confirmedROIs.value.some((roi) => roi.id === id)) return
    const value = Math.max(0, Math.min(1, opacity))
    if (value === opacityOf(id)) return
    roiOpacities.value = new Map(roiOpacities.value).set(id, value)
  }

  function deleteROI(id: string) {
    if (editor.pendingRegion?.id === id) editor.discardShape()
    confirmedROIs.value = confirmedROIs.value.filter((roi) => roi.id !== id)
    if (roiOpacities.value.has(id)) {
      const next = new Map(roiOpacities.value)
      next.delete(id)
      roiOpacities.value = next
    }
    // Counts filter confirmedROIs (never Set.size), so a stale id would be
    // harmless, but keeping the set honest avoids the trap for future callers.
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
    viewingROI.value = false
    nextId = 1
    editor.reset()
  }

  // ---- Selection (mirrors toggleKmeansCluster / selectAll / clearAll) ----

  function toggleRoiSelection(id: string) {
    const next = new Set(selectedRoiIds.value ?? confirmedROIs.value.map((roi) => roi.id))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedRoiIds.value = next
  }

  function selectAllRois() {
    selectedRoiIds.value = null
  }

  function clearRoiSelection() {
    selectedRoiIds.value = new Set()
  }

  function toggleViewingROI() {
    viewingROI.value = !viewingROI.value
  }

  return reactive({
    editor,
    confirmedROIs,
    roiOpacities,
    selectedRoiIds,
    viewingROI,
    roiUnionMask,
    roiHighlightOverlay,
    opacityOf,
    isRoiSelected,
    toggleRoiSelection,
    selectAllRois,
    clearRoiSelection,
    toggleViewingROI,
    updateRoiOpacity,
    saveDraft,
    importRois,
    deleteROI,
    clearAllROIs,
  })
}

export type RoiState = ReturnType<typeof useROI>
