import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { useIonImageDisplay } from '../useIonImageDisplay'
import type { ZarrSession } from '../useZarrIonImage'

/** The session fields the display reads, holding a 1 × n image. */
function setup(values: number[]) {
  const zarr = reactive({
    imageMatrix: Float32Array.from(values) as Float32Array | null,
    normalizationFactors: null as Float32Array | null,
    isProcessed: false,
    hasTic: true,
    ionCols: values.length,
    ionRows: 1,
    loadNormalization: vi.fn(async () => {}),
    clearNormalization: vi.fn(),
  })
  const display = useIonImageDisplay(zarr as unknown as ZarrSession)
  return { zarr, display }
}

describe('useIonImageDisplay', () => {
  it('builds the gradient from the stops the image is drawn with', () => {
    const { display } = setup([1, 2, 3, 4])
    display.setColormap('gray')
    expect(display.gradientCss).toContain('rgb(0 0 0)')
    expect(display.gradientCss).toContain('rgb(255 255 255)')
    display.setColormap('viridis')
    expect(display.gradientCss).toContain('rgb(68 1 84)')
  })

  it('carries a manual range over to the next image, as fractions of its span', async () => {
    const { zarr, display } = setup([1, 2, 3, 4])
    display.setDisplayMax(4)
    zarr.imageMatrix = Float32Array.from([10, 20, 30, 40])
    await nextTick()
    expect(display.globalMax).toBe(40)
    expect(display.displayMax).toBe(40)
  })

  it('goes back to the automatic range on reset', async () => {
    const { zarr, display } = setup([1, 2, 3, 4])
    display.setDisplayMax(1)
    zarr.imageMatrix = Float32Array.from([10, 20, 30, 40])
    await nextTick()
    expect(display.displayMax).toBe(10)
    display.resetRange()
    expect(display.displayMax).toBe(40)
  })

  it('ignores non-finite pixels in the statistics', () => {
    const { display } = setup([1, Number.NaN, 3, Number.POSITIVE_INFINITY])
    expect(display.globalMax).toBe(3)
    expect(display.imageInfo).toMatchObject({ pixels: '4 × 1', nonZero: '50.0%' })
    expect(display.intensityHistogram.reduce((a, b) => a + b, 0)).toBe(2)
    expect(display.intensityRange).toBe('1.0 – 3.0')
  })

  it('divides the image by TIC once the factors arrive, except for processed data', async () => {
    const { zarr, display } = setup([1, 2, 3, 4])
    await display.setIntensityScale('tic')
    expect(zarr.loadNormalization).toHaveBeenCalledWith('tic')
    expect(Array.from(display.matrix!)).toEqual([1, 2, 3, 4])

    zarr.normalizationFactors = Float32Array.of(2, 2, 4, 0)
    expect(Array.from(display.matrix!)).toEqual([0.5, 1, 0.75, 0])

    zarr.isProcessed = true
    expect(display.matrix).toBe(zarr.imageMatrix)

    zarr.isProcessed = false
    await display.setIntensityScale('linear')
    expect(zarr.clearNormalization).toHaveBeenCalled()
    expect(display.matrix).toBe(zarr.imageMatrix)
  })

  it('falls back to Linear when the dataset turns out to have no TIC', async () => {
    const { zarr, display } = setup([1, 2])
    await display.setIntensityScale('tic')
    zarr.hasTic = false
    await nextTick()
    expect(display.intensityScale).toBe('linear')
    expect(zarr.clearNormalization).toHaveBeenCalledOnce()
  })

  it('resets every display control', async () => {
    const { zarr, display } = setup([1, 2, 3, 4])
    display.setColormap('gray')
    display.setGamma(1.4)
    await display.setIntensityScale('tic')
    display.setDisplayMax(2)

    display.reset()
    expect(display).toMatchObject({
      colormap: 'inferno',
      intensityScale: 'linear',
      gamma: 1,
      displayMax: 4,
    })
    expect(zarr.clearNormalization).toHaveBeenCalledOnce()
  })
})
