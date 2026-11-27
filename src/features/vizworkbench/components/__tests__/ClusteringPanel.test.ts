import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import type { ClusteringState } from '@/features/vizworkbench/composables/useOverlayData'
import { useROI } from '@/features/vizworkbench/composables/useROI'
import ClusteringPanel from '../ClusteringPanel.vue'

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))
enableAutoUnmount(afterEach)

/** The fields and actions the panel uses, with a ready task and no KMeans result yet. */
function clusteringState() {
  return reactive({
    umapVisible: false,
    kmeansVisible: false,
    overlayLoading: false,
    overlayError: null,
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
    toggleOverlay: vi.fn(),
    retryClustering: vi.fn(),
    createClusteringTask: vi.fn(),
    refreshClusteringStatus: vi.fn(),
    setOverlayAlpha: vi.fn(),
    runKmeans: vi.fn(),
    toggleKmeansCluster: vi.fn(),
    selectAllKmeansClusters: vi.fn(),
    clearKmeansClusters: vi.fn(),
    exportUmapPng: vi.fn(),
    exportKmeansPng: vi.fn(),
  }) as unknown as ClusteringState
}

/** Saved one-pixel ROIs on a 1 × `count` grid: 'ROI 1', 'ROI 2', ... */
function savedRois(count: number) {
  const state = useROI(ref(null), ref({ runId: '', shape: [1, Math.max(count, 1)] as const }))
  for (let x = 0; x < count; x++) {
    state.editor.stageShape({ type: 'rectangle', rect: { x0: x, y0: 0, x1: x, y1: 0 }, path: [] })
    state.editor.confirmShape()
    state.saveDraft()
  }
  return state
}

function mountPanel(clustering: ClusteringState, rois = savedRois(0).confirmedROIs) {
  return mount(ClusteringPanel, { props: { clustering, rois }, global: { plugins: [i18n] } })
}

const button = (panel: ReturnType<typeof mountPanel>, text: string) =>
  panel.findAll('button').find((item) => item.text() === text)!

describe('ClusteringPanel', () => {
  it('asks before starting the backend task and starts it only on confirmation', async () => {
    const clustering = clusteringState()
    const panel = mountPanel(clustering)
    const toggle = panel.get<HTMLInputElement>('input.toggle')

    await toggle.setValue(true)
    expect(document.body.textContent).toContain('Continue')
    expect(clustering.createClusteringTask).not.toHaveBeenCalled()

    const dialog = document.body.querySelector('.modal-action')!
    ;(dialog.querySelector('.btn-primary') as HTMLButtonElement).click()
    await nextTick()
    expect(clustering.createClusteringTask).toHaveBeenCalledOnce()
  })

  it('hides the KMeans scope until there are saved ROIs', async () => {
    const clustering = clusteringState()
    const panel = mountPanel(clustering)
    // The enable switch follows clusteringReady only on its false → true change.
    clustering.clusteringReady = true
    await nextTick()
    expect(button(panel, 'Compute')).toBeDefined()
    expect(panel.find('select[aria-label="Scope"]').exists()).toBe(false)
  })

  it('runs KMeans inside the chosen ROI and defaults to all pixels', async () => {
    const state = savedRois(2)
    const [, second] = state.confirmedROIs
    const clustering = clusteringState()
    const panel = mountPanel(clustering, state.confirmedROIs)
    clustering.clusteringReady = true
    await nextTick()
    const select = panel.get<HTMLSelectElement>('select[aria-label="Scope"]')
    const compute = button(panel, 'Compute')
    expect(select.get('option:checked').text()).toBe('All pixels')

    await select.setValue('roi-2')
    await compute.trigger('click')
    expect(clustering.runKmeans).toHaveBeenLastCalledWith(5, second)

    // The applied k and scope would give the same clusters again.
    Object.assign(clustering, { kmeansK: 5, kmeansScope: second, kmeansVisible: true })
    await nextTick()
    expect(compute.attributes('disabled')).toBeDefined()
    expect(panel.get('[data-testid="kmeans-scope"]').text()).toBe('Scope · ROI 2')

    select.element.selectedIndex = 0
    await select.trigger('change')
    expect(compute.attributes('disabled')).toBeUndefined()
    await compute.trigger('click')
    expect(clustering.runKmeans).toHaveBeenLastCalledWith(5, null)

    // Deleting the chosen ROI falls back to all pixels.
    await select.setValue('roi-1')
    state.deleteROI('roi-1')
    await panel.setProps({ rois: state.confirmedROIs })
    expect(select.get('option:checked').text()).toBe('All pixels')
  })

  it('sets the overlay opacity through the state', async () => {
    const clustering = clusteringState()
    clustering.umapVisible = true
    const panel = mountPanel(clustering)
    await panel.get('input[type="range"]').setValue('128')
    expect(clustering.setOverlayAlpha).toHaveBeenCalledWith('umap', 128)
  })
})
