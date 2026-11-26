import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useResultROI } from '../useResultROI'
import { DEFAULT_ROI_OPACITY, type DraftROI } from '../useROI'
import { hexToRgb } from '@/features/vizworkbench/utils/regionPalette'

const rect = (x0: number, y0: number, x1: number, y1: number): DraftROI => ({
  type: 'rectangle',
  rect: { x0, y0, x1, y1 },
  path: [],
})

function setup(w = 4, h = 4) {
  const matrix = ref<Float32Array | null>(new Float32Array(w * h).fill(2))
  const roi = useResultROI(matrix, ref(w), ref(h))
  const draw = (d: DraftROI) => {
    roi.editor.selectTool('rectangle')
    roi.editor.stageShape(d)
    roi.editor.confirmShape()
    roi.roiConfirm()
  }
  return { roi, matrix, draw }
}

describe('useResultROI fill and filtering', () => {
  it('fills a confirmed ROI without enabling the ROI-only filter', () => {
    const { roi, matrix, draw } = setup()
    expect(roi.roiHighlightOverlay.value).toBeNull()

    draw(rect(0, 0, 2, 2))

    expect(roi.viewingROI.value).toBe(false)
    expect(roi.roiUnionMask.value).toBeNull()
    expect(roi.displayMatrix.value).toBe(matrix.value)

    const color = hexToRgb(roi.confirmedROIs.value[0]!.color)!
    const highlight = roi.roiHighlightOverlay.value!
    const filled = [color.r, color.g, color.b, Math.round(DEFAULT_ROI_OPACITY * 255)]
    expect([...highlight.slice(0, 4)]).toEqual(filled)
    expect([...highlight.slice(20, 24)]).toEqual(filled) // interior of the 3x3 ROI
    expect([...highlight.slice(12, 16)]).toEqual([0, 0, 0, 0])
  })

  it('keeps a hole transparent and applies opacity independently of the filtering mask', () => {
    const { roi, draw } = setup()
    roi.editor.stageShape(rect(0, 0, 3, 3))
    roi.editor.confirmShape()
    roi.editor.selectOperation('difference')
    roi.editor.stageShape(rect(1, 1, 1, 1))
    roi.editor.confirmShape()
    roi.roiConfirm()

    const [first] = roi.confirmedROIs.value
    roi.viewingROI.value = true
    const union = roi.roiUnionMask.value
    const display = roi.displayMatrix.value
    roi.updateRoiOpacity(first!.id, 0.5)
    const highlight = roi.roiHighlightOverlay.value!
    expect(highlight[3]).toBe(128)
    expect(highlight[23]).toBe(0)

    roi.updateRoiOpacity(first!.id, 0)
    expect(roi.roiHighlightOverlay.value).toBeNull()
    expect(roi.roiUnionMask.value).toBe(union)
    expect(roi.displayMatrix.value).toBe(display)
    expect(roi.selectedRoiIds.value).toBeNull()
    expect(first!.mask[5]).toBe(0)

    roi.roiClearAll()
    draw(rect(1, 1, 2, 2))
    expect(roi.roiOpacities.value.size).toBe(0)
  })

  it('reuses the ROI union when the displayed ion changes', () => {
    const { roi, matrix, draw } = setup(4, 1)
    draw(rect(0, 0, 1, 0))
    draw(rect(3, 0, 3, 0))
    roi.viewingROI.value = true
    const mask = roi.roiUnionMask.value
    expect([...roi.displayMatrix.value!]).toEqual([2, 2, 0, 2])
    matrix.value = new Float32Array([1, 2, 3, 4])
    expect(roi.roiUnionMask.value).toBe(mask)
    expect([...roi.displayMatrix.value!]).toEqual([1, 2, 0, 4])
  })

  it('keeps the saved area when a selected pixel lacks finite intensity', () => {
    const { roi, matrix, draw } = setup(4, 1)
    matrix.value = new Float32Array([NaN, 2, Infinity, 6])
    draw(rect(0, 0, 3, 0))
    const saved = roi.confirmedROIs.value[0]!
    expect(saved.pixelCount).toBe(4)
    expect(saved.stats).toEqual({ pixelCount: 2, mean: 4, std: 2, min: 2, max: 6, sum: 8 })
    draw(rect(0, 0, 0, 0))
    expect(roi.confirmedROIs.value[1]).toMatchObject({ pixelCount: 1, stats: null })
  })

  it('blends overlapping ROIs and only changes the requested layer', () => {
    const { roi, draw } = setup()
    draw(rect(0, 0, 1, 1))
    draw(rect(1, 1, 2, 2))
    const [first, second] = roi.confirmedROIs.value
    roi.updateRoiOpacity(first!.id, 1)
    roi.updateRoiOpacity(second!.id, 0.5)

    const a = hexToRgb(first!.color)!
    const b = hexToRgb(second!.color)!
    const overlap = roi.roiHighlightOverlay.value!
    expect([...overlap.slice(0, 4)]).toEqual([a.r, a.g, a.b, 255])
    expect([...overlap.slice(40, 44)]).toEqual([b.r, b.g, b.b, 128])
    expect([...overlap.slice(20, 24)]).toEqual([
      ...(['r', 'g', 'b'] as const).map((key) => Math.round((a[key] * 127 + b[key] * 128) / 255)),
      255,
    ])

    roi.updateRoiOpacity(second!.id, 0)
    expect([...roi.roiHighlightOverlay.value!.slice(20, 24)]).toEqual([a.r, a.g, a.b, 255])
    expect(roi.roiHighlightOverlay.value![43]).toBe(0)
  })

  it('drops the highlight when the ROI is deselected', () => {
    const { roi, draw } = setup()
    draw(rect(0, 0, 1, 1))

    const id = roi.confirmedROIs.value[0]!.id
    roi.toggleRoiSelection(id)

    expect(roi.roiHighlightOverlay.value).toBeNull()
  })
})
