import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { useResultROI } from '@/features/vizworkbench/composables/useResultROI'
import { roiToRegion } from '@/features/vizworkbench/composables/useROI'
import type { Region } from '@/features/vizworkbench/utils/region'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import ROIPanel from '../ROIPanel.vue'

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))
enableAutoUnmount(afterEach)

function mountPanel(state: ReturnType<typeof useResultROI>) {
  const panel = mount(ROIPanel, {
    props: {
      editor: state.editor,
      rois: state.confirmedROIs.value,
      regions: state.confirmedROIs.value.map((roi) => roiToRegion(roi, '')),
      opacities: state.roiOpacities.value,
      viewingRoi: false,
      selectedRoiIds: null,
      onClearAll: state.roiClearAll,
      onConfirm: state.roiConfirm,
    },
    global: { plugins: [i18n] },
  })
  const button = (label: string) => panel.findAll('button').find((item) => item.text() === label)!
  return { panel, button }
}

function stageRectangle(editor: ReturnType<typeof useResultROI>['editor'], x0: number, x1: number) {
  editor.stageShape({ type: 'rectangle', rect: { x0, x1, y0: 0, y1: 0 }, path: [] })
}

it('clears saved ROIs and the draft only after confirming Clear all', async () => {
  const state = useResultROI(ref(new Float32Array([1, 2])), ref(2), ref(1))
  stageRectangle(state.editor, 0, 0)
  state.editor.confirmShape()
  state.roiConfirm()
  stageRectangle(state.editor, 1, 1)
  state.editor.confirmShape()

  const { panel, button } = mountPanel(state)
  const clear = button('Clear all')
  await clear.trigger('click')
  const dialog = panel.getComponent(ConfirmDialog)
  expect(dialog.text()).toContain('Clear all ROIs?')
  expect(panel.emitted('clearAll')).toBeUndefined()

  await dialog.get('.modal-action button').trigger('click')
  expect(panel.findComponent(ConfirmDialog).exists()).toBe(false)
  expect(state.confirmedROIs.value).toHaveLength(1)
  expect(state.editor.previewCount).toBe(1)

  await clear.trigger('click')
  await panel.getComponent(ConfirmDialog).get('.modal-action .btn-error').trigger('click')
  expect(panel.findComponent(ConfirmDialog).exists()).toBe(false)
  expect(panel.emitted('clearAll')).toHaveLength(1)
  expect(state.confirmedROIs.value).toHaveLength(0)
  expect(state.editor.hasDraft).toBe(false)
})

it('intersects each confirmed shape without switching modes before saving', async () => {
  const state = useResultROI(ref(new Float32Array(4).fill(1)), ref(4), ref(1))
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
  expect(Array.from(state.confirmedROIs.value[0]!.mask)).toEqual([0, 1, 0, 0])
})

it('previews a saved ROI and subtracts it only on confirmation', async () => {
  const state = useResultROI(ref(new Float32Array(4).fill(1)), ref(4), ref(1))
  const { editor } = state
  stageRectangle(editor, 0, 1)
  editor.confirmShape()
  state.roiConfirm()
  const saved = state.confirmedROIs.value[0]!

  stageRectangle(editor, 1, 3)
  editor.confirmShape()
  const { panel, button } = mountPanel(state)
  await button('Subtract').trigger('click')
  const select = panel.get<HTMLSelectElement>('select[aria-label="Use an existing region"]')
  await select.setValue(`roi:${saved.id}`)
  expect(select.element.value).toBe(`roi:${saved.id}`)
  expect(Array.from(editor.shapeMask!)).toEqual([1, 1, 0, 0])
  expect(Array.from(editor.previewMask!)).toEqual([0, 1, 1, 1])
  expect(button('Save ROI').attributes('disabled')).toBeDefined()

  await button('Discard shape').trigger('click')
  expect(select.element.value).toBe('')
  expect(Array.from(editor.previewMask!)).toEqual([0, 1, 1, 1])

  await select.setValue(`roi:${saved.id}`)
  await button('Confirm shape').trigger('click')
  expect(select.element.value).toBe('')
  expect(Array.from(editor.previewMask!)).toEqual([0, 0, 1, 1])

  await button('Undo').trigger('click')
  expect(Array.from(editor.previewMask!)).toEqual([0, 1, 1, 1])
  await button('Redo').trigger('click')
  await button('Save ROI').trigger('click')
  expect(state.confirmedROIs.value.map((roi) => Array.from(roi.mask))).toEqual([
    [1, 1, 0, 0],
    [0, 0, 1, 1],
  ])
})

it('starts a draft with a saved ROI and adds another saved ROI on confirmation', async () => {
  const state = useResultROI(ref(new Float32Array(4).fill(1)), ref(4), ref(1))
  const { editor } = state
  stageRectangle(editor, 0, 1)
  editor.confirmShape()
  state.roiConfirm()
  stageRectangle(editor, 1, 2)
  editor.confirmShape()
  state.roiConfirm()
  const [first, second] = state.confirmedROIs.value

  const { panel, button } = mountPanel(state)
  const select = panel.get<HTMLSelectElement>('select[aria-label="Use an existing region"]')
  await select.setValue(`roi:${first!.id}`)
  expect(editor.previewMask).toBeNull()
  await button('Confirm shape').trigger('click')
  expect(Array.from(editor.previewMask!)).toEqual([1, 1, 0, 0])

  await select.setValue(`roi:${second!.id}`)
  expect(Array.from(editor.previewMask!)).toEqual([1, 1, 0, 0])
  await button('Confirm shape').trigger('click')
  await button('Save ROI').trigger('click')
  expect(Array.from(state.confirmedROIs.value[2]!.mask)).toEqual([1, 1, 1, 0])
})

it('keeps the selected cluster mask when a new result replaces the label map', async () => {
  const state = useResultROI(ref(new Float32Array(4).fill(1)), ref(4), ref(1))
  const { panel, button } = mountPanel(state)
  const cluster: Region = {
    id: 'kmeans:1:0',
    kind: 'kmeans',
    clusterId: 0,
    labels: Int32Array.of(0, -1, 1, 0),
    label: 'Cluster 0',
    color: '#abc',
    grid: { runId: '', shape: [1, 4] },
    pixelCount: 2,
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
  expect(Array.from(state.confirmedROIs.value[0]!.mask)).toEqual([1, 0, 0, 1])
})
