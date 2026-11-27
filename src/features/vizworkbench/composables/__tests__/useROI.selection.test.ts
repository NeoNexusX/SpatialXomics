import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useROI } from '../useROI'
import type { RegionGrid } from '@/features/vizworkbench/utils/region'
import type { DraftROI } from '@/features/vizworkbench/utils/roiMask'

const rect = (x0: number, y0: number, x1: number, y1: number): DraftROI => ({
  type: 'rectangle',
  rect: { x0, y0, x1, y1 },
  path: [],
})

function setup(w = 4, h = 4) {
  const matrix = ref(new Float32Array(w * h).fill(1))
  const roi = useROI(matrix, ref<RegionGrid>({ runId: '', shape: [h, w] }))
  const add = (d: DraftROI) => {
    roi.editor.stageShape(d)
    roi.editor.confirmShape()
    roi.saveDraft()
    return roi.confirmedROIs[roi.confirmedROIs.length - 1]!
  }
  return { roi, add }
}

describe('useROI selection', () => {
  it('defaults to all-selected (null) and a new ROI is selected', () => {
    const { roi, add } = setup()
    expect(roi.selectedRoiIds).toBeNull()
    const a = add(rect(0, 0, 1, 1))
    expect(roi.isRoiSelected(a.id)).toBe(true)
  })

  it('toggles a ROI off and back on', () => {
    const { roi, add } = setup()
    const a = add(rect(0, 0, 1, 1))
    const b = add(rect(2, 2, 3, 3))

    roi.toggleRoiSelection(a.id)
    expect(roi.isRoiSelected(a.id)).toBe(false)
    expect(roi.isRoiSelected(b.id)).toBe(true)

    roi.toggleRoiSelection(a.id)
    expect(roi.isRoiSelected(a.id)).toBe(true)
  })

  it('keeps a newly confirmed ROI selected even after an explicit deselect-all', () => {
    const { roi, add } = setup()
    add(rect(0, 0, 1, 1))
    roi.clearRoiSelection()

    const b = add(rect(2, 2, 3, 3))
    // saving re-adds the new id so the just-drawn ROI is always visible
    expect(roi.isRoiSelected(b.id)).toBe(true)
  })

  it('drops a deleted ROI id from the selection set', () => {
    const { roi, add } = setup()
    const a = add(rect(0, 0, 1, 1))
    const b = add(rect(2, 2, 3, 3))

    roi.toggleRoiSelection(a.id) // explicit set { b }
    expect(roi.selectedRoiIds!.has(b.id)).toBe(true)

    roi.deleteROI(b.id)
    expect(roi.selectedRoiIds!.has(b.id)).toBe(false)
  })

  it('resets the selection to null on clearAll', () => {
    const { roi, add } = setup()
    add(rect(0, 0, 1, 1))
    roi.clearRoiSelection()
    expect(roi.selectedRoiIds).not.toBeNull()

    roi.clearAllROIs()
    expect(roi.selectedRoiIds).toBeNull()
    expect(roi.confirmedROIs).toHaveLength(0)
  })
})
