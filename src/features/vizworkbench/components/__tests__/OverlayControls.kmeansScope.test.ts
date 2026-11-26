import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import type { ConfirmedROI } from '@/features/vizworkbench/composables/useROI'
import type { RoiCollect } from '@/features/vizworkbench/composables/useRoiCollect'
import type { RoiEditor } from '@/features/vizworkbench/composables/useRoiEditor'
import OverlayControls from '../OverlayControls.vue'

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))
enableAutoUnmount(afterEach)

function roi(id: string, label: string): ConfirmedROI {
  return {
    id,
    type: 'rectangle',
    label,
    color: 'rgb(0,0,0)',
    mask: Uint8Array.of(1, 0),
    shape: [1, 2],
    pixelCount: 1,
    stats: null,
    spectrum: null,
  }
}

function mountControls(confirmedRois: ConfirmedROI[]) {
  return mount(OverlayControls, {
    props: {
      umapVisible: false,
      kmeansVisible: false,
      overlayLoading: false,
      clusteringCreating: false,
      clusteringComputing: false,
      clusteringReady: false,
      clusteringRefreshing: false,
      umapAlpha: 255,
      kmeansAlpha: 255,
      kmeansClusters: [],
      kmeansLabelsAvailable: false,
      kmeansK: null,
      kmeansScope: null,
      kmeansComputing: false,
      selectedKmeansIds: null,
      storageMode: 'continuous',
      roiEditor: {} as RoiEditor,
      roiCollect: {} as RoiCollect,
      viewingRoi: false,
      confirmedRois,
      editableRegions: [],
      roiOpacities: new Map(),
      selectedRoiIds: null,
      channelsEnabled: false,
      ionChannels: [],
      canAddChannel: false,
      channelsLoading: false,
      selectedMz: 0,
      maxIonChannels: 4,
      batchAddMode: false,
    },
    global: {
      plugins: [i18n],
      stubs: { ROIPanel: true, MaskExportPanel: true, IonChannelPanel: true },
    },
  })
}

it('hides the KMeans scope until there are saved ROIs', async () => {
  const controls = mountControls([])
  await controls.setProps({ clusteringReady: true })
  expect(controls.findAll('button').some((button) => button.text() === 'Compute')).toBe(true)
  expect(controls.find('select[aria-label="Scope"]').exists()).toBe(false)
})

it('runs KMeans inside the chosen ROI and defaults to all pixels', async () => {
  const first = roi('roi-1', 'ROI 1')
  const second = roi('roi-2', 'ROI 2')
  const controls = mountControls([first, second])
  // The enable switch follows clusteringReady only on its false → true change.
  await controls.setProps({ clusteringReady: true })
  const select = controls.get<HTMLSelectElement>('select[aria-label="Scope"]')
  const compute = controls.findAll('button').find((button) => button.text() === 'Compute')!
  expect(select.get('option:checked').text()).toBe('All pixels')

  await select.setValue('roi-2')
  await compute.trigger('click')
  expect(controls.emitted('run-kmeans')).toEqual([[5, second]])

  // The applied k and scope would give the same clusters again.
  await controls.setProps({ kmeansK: 5, kmeansScope: second, kmeansVisible: true })
  expect(compute.attributes('disabled')).toBeDefined()
  expect(controls.get('[data-testid="kmeans-scope"]').text()).toBe('Scope · ROI 2')

  select.element.selectedIndex = 0
  await select.trigger('change')
  expect(compute.attributes('disabled')).toBeUndefined()
  await compute.trigger('click')
  expect(controls.emitted('run-kmeans')![1]).toEqual([5, null])

  // Deleting the chosen ROI falls back to all pixels.
  await select.setValue('roi-1')
  await controls.setProps({ confirmedRois: [second] })
  expect(select.get('option:checked').text()).toBe('All pixels')
})
