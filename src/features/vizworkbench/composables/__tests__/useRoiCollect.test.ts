import { nextTick, ref, shallowRef } from 'vue'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadCoreMessages, loadFeatureMessages } from '@/i18n'
import { useResultROI } from '../useResultROI'
import { useRoiCollect } from '../useRoiCollect'

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))

// 3×2 grid. The last cell was never acquired, so the image holds 0 there like a missing ion.
const ACQUIRED = Uint8Array.of(1, 1, 1, 1, 1, 0)

function setup(values: number[]) {
  const matrix = shallowRef<Float32Array | null>(Float32Array.from(values))
  const acquired = shallowRef<Uint8Array | null>(ACQUIRED)
  const image = ref<number | 'TIC' | null>(100)
  const available = ref(true)
  const loading = ref(false)
  const state = useResultROI(matrix, ref(3), ref(2))
  const collect = useRoiCollect(state.editor, { matrix, acquired, image, available, loading })
  state.editor.selectTool('collect')
  return { ...state, collect, matrix, acquired, image, available, loading }
}

describe('ROI collect tool', () => {
  it('saves the acquired pixels with signal as a named ROI', () => {
    const { editor, collect, confirmedROIs, roiConfirm } = setup([5, 0, 2, 0, 7, 0])
    expect(editor.drawing).toBe(false)
    expect(collect.counts).toEqual({ present: 3, absent: 2, all: 5 })

    collect.stage('present')
    expect(editor.pendingCollect).toBe('present')
    expect(editor.shapeFill).toBe(true)
    expect(Array.from(editor.shapeMask!)).toEqual([1, 0, 1, 0, 1, 0])
    editor.confirmShape()
    roiConfirm()

    const [roi] = confirmedROIs.value
    expect(roi!.type).toBe('collect')
    expect(roi!.label).toBe('100.0000 Signal')
    expect(Array.from(roi!.mask)).toEqual([1, 0, 1, 0, 1, 0])
  })

  it('never collects cells that were not acquired', () => {
    const { editor, collect } = setup([0, 0, 0, 0, 0, 0])
    expect(collect.counts).toEqual({ present: 0, absent: 5, all: 5 })
    collect.stage('present')
    expect(editor.hasPendingShape).toBe(false)

    collect.stage('absent')
    expect(Array.from(editor.shapeMask!)).toEqual([1, 1, 1, 1, 1, 0])
  })

  it('collects every acquired pixel whichever image is shown', async () => {
    const { editor, collect, matrix, image, confirmedROIs, roiConfirm } = setup([5, 0, 2, 0, 7, 0])
    collect.stage('all')
    expect(editor.pendingCollect).toBe('all')
    expect(Array.from(editor.shapeMask!)).toEqual([1, 1, 1, 1, 1, 0])

    matrix.value = Float32Array.of(0, 0, 0, 0, 0, 0)
    image.value = 200
    await nextTick()
    expect(Array.from(editor.shapeMask!)).toEqual([1, 1, 1, 1, 1, 0])
    editor.confirmShape()
    roiConfirm()
    expect(confirmedROIs.value[0]).toMatchObject({ type: 'collect', label: 'All acquired' })
  })

  it('combines with drawn shapes like any other step', () => {
    const { editor, collect, confirmedROIs, roiConfirm } = setup([5, 0, 2, 0, 7, 0])
    editor.selectTool('rectangle')
    editor.stageShape({ type: 'rectangle', rect: { x0: 1, y0: 0, x1: 2, y1: 1 }, path: [] })
    editor.confirmShape()
    editor.selectOperation('intersection')
    editor.selectTool('collect')
    collect.stage('present')
    editor.confirmShape()
    expect(Array.from(editor.previewMask!)).toEqual([0, 0, 1, 0, 1, 0])

    roiConfirm()
    expect(confirmedROIs.value[0]).toMatchObject({ type: 'composite', label: 'ROI 1' })
  })

  it('follows the current image until confirmed, then keeps the collected pixels', async () => {
    const { editor, collect, matrix, image } = setup([5, 0, 2, 0, 7, 0])
    collect.stage('present')
    const color = editor.shapeColor
    matrix.value = Float32Array.of(0, 3, 0, 4, 0, 0)
    image.value = 200
    await nextTick()
    expect(Array.from(editor.shapeMask!)).toEqual([0, 1, 0, 1, 0, 0])
    expect(editor.shapeColor).toBe(color)

    editor.confirmShape()
    matrix.value = Float32Array.of(1, 1, 1, 1, 1, 0)
    await nextTick()
    expect(Array.from(editor.previewMask!)).toEqual([0, 1, 0, 1, 0, 0])
    expect(editor.label).toBe('200.0000 Signal')
  })

  it('drops a staged mask when the new image has no such pixels', async () => {
    const { editor, collect, matrix } = setup([5, 0, 2, 0, 7, 0])
    collect.stage('absent')
    matrix.value = Float32Array.of(1, 1, 1, 1, 1, 0)
    await nextTick()
    expect(editor.hasPendingShape).toBe(false)
    expect(collect.counts).toEqual({ present: 5, absent: 0, all: 5 })
  })

  it('names ion images by m/z and the TIC image of processed data as TIC', () => {
    const { editor, collect, image } = setup([5, 0, 2, 0, 7, 0])
    expect(collect.source).toBe('m/z 100.0000')
    image.value = 'TIC'
    expect(collect.source).toBe('TIC')
    collect.stage('absent')
    editor.confirmShape()
    expect(editor.label).toBe('TIC No signal')
  })

  it('waits for loading images and leaves the tool under the multi-ion overlay', async () => {
    const { editor, collect, available, loading, acquired } = setup([5, 0, 2, 0, 7, 0])
    loading.value = true
    collect.stage('present')
    expect(editor.hasPendingShape).toBe(false)

    loading.value = false
    collect.stage('present')
    expect(editor.pendingCollect).toBe('present')
    available.value = false
    await nextTick()
    expect(editor.hasPendingShape).toBe(false)
    expect(editor.tool).toBeNull()
    collect.stage('present')
    expect(editor.hasPendingShape).toBe(false)

    available.value = true
    acquired.value = null
    expect(collect.counts).toBeNull()
    collect.stage('present')
    expect(editor.hasPendingShape).toBe(false)
  })
})
