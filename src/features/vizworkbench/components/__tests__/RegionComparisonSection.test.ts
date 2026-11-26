import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import { mzAxisRef, resetZarrSharedState, setZarrStore } from '@/services/zarr/zarrSharedState'
import type { Region, RegionGrid } from '@/features/vizworkbench/utils/region'
import RegionComparisonSection from '../RegionComparisonSection.vue'

// The preview thumbnail watches its box; jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
)

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))
enableAutoUnmount(afterEach)
afterEach(() => {
  setZarrStore(null)
  resetZarrSharedState()
})

const GRID: RegionGrid = { runId: 'run', shape: [1, 2] }
const roi = (id: string, mask: number[]): Region => ({
  id,
  kind: 'roi',
  label: id,
  color: 'rgb(0,0,0)',
  grid: GRID,
  mask: Uint8Array.from(mask),
})

function mountSection() {
  return mount(RegionComparisonSection, {
    props: {
      regions: [roi('left', [1, 0]), roi('right', [0, 1])],
      grid: GRID,
      dataMode: 'continuous',
      backdrop: null,
      spectrumMode: 'centroid',
      selectedMzIndex: 0,
    },
    global: { plugins: [i18n] },
  })
}

const header = (w: ReturnType<typeof mountSection>, title: string) =>
  w.findAll('button[aria-expanded]').find((button) => button.text().includes(title))!

describe('RegionComparisonSection', () => {
  it('opens the picker and the results together and scrolls them into view', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const w = mountSection()
    await header(w, 'Compare regions').trigger('click')
    expect(header(w, 'Comparison results').attributes('aria-expanded')).toBe('true')
    await vi.waitFor(() => expect(scroll).toHaveBeenCalledOnce())
  })

  it('compares the two groups and shows the ion of a clicked result', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    setZarrStore({
      spatialShape: GRID.shape,
      buildPixelMask: async () => ({ mask: new Uint8Array(2), pixelCount: 1 }),
      streamRegionStatsBySpectra: async () => [
        { sum: Float64Array.of(5), count: Int32Array.of(1) },
        { sum: Float64Array.of(0), count: Int32Array.of(0) },
      ],
    } as never)
    mzAxisRef.value = Float64Array.of(445.05)
    const w = mountSection()
    await header(w, 'Compare regions').trigger('click')

    // Group A takes the first region, group B the second.
    const [aLeft, , , bRight] = w.findAll('input[type="checkbox"]')
    await aLeft!.setValue(true)
    await bRight!.setValue(true)
    await w
      .findAll('button')
      .find((button) => button.text() === 'Compare')!
      .trigger('click')

    await vi.waitFor(() => expect(w.find('tr[data-ion-index="0"]').exists()).toBe(true))
    await w.get('tr[data-ion-index="0"]').trigger('click')
    expect(w.emitted('select-mz')).toEqual([[0]])
  })
})
