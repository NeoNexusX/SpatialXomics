/**
 * Imported-mask composable.
 *
 * File-imported masks are kept separate from drawn ROIs and KMeans clusters:
 * importing never mutates the user's ROI/cluster state. Any number of masks
 * can coexist; each carries an `active` flag, and the effective display
 * filter is the UNION of all active masks (a pixel survives when at least
 * one active mask covers it). Every mask also doubles as a comparison
 * region — useRegionComparison lists them next to ROIs and clusters.
 *
 * Masks are large flat arrays, so the list is a shallowRef updated
 * replace-style (same convention as confirmedROIs in useROI).
 */

import { computed, markRaw, shallowRef, type Ref } from 'vue'
import {
  importMask,
  summarizeImportedMask,
  type ImportedMaskSummary,
  type MaskImportFormat,
} from '@/features/vizworkbench/utils/maskExport'
import { rgbCss, roiColorAt } from '@/features/vizworkbench/utils/regionPalette'

/** One file-imported mask. */
export interface ImportedMask {
  /** Stable id (`import-1`, …) — the comparison selectors key off it. */
  id: string
  /** 源文件名（用户认得的标识） */
  name: string
  format: MaskImportFormat
  /** Flat row-major 0/1 pixels — same indexing as the comparison rasters. */
  mask: Uint8Array<ArrayBuffer>
  /** name/format/统计，导入时定格（与手绘 ROI confirm 同口径，不随后续 m/z 切换重算） */
  summary: ImportedMaskSummary
  /** 过滤是否生效：false = 暂停该掩膜的过滤（导入保留，可随时重新应用） */
  active: boolean
  /** 身份色：共享 region palette 的 ROI 区块，ROI/比较/预览各处保持一致 */
  color: string
}

/** Per-file outcome of a multi-file import. */
export interface ImportedMaskFailure {
  name: string
  error: string
}

export function useImportedMasks(
  // Arguments
  deps: {
    ionCols: Ref<number>
    ionRows: Ref<number>
    /** Reject provenance from another dataset; empty provenance is accepted. */
    datasetName: Ref<string>
    /** 用于导入时定格统计的当前矩阵 */
    matrix: Ref<Float32Array | null>
  },
) {
  // State
  const importedMasks = shallowRef<ImportedMask[]>([])
  let nextId = 1
  // Mask colors share the palette's non-cluster block with ROIs (30 slots).
  // Cross-kind collisions are possible but rare and harmless — both kinds are
  // visually distinguished (masks render with dashed borders), while the
  // counter never rewinds so a mask keeps its color for its whole lifetime.
  let nextColorIdx = 0

  // Methods

  /** Parse + validate one file and append it. Throws on invalid files. */
  async function importOne(file: File): Promise<ImportedMask> {
    const result = await importMask(file, {
      expectedShape: [deps.ionRows.value, deps.ionCols.value],
      expectedDatasetName: deps.datasetName.value,
    })
    const entry: ImportedMask = markRaw({
      id: `import-${nextId++}`,
      name: file.name,
      format: result.format,
      mask: result.mask,
      summary: summarizeImportedMask(result, file.name, deps.matrix.value),
      active: true,
      color: rgbCss(roiColorAt(nextColorIdx++)),
    })
    importedMasks.value = [...importedMasks.value, entry]
    return entry
  }

  /**
   * Import many files. Each file is imported independently so a single bad
   * file never blocks the rest; failures are reported per file.
   */
  async function importMaskFiles(files: File[]): Promise<{
    imported: string[]
    failed: ImportedMaskFailure[]
  }> {
    const imported: string[] = []
    const failed: ImportedMaskFailure[] = []
    for (const file of files) {
      try {
        await importOne(file)
        imported.push(file.name)
      } catch (err) {
        failed.push({
          name: file.name,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { imported, failed }
  }

  function removeImportedMask(id: string) {
    importedMasks.value = importedMasks.value.filter((m) => m.id !== id)
  }

  function clearImportedMasks() {
    importedMasks.value = []
  }

  function toggleImportedMask(id: string) {
    importedMasks.value = importedMasks.value.map((m) =>
      m.id === id ? { ...m, active: !m.active } : m,
    )
  }

  // Computed

  /**
   * Union (OR) of every ACTIVE mask — the effective display filter. null when
   * no mask is active (full image shown). Sizes are re-checked per mask since
   * every import was validated against the then-current image dims.
   */
  const activeUnionMask = computed<Uint8Array | null>(() => {
    const active = importedMasks.value.filter((m) => m.active)
    const w = deps.ionCols.value
    const h = deps.ionRows.value
    if (!active.length || !w || !h) return null
    const size = w * h
    const union = new Uint8Array(size)
    for (const m of active) {
      if (m.mask.length !== size) continue
      const r = m.mask
      for (let i = 0; i < size; i++) {
        if (r[i]) union[i] = 1
      }
    }
    return union
  })

  return {
    // State
    importedMasks,
    activeUnionMask,
    // Actions
    importMaskFiles,
    removeImportedMask,
    clearImportedMasks,
    toggleImportedMask,
  }
}
