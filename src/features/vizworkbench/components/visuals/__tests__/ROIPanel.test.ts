import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { nextTick, ref, type Ref } from 'vue'
import { useROI, type RoiState } from '@/features/vizworkbench/composables/useROI'
import { useRoiCollect } from '@/features/vizworkbench/composables/useRoiCollect'
import type { RoiEditor } from '@/features/vizworkbench/composables/useRoiEditor'
import type { Region, RegionGrid } from '@/features/vizworkbench/utils/region'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import ROIPanel from '../ROIPanel.vue'

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))
enableAutoUnmount(afterEach)

/** ROI state on a `width` × 1 grid. */
function roiState(matrix: Readonly<Ref<Float32Array | null>>, width: number) {
  return useROI(matrix, ref<RegionGrid>({ runId: '', shape: [1, width] }))
}

function collectFrom(
  editor: RoiEditor,
  matrix: Ref<Float32Array | null>,
  acquired: Uint8Array | null,
  available = true,
) {
  return useRoiCollect(editor, {
    matrix,
    acquired: ref(acquired),
    image: ref(100),
    available: ref(available),
    loading: ref(false),
  })
}

function mountPanel(state: RoiState, collect = collectFrom(state.editor, ref(null), null)) {
  const panel = mount(ROIPanel, {
    props: { state, collect, regions: [...state.confirmedROIs] },
    global: { plugins: [i18n] },
  })
  const button = (label: string) => panel.findAll('button').find((item) => item.text() === label)!
  return { panel, button }
}

function stageRectangle(editor: RoiEditor, x0: number, x1: number) {
  editor.stageShape({ type: 'rectangle', rect: { x0, x1, y0: 0, y1: 0 }, path: [] })
}

it('clears saved ROIs and the draft only after confirming Clear all', async () => {
  const state = roiState(ref(new Float32Array([1, 2])), 2)
  stageRectangle(state.editor, 0, 0)
  state.editor.confirmShape()
  state.saveDraft()
  stageRectangle(state.editor, 1, 1)
  state.editor.confirmShape()

  const { panel, button } = mountPanel(state)
  const clear = button('Clear all')
  await clear.trigger('click')
  const dialog = panel.getComponent(ConfirmDialog)
  expect(dialog.text()).toContain('Clear all ROIs?')

  await dialog.get('.modal-action button').trigger('click')
  expect(panel.findComponent(ConfirmDialog).exists()).toBe(false)
  expect(state.confirmedROIs).toHaveLength(1)
  expect(state.editor.previewCount).toBe(1)

  await clear.trigger('click')
  await panel.getComponent(ConfirmDialog).get('.modal-action .btn-error').trigger('click')
  expect(panel.findComponent(ConfirmDialog).exists()).toBe(false)
  expect(state.confirmedROIs).toHaveLength(0)
  expect(state.editor.hasDraft).toBe(false)
})

it('intersects each confirmed shape without switching modes before saving', async () => {
  const state = roiState(ref(new Float32Array(4).fill(1)), 4)
  const { editor } = state
  stageRectangle(editor, 0, 3)
  editor.confirmShape()
  const { button } = mountPanel(state)
  await button('Intersect').trigger('click')

  stageRectangle(editor, 0, 1)
  await nextTick()
  await button('Confirm shape').trigger('click')
  expect(editor.previewCount).toBe(2)
  expect(button('Save ROI').attributes('disabled')).toBeUndefined()

  stageRectangle(editor, 1, 2)
  await nextTick()
  await button('Confirm shape').trigger('click')
  expect(editor.previewCount).toBe(1)
  await button('Save ROI').trigger('click')
  expect(Array.from(state.confirmedROIs[0]!.mask)).toEqual([0, 1, 0, 0])
})

it('previews a saved ROI and subtracts it only on confirmation', async () => {
  const state = roiState(ref(new Float32Array(4).fill(1)), 4)
  const { editor } = state
  stageRectangle(editor, 0, 1)
  editor.confirmShape()
  state.saveDraft()
  const saved = state.confirmedROIs[0]!

  stageRectangle(editor, 1, 3)
  editor.confirmShape()
  const { panel, button } = mountPanel(state)
  await button('Subtract').trigger('click')
  const select = panel.get<HTMLSelectElement>('select[aria-label="Use an existing region"]')
  await select.setValue(saved.id)
  expect(select.element.value).toBe(saved.id)
  expect(Array.from(editor.shapeMask!)).toEqual([1, 1, 0, 0])
  expect(Array.from(editor.previewMask!)).toEqual([0, 1, 1, 1])
  expect(button('Save ROI').attributes('disabled')).toBeDefined()

  await button('Discard shape').trigger('click')
  expect(select.element.value).toBe('')
  expect(Array.from(editor.previewMask!)).toEqual([0, 1, 1, 1])

  await select.setValue(saved.id)
  await button('Confirm shape').trigger('click')
  expect(select.element.value).toBe('')
  expect(Array.from(editor.previewMask!)).toEqual([0, 0, 1, 1])

  await button('Undo').trigger('click')
  expect(Array.from(editor.previewMask!)).toEqual([0, 1, 1, 1])
  await button('Redo').trigger('click')
  await button('Save ROI').trigger('click')
  expect(state.confirmedROIs.map((roi) => Array.from(roi.mask))).toEqual([
    [1, 1, 0, 0],
    [0, 0, 1, 1],
  ])
})

