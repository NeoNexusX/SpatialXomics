import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import {
  disposeZarrState,
  loadPixelSpectrum,
  meanSpectrumRef,
  pixelSpectrum,
  pixelSpectrumError,
  pixelSpectrumLoading,
  requestedPixelIndex,
  setSpectrumView,
  spectrumView,
  useZarrIonImage,
} from '../useZarrIonImage'
import { ZarrIncompatibleError } from '@/services/zarr/zarrOssStore'
import type { PixelSpectrum } from '@/services/zarr/types/zarr'
import { loadCoreMessages, loadFeatureMessages } from '@/i18n'

const mocks = vi.hoisted(() => ({
  /** 挂起的像素谱请求，由测试决定返回顺序与结果 */
  pixelRequests: [] as {
    index: number
    resolve: (spectrum: PixelSpectrum | null) => void
    reject: (error: Error) => void
  }[],
  initError: null as Error | null,
  /** 设置后平均谱按它返回，测试用来挂起请求 */
  meanSpectrum: null as Promise<Float32Array> | null,
}))

vi.mock('@/services/zarr/api/zarrAccessApi', () => ({ getZarrAccess: async () => ({}) }))

vi.mock('@/shared/config/runtimeConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/config/runtimeConfig')>()),
  getConfig: () => ({}),
}))

vi.mock('@/services/zarr/zarrOssStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/zarr/zarrOssStore')>()
  /** 只实现 useZarrIonImage 用到的接口：2×2 的 continuous 数据，3 个 m/z */
  class FakeStore {
    dataMode = 'continuous'
    rowAxis = 'ion'
    metadataAttrs = null
    spatialShape: [number, number] = [2, 2]
    hasTIC = false
    async init() {
      if (mocks.initError) throw mocks.initError
    }
    async loadMzAxis() {
      return new Float64Array([100, 200, 300])
    }
    async getSummedIonImageByMzIndices() {
      return new Float32Array(4)
    }
    async loadMeanSpectrum() {
      return mocks.meanSpectrum ?? new Float32Array([1, 0, 3])
    }
    getPixelSpectrum(index: number) {
      return new Promise<PixelSpectrum | null>((resolve, reject) => {
        mocks.pixelRequests.push({ index, resolve, reject })
      })
    }
    dispose() {}
  }
  return { ...actual, ZarrOssStore: FakeStore }
})

function spectrum(pixelIndex: number): PixelSpectrum {
  return {
    pixelIndex,
    x: pixelIndex + 1,
    y: 1,
    mz: new Float64Array([100, 200, 300]),
    intensity: new Float32Array([pixelIndex, 0, 1]),
  }
}

/** 在组件 setup 里建 composable（它注册了 onBeforeUnmount），并完成一次 init */
async function initSession() {
  let api!: ReturnType<typeof useZarrIonImage>
  mount(
    defineComponent({
      setup() {
        api = useZarrIonImage()
        return () => null
      },
    }),
  )
  await api.init('run-1')
  return api
}

describe('useZarrIonImage pixel spectrum', () => {
  beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))

  beforeEach(() => {
    mocks.pixelRequests.length = 0
    mocks.initError = null
    mocks.meanSpectrum = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    disposeZarrState()
    vi.restoreAllMocks()
  })

  it('starts on the mean spectrum and cannot switch to pixel before a pixel is clicked', async () => {
    await initSession()
    expect(spectrumView.value).toBe('mean')
    setSpectrumView('pixel')
    expect(spectrumView.value).toBe('mean')
  })

  it('switches to the pixel view on click, then toggles freely', async () => {
    await initSession()
    const load = loadPixelSpectrum(3)
    expect(spectrumView.value).toBe('pixel')
    expect(requestedPixelIndex.value).toBe(3)

    mocks.pixelRequests[0]!.resolve(spectrum(3))
    await load
    expect(pixelSpectrum.value?.pixelIndex).toBe(3)

    setSpectrumView('mean')
    expect(spectrumView.value).toBe('mean')
    setSpectrumView('pixel')
    expect(spectrumView.value).toBe('pixel')
    expect(pixelSpectrum.value?.pixelIndex).toBe(3)
  })

  it('keeps the previous spectrum while the next pixel loads', async () => {
    await initSession()
    const first = loadPixelSpectrum(1)
    mocks.pixelRequests[0]!.resolve(spectrum(1))
    await first

    void loadPixelSpectrum(2)
    expect(pixelSpectrumLoading.value).toBe(true)
    expect(pixelSpectrum.value?.pixelIndex).toBe(1)
  })

  it('keeps the last click when responses arrive out of order', async () => {
    await initSession()
    const first = loadPixelSpectrum(1)
    const second = loadPixelSpectrum(2)

    mocks.pixelRequests[1]!.resolve(spectrum(2))
    await second
    expect(pixelSpectrum.value?.pixelIndex).toBe(2)
    expect(pixelSpectrumLoading.value).toBe(false)

    mocks.pixelRequests[0]!.resolve(spectrum(1))
    await first
    expect(pixelSpectrum.value?.pixelIndex).toBe(2)
    expect(pixelSpectrumLoading.value).toBe(false)
  })

  it('clears the spectrum on failure and remembers the pixel for retry', async () => {
    await initSession()
    const first = loadPixelSpectrum(1)
    mocks.pixelRequests[0]!.resolve(spectrum(1))
    await first

    const failing = loadPixelSpectrum(4)
    mocks.pixelRequests[1]!.reject(new Error('chunk read failed'))
    await failing
    expect(pixelSpectrum.value).toBeNull()
    expect(pixelSpectrumError.value).toBe('chunk read failed')
    expect(requestedPixelIndex.value).toBe(4)
    expect(pixelSpectrumLoading.value).toBe(false)
  })

  it('drops a response that lands after the session was disposed', async () => {
    await initSession()
    const pending = loadPixelSpectrum(1)
    disposeZarrState()

    mocks.pixelRequests[0]!.resolve(spectrum(1))
    await pending
    expect(pixelSpectrum.value).toBeNull()
    expect(requestedPixelIndex.value).toBeNull()
    expect(spectrumView.value).toBe('mean')
  })

  it('keeps a mean spectrum of the previous run out of the new one', async () => {
    const api = await initSession()
    let finish!: (mean: Float32Array) => void
    mocks.meanSpectrum = new Promise((resolve) => (finish = resolve))
    await api.init('run-2')
    mocks.meanSpectrum = null
    await api.init('run-3')
    await vi.waitFor(() => expect(meanSpectrumRef.value).toEqual(new Float32Array([1, 0, 3])))
    const current = meanSpectrumRef.value

    finish(new Float32Array([9, 9, 9]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(meanSpectrumRef.value).toBe(current)
  })

  it('reports an unsupported zarr layout with the localized incompatible-format message', async () => {
    mocks.initError = new ZarrIncompatibleError('no v1.1 data group')
    const api = await initSession()
    expect(api.error.value).toBe('Incompatible result data format: only Zarr v1.1 is supported')
  })
})
