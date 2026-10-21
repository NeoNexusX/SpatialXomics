import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import SpectrumSection from '../SpectrumSection.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import {
  disposeZarrState,
  metadataAttrsRef,
  mzAxisRef,
  pixelSpectrum,
  requestedPixelIndex,
  spectrumView,
} from '../../composables/useZarrIonImage'

vi.mock('../visuals/AverageSpectrum.vue', () => ({
  default: { template: '<div><slot name="header" /></div>' },
}))

function setPixel(intensity: number[]) {
  pixelSpectrum.value = {
    pixelIndex: 0,
    x: 1,
    y: 1,
    mz: new Float64Array([100, 200, 300, 400]),
    intensity: new Float32Array(intensity),
  }
}

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))
afterEach(() => disposeZarrState())

it('keeps statistics aligned with the displayed spectrum', async () => {
  mzAxisRef.value = new Float64Array([100, 200, 300, 400])
  metadataAttrsRef.value = { centroid_spectrum: true }
  requestedPixelIndex.value = 0
  spectrumView.value = 'pixel'
  setPixel([5, 0, 15, Number.NaN])

  const wrapper = mount(SpectrumSection, {
    props: {
      dataMode: 'continuous',
      selectedMz: 100,
      selectedMzIndex: 0,
      mzTolerance: 0.001,
      intensityRange: '0 – 999',
    },
    global: { plugins: [i18n] },
  })
  expect(wrapper.text()).toMatch(/Peaks:\s*2/)
  expect(wrapper.text()).toMatch(/Intensity:\s*5\.0 – 15\.0/)

  setPixel([0, 42, 0, 0])
  await nextTick()
  expect(wrapper.text()).toMatch(/Peaks:\s*1/)
  expect(wrapper.text()).toMatch(/Intensity:\s*42\.0 – 42\.0/)

  setPixel([0, 0, 0, 0])
  await nextTick()
  expect(wrapper.text()).toMatch(/Peaks:\s*0/)
  expect(wrapper.text()).toMatch(/Intensity:\s*--/)

  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Mean')!
    .trigger('click')
  expect(wrapper.text()).toMatch(/Peaks:\s*4/)
  expect(wrapper.text()).toContain('0 – 999')
  wrapper.unmount()
})