it('starts a draft with a saved ROI and adds another saved ROI on confirmation', async () => {
  const state = roiState(ref(new Float32Array(4).fill(1)), 4)
  const { editor } = state
  stageRectangle(editor, 0, 1)
  editor.confirmShape()
  state.saveDraft()
  stageRectangle(editor, 1, 2)
  editor.confirmShape()
  state.saveDraft()
  const [first, second] = state.confirmedROIs

  const { panel, button } = mountPanel(state)
  const select = panel.get<HTMLSelectElement>('select[aria-label="Use an existing region"]')
  await select.setValue(first!.id)
  expect(editor.previewMask).toBeNull()
  await button('Confirm shape').trigger('click')
  expect(Array.from(editor.previewMask!)).toEqual([1, 1, 0, 0])

  await select.setValue(second!.id)
  expect(Array.from(editor.previewMask!)).toEqual([1, 1, 0, 0])
  await button('Confirm shape').trigger('click')
  await button('Save ROI').trigger('click')
  expect(Array.from(state.confirmedROIs[2]!.mask)).toEqual([1, 1, 1, 0])
})

it('keeps the selected cluster mask when a new result replaces the label map', async () => {
  const state = roiState(ref(new Float32Array(4).fill(1)), 4)
  const { panel, button } = mountPanel(state)
  const cluster: Region = {
    id: 'kmeans:1:0',
    kind: 'kmeans',
    clusterId: 0,
    labels: Int32Array.of(0, -1, 1, 0),
    label: 'Cluster 0',
    color: '#abc',
    grid: { runId: '', shape: [1, 4] },
  }
  await panel.setProps({ regions: [cluster] })
  const select = panel.get<HTMLSelectElement>('select[aria-label="Use an existing region"]')
  await select.setValue(cluster.id)
  expect(state.editor.previewMask).toBeNull()
  expect(Array.from(state.editor.shapeMask!)).toEqual([1, 0, 0, 1])

  const nextCluster = { ...cluster, id: 'kmeans:2:0', labels: Int32Array.of(1, 0, 0, -1) }
  await panel.setProps({ regions: [nextCluster] })
  expect(select.element.value).toBe(cluster.id)
  expect(select.get('option:checked').text()).toContain('previous result')
  await button('Confirm shape').trigger('click')
  expect(select.find(`option[value="${cluster.id}"]`).exists()).toBe(false)
  expect(Array.from(state.editor.previewMask!)).toEqual([1, 0, 0, 1])

  await button('Undo').trigger('click')
  expect(state.editor.previewMask).toBeNull()
  await button('Redo').trigger('click')
  await button('Save ROI').trigger('click')
  expect(Array.from(state.confirmedROIs[0]!.mask)).toEqual([1, 0, 0, 1])
})

it('collects the signal pixels of the current image into a named ROI', async () => {
  const matrix = ref<Float32Array | null>(Float32Array.of(5, 0, 2, 0))
  const state = roiState(matrix, 4)
  // A saved ROI keeps the region select on screen while collecting.
  stageRectangle(state.editor, 3, 3)
  state.editor.confirmShape()
  state.saveDraft()
  const collect = collectFrom(state.editor, matrix, Uint8Array.of(1, 1, 1, 0))
  const { panel, button } = mountPanel(state, collect)

  await panel.get('button[aria-label="Collect"]').trigger('click')
  expect(panel.get('[data-testid="roi-collect-source"]').text()).toBe('m/z 100.0000')
  const options = panel.findAll('[role="group"][aria-label="Collect"] button')
  expect(options.map((option) => option.get('.font-mono').text())).toEqual(['2', '1', '3'])
  expect(options[2]!.text()).toContain('All acquired')
  const signal = options[0]!

  await signal.trigger('click')
  expect(signal.attributes('aria-pressed')).toBe('true')
  const select = panel.get<HTMLSelectElement>('select[aria-label="Use an existing region"]')
  expect(select.element.value).toBe('')
  expect(select.text()).not.toContain('previous result')

  await button('Confirm shape').trigger('click')
  await button('Save ROI').trigger('click')
  const roi = state.confirmedROIs[1]!
  expect(roi).toMatchObject({ type: 'collect', label: '100.0000 Signal' })
  expect(Array.from(roi.mask)).toEqual([1, 0, 1, 0])
  expect(panel.findAll('.card-tag').map((tag) => tag.text())).toEqual(['Rect', 'Collect'])
})

it('disables a collect option that has no pixels', async () => {
  const matrix = ref<Float32Array | null>(Float32Array.of(5, 3))
  const state = roiState(matrix, 2)
  const { panel } = mountPanel(state, collectFrom(state.editor, matrix, Uint8Array.of(1, 1)))
  await panel.get('button[aria-label="Collect"]').trigger('click')
  const [signal, noSignal] = panel.findAll('[role="group"][aria-label="Collect"] button')
  expect(signal!.attributes('disabled')).toBeUndefined()
  expect(noSignal!.attributes('disabled')).toBeDefined()
})

it('disables the Collect tool under the multi-ion overlay', () => {
  const matrix = ref<Float32Array | null>(Float32Array.of(5, 0))
  const state = roiState(matrix, 2)
  const collect = collectFrom(state.editor, matrix, Uint8Array.of(1, 1), false)
  const tool = mountPanel(state, collect).panel.get('button[aria-label="Collect"]')
  expect(tool.attributes('disabled')).toBeDefined()
  expect(tool.attributes('title')).toBe('Unavailable with the multi-ion overlay')
})
