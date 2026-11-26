import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import { useIonImageDisplay } from '@/features/vizworkbench/composables/useIonImageDisplay'
import type { ZarrSession } from '@/features/vizworkbench/composables/useZarrIonImage'
import DisplayRangeStrip from '../DisplayRangeStrip.vue'

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))
enableAutoUnmount(afterEach)

/** A display whose range runs from 0 (bottom of the strip) to 40 (top). */
function mountStrip(disabled = false) {
  const zarr = reactive({
    imageMatrix: Float32Array.of(10, 20, 30, 40),
    normalizationFactors: null,
    isProcessed: false,
    hasTic: false,
    ionCols: 4,
    ionRows: 1,
    loadNormalization: vi.fn(),
    clearNormalization: vi.fn(),
  })
  const display = useIonImageDisplay(zarr as unknown as ZarrSession)
  const wrapper = mount(DisplayRangeStrip, {
    props: { display, disabled },
    global: { plugins: [i18n] },
  })
  const strip = wrapper.get('[data-testid="display-range-strip"]')
  // jsdom has no layout: the strip is 100px tall from the top of the page.
  strip.element.getBoundingClientRect = () => ({ top: 0, height: 100 }) as DOMRect
  return { wrapper, strip, display }
}

const moveTo = (clientY: number) => document.dispatchEvent(new MouseEvent('mousemove', { clientY }))

describe('DisplayRangeStrip', () => {
  it('moves the nearer end of the range to a click on the strip', async () => {
    const { strip, display } = mountStrip()
    expect([display.displayMin, display.displayMax]).toEqual([0, 40])
    await strip.trigger('mousedown', { clientY: 25 })
    expect(display.displayMax).toBe(30)
    await strip.trigger('mousedown', { clientY: 90 })
    expect(display.displayMin).toBe(4)
  })

  it('keeps a dragged handle on its side of the other one until release', async () => {
    const { wrapper, display } = mountStrip()
    display.setDisplayMax(30)
    await wrapper.get('[data-testid="display-range-min"]').trigger('mousedown')
    moveTo(50)
    expect(display.displayMin).toBe(20)
    moveTo(0)
    expect(display.displayMin).toBe(30)

    document.dispatchEvent(new MouseEvent('mouseup'))
    moveTo(100)
    expect(display.displayMin).toBe(30)
  })

  it('resets the range and shows both ends', async () => {
    const { wrapper, display } = mountStrip()
    display.setDisplayMax(10)
    await wrapper.get('button').trigger('click')
    expect(display.displayMax).toBe(40)
    expect(wrapper.findAll('.range-label').map((label) => label.text())).toEqual(['40.0', '0'])
  })

  it('is grayed out under the multi-ion overlay', () => {
    const { wrapper } = mountStrip(true)
    expect(wrapper.classes()).toContain('pointer-events-none')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })
})
