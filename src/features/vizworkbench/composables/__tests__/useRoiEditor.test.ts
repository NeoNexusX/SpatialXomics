import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useROI } from '../useROI'
import type { RoiEditor } from '../useRoiEditor'
import type { RegionGrid } from '@/features/vizworkbench/utils/region'
import { ROI_SHAPE_COLORS } from '@/features/vizworkbench/utils/regionPalette'
import type { DraftROI, ROIType } from '@/features/vizworkbench/utils/roiMask'

function box(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  type: ROIType = 'rectangle',
): DraftROI {
  return { type, rect: { x0, y0, x1, y1 }, path: [] }
}

function addShape(editor: RoiEditor, shape: DraftROI) {
  editor.stageShape(shape)
  editor.confirmShape()
}

// 12 columns × 10 rows
function setup() {
  const grid = ref<RegionGrid>({ runId: '', shape: [10, 12] })
  const state = useROI(ref(new Float32Array(12 * 10).fill(2)), grid)
  const pixel = (x: number, y: number) => state.editor.previewMask?.[y * 12 + x]
  return { state, editor: state.editor, pixel }
}

describe('ROI editor', () => {
  it('intersects each confirmed shape with the current draft and saves the preview', () => {
    const { state, editor, pixel } = setup()
    addShape(editor, box(0, 0, 4, 9))
    addShape(editor, box(7, 0, 11, 9))
    editor.selectOperation('intersection')
    addShape(editor, box(2, 1, 8, 5))
    editor.stageShape(box(3, 3, 9, 7))
    editor.stageShape(box(0, 0, 11, 9))
    expect(editor.canSave).toBe(false)
    expect(editor.previewCount).toBe(25)
    editor.confirmShape()

    expect(editor.previewCount).toBe(12)
    expect(pixel(3, 3)).toBe(1)
    expect(pixel(7, 5)).toBe(1)
    expect(pixel(3, 2)).toBe(0)
    expect(pixel(7, 7)).toBe(0)
    expect(pixel(5, 3)).toBe(0)
    expect(editor.canSave).toBe(true)

    editor.undo()
    expect(editor.previewCount).toBe(25)
    editor.undo()
    expect(editor.previewCount).toBe(100)
    editor.redo()
    editor.redo()
    expect(editor.previewCount).toBe(12)

    const preview = [...editor.previewMask!]
    state.saveDraft()
    const [roi] = state.confirmedROIs
    expect(Array.from(roi!.mask)).toEqual(preview)
    expect(roi!.pixelCount).toBe(12)
    expect(roi!.type).toBe('composite')
  })

  it.each(['difference', 'intersection'] as const)(
    'starts a usable draft after undoing the base in %s mode',
    (mode) => {
      const { editor } = setup()
      addShape(editor, box(0, 0, 2, 2))
      editor.selectOperation(mode)
      editor.undo()
      expect(editor.operation).toBe('union')
      addShape(editor, box(4, 4, 5, 5))
      expect(editor.previewCount).toBe(4)
      expect(editor.canRedo).toBe(false)
    },
  )

  it('clears the old redo branch when confirming an intersection', () => {
    const { editor } = setup()
    addShape(editor, box(0, 0, 3, 3))
    addShape(editor, box(8, 8, 9, 9))
    editor.undo()
    editor.selectOperation('intersection')
    addShape(editor, box(2, 2, 9, 9))
    expect(editor.canRedo).toBe(false)
    editor.redo()
    expect(editor.previewCount).toBe(4)
    editor.undo()
    expect(editor.previewCount).toBe(16)
    editor.redo()
    expect(editor.previewCount).toBe(4)
    editor.undo()
    editor.selectOperation('union')
    editor.redo()
    expect(editor.previewCount).toBe(4)
    expect(editor.canRedo).toBe(false)
  })

  it('subtracts an ellipse, then adds back a disconnected island', () => {
    const { editor, pixel } = setup()
    addShape(editor, box(0, 0, 10, 9))
    editor.selectOperation('difference')
    addShape(editor, box(2, 2, 8, 8, 'ellipse'))
    expect(pixel(5, 5)).toBe(0)
    expect(pixel(0, 0)).toBe(1)

    editor.selectOperation('union')
    addShape(editor, box(5, 5, 5, 5))
    expect(pixel(5, 5)).toBe(1)
    expect(pixel(5, 6)).toBe(0)
  })

  it('keeps an open path when paused and undoes or redoes a whole pointer segment', () => {
    const { editor } = setup()
    editor.selectTool('freehand')
    editor.addSegment([
      { x: 1, y: 1 },
      { x: 5, y: 1 },
    ])
    editor.selectTool(null)
    editor.selectTool('freehand')
    editor.addSegment([
      { x: 5, y: 5 },
      { x: 1, y: 5 },
    ])
    expect(editor.canSave).toBe(false)
    editor.undo()
    expect(editor.path).toHaveLength(2)
    editor.redo()
    editor.closePath()
    expect(editor.hasPendingShape).toBe(true)
    expect(editor.canClosePath).toBe(false)
    expect(editor.canSave).toBe(false)
    expect(editor.previewCount).toBe(0)
    editor.confirmShape()
    expect(editor.previewCount).toBe(16)
    expect(editor.canSave).toBe(true)
  })

  it('keeps Add selected across tool switches and keeps an open path available to resume', () => {
    const { editor } = setup()
    expect(editor.operation).toBe('union')
    editor.selectTool('freehand')
    editor.addSegment([
      { x: 1, y: 1 },
      { x: 4, y: 1 },
    ])

    editor.selectTool('rectangle')
    editor.stageShape(box(7, 1, 8, 2))
    editor.discardShape()
    expect(editor.path).toHaveLength(2)
    addShape(editor, box(7, 1, 8, 2))
    expect(editor.operation).toBe('union')
    expect(editor.path).toHaveLength(2)
    expect(editor.previewCount).toBe(4)

    editor.selectTool('freehand')
    editor.addSegment([
      { x: 4, y: 4 },
      { x: 1, y: 4 },
    ])
    editor.closePath()
    editor.confirmShape()
    expect(editor.previewCount).toBe(13)
  })

  it('retains the current preview when switching operations and saves the intersection directly', () => {
    const { state, editor } = setup()
    editor.selectTool('rectangle')
    addShape(editor, box(0, 0, 4, 4))

    editor.selectOperation('difference')
    expect(editor.tool).toBe('rectangle')
    addShape(editor, box(1, 1, 2, 2))
    expect(editor.previewCount).toBe(21)

    editor.selectOperation('intersection')
    expect(editor.previewCount).toBe(21)
    addShape(editor, box(0, 0, 2, 2))
    expect(editor.previewCount).toBe(5)

    state.saveDraft()
    expect(state.confirmedROIs[0]?.pixelCount).toBe(5)
    expect(editor.operation).toBe('union')
  })

  it('shows an empty intersection and restores the draft on undo', () => {
    const { editor } = setup()
    addShape(editor, box(0, 0, 2, 2))
    editor.selectOperation('intersection')
    addShape(editor, box(7, 7, 9, 9))
    expect(editor.previewCount).toBe(0)
    addShape(editor, box(0, 0, 2, 2))
    expect(editor.canSave).toBe(false)
    editor.undo()
    expect(editor.previewCount).toBe(0)
    editor.undo()
    expect(editor.previewCount).toBe(9)
  })

  it('uses a saved ROI as an intersection source without modifying the source', () => {
    const { state, editor } = setup()
    addShape(editor, box(1, 1, 3, 3))
    state.saveDraft()
    const [saved] = state.confirmedROIs

    addShape(editor, box(2, 2, 5, 5))
    editor.selectOperation('intersection')
    addShape(editor, box(3, 2, 5, 5))
    editor.stageRegion(saved!)
    expect(editor.pendingRegion?.id).toBe(saved!.id)
    expect(editor.previewCount).toBe(12)
    expect(editor.canSave).toBe(false)
    expect(editor.editableBox).toBeNull()
    editor.confirmShape()
    expect(editor.previewCount).toBe(2)
    expect(saved!.mask[13]).toBe(1)
    editor.undo()
    expect(editor.previewCount).toBe(12)
    editor.stageRegion(saved!)
    state.deleteROI(saved!.id)
    expect(editor.pendingRegion).toBeNull()
    editor.confirmShape()
    expect(editor.previewCount).toBe(12)
  })

  it('undoes each add or subtract independently after switching operations', () => {
    const { editor, pixel } = setup()
    addShape(editor, box(0, 0, 3, 3))
    addShape(editor, box(8, 0, 10, 2))
    editor.selectOperation('difference')
    addShape(editor, box(1, 1, 1, 1))
    addShape(editor, box(8, 1, 8, 1))
    expect(editor.previewCount).toBe(23)

    editor.selectOperation('union')
    editor.undo()
    expect(pixel(8, 1)).toBe(1)
    expect(pixel(1, 1)).toBe(0)
    editor.undo()
    expect(editor.previewCount).toBe(25)
    editor.redo()
    expect(editor.previewCount).toBe(24)
  })

  it('closes a straight-segment contour with its original type across tool switches', () => {
    const { state, editor } = setup()
    editor.selectTool('polygon')
    for (const point of [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 4 },
      { x: 1, y: 4 },
    ]) {
      editor.addSegment([point])
    }

    editor.selectTool('freehand')
    expect(editor.tool).toBe('polygon')
    editor.selectTool('ellipse')
    expect(editor.openPathType).toBe('polygon')
    editor.closePath()
    editor.confirmShape()

    expect(editor.previewCount).toBe(9)
    state.saveDraft()
    expect(state.confirmedROIs[0]?.type).toBe('polygon')
  })

  it('reports the active gesture color, then the latest stroke instead of the next color', () => {
    const { editor } = setup()
    editor.selectTool('rectangle')
    expect(editor.currentColor).toBeNull()

    const firstColor = editor.nextColor
    editor.setGestureColor(firstColor)
    expect(editor.currentColor).toBe(firstColor)
    addShape(editor, box(0, 0, 1, 1))
    editor.setGestureColor(null)
    editor.selectTool(null)
    expect(editor.currentColor).toBe(firstColor)
    expect(editor.currentColor).not.toBe(editor.nextColor)

    editor.reset()
    expect(editor.currentColor).toBeNull()
  })

  it('rotates colors between shapes and keeps their colors through adjustment and undo', () => {
    const { editor } = setup()
    editor.selectTool('rectangle')
    const firstColor = editor.nextColor
    editor.stageShape(box(0, 0, 1, 1))
    expect(editor.shapeColor).toBe(firstColor)
    const secondColor = editor.nextColor
    expect(secondColor).not.toBe(firstColor)
    editor.replaceBox(box(0, 0, 1, 2))
    expect(editor.shapeColor).toBe(firstColor)
    expect(editor.nextColor).toBe(secondColor)
    expect(editor.previewCount).toBe(0)
    editor.confirmShape()
    expect(editor.latestColor).toBe(firstColor)
    expect(editor.previewCount).toBe(6)

    addShape(editor, box(4, 4, 5, 5))
    expect(editor.latestColor).toBe(secondColor)
    expect(editor.shapeMask?.reduce((sum, value) => sum + value, 0)).toBe(4)
    editor.undo()
    expect(editor.latestColor).toBe(firstColor)
    editor.redo()
    expect(editor.latestColor).toBe(secondColor)
  })

  it('keeps a paused outline color distinct from shapes added before it closes', () => {
    const { editor } = setup()
    editor.selectTool('polygon')
    editor.addSegment([{ x: 1, y: 1 }])
    const outlineColor = editor.contourColor
    editor.selectTool('rectangle')

    for (const _ of ROI_SHAPE_COLORS) {
      expect(editor.nextColor).not.toBe(outlineColor)
      expect(editor.nextColor).not.toBe(editor.latestColor)
      addShape(editor, box(7, 7, 8, 8))
    }

    editor.selectTool('polygon')
    editor.addSegment([{ x: 3, y: 1 }])
    editor.addSegment([{ x: 3, y: 3 }])
    editor.closePath()
    editor.confirmShape()
    expect(editor.latestColor).toBe(outlineColor)
    expect(editor.nextColor).not.toBe(outlineColor)
  })

  it('changes the closing shape color if undo exposed the same color', () => {
    const { editor } = setup()
    editor.selectTool('rectangle')
    for (const _ of ROI_SHAPE_COLORS) addShape(editor, box(7, 7, 8, 8))
    editor.selectTool('polygon')
    editor.addSegment([{ x: 1, y: 1 }])
    const reservedColor = editor.contourColor
    editor.selectTool('rectangle')
    for (let i = 1; i < ROI_SHAPE_COLORS.length; i++) editor.undo()
    expect(editor.latestColor).toBe(reservedColor)

    editor.selectTool('polygon')
    editor.addSegment([{ x: 3, y: 1 }])
    editor.addSegment([{ x: 3, y: 3 }])
    editor.closePath()
    editor.confirmShape()
    expect(editor.latestColor).not.toBe(reservedColor)
  })

  it('discards just the pending shape and keeps mode and history locked until it is resolved', () => {
    const { state, editor } = setup()
    addShape(editor, box(0, 0, 3, 3))
    editor.selectOperation('difference')
    editor.stageShape(box(1, 1, 2, 2))
    editor.stageShape(box(2, 2, 3, 3))
    editor.selectOperation('union')
    editor.undo()
    state.saveDraft()

    expect(editor.operation).toBe('difference')
    expect(editor.previewCount).toBe(16)
    expect(editor.shapeMask?.[1 * 12 + 1]).toBe(1)
    expect(state.confirmedROIs).toHaveLength(0)

    editor.discardShape()
    expect(editor.hasPendingShape).toBe(false)
    expect(editor.previewCount).toBe(16)
    expect(editor.canSave).toBe(true)
  })
})
