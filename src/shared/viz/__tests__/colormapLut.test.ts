import { describe, expect, it } from 'vitest'
import { buildLUT, getColormapStops } from '../colormapLut'

describe('buildLUT', () => {
  it('produces a 256-entry LUT hitting the colormap endpoints exactly', () => {
    const lut = buildLUT('viridis')
    expect(lut).toHaveLength(256)
    expect(lut[0]).toEqual([68, 1, 84])
    expect(lut[255]).toEqual([254, 231, 37])
  })

  it('interpolates linearly between stops — gray is an exact identity ramp', () => {
    const lut = buildLUT('gray')
    expect(lut[0]).toEqual([0, 0, 0])
    expect(lut[128]).toEqual([128, 128, 128])
    expect(lut[255]).toEqual([255, 255, 255])
  })

  it('keeps monotonic channels monotonic after interpolation (viridis green)', () => {
    // viridis 的绿色通道沿 stops 单调递增（1 → 231），线性插值后必须保持非降，
    // 否则意味着分段索引算错（LUT 错位 = 图像颜色静默损坏）
    const lut = buildLUT('viridis')
    for (let i = 1; i < 256; i++) {
      expect(lut[i]![1]).toBeGreaterThanOrEqual(lut[i - 1]![1])
    }
  })

  it('falls back to viridis for unknown names', () => {
    expect(buildLUT('does-not-exist')).toEqual(buildLUT('viridis'))
  })

  it('caches by name — repeated calls return the same (read-only) array', () => {
    expect(buildLUT('viridis')).toBe(buildLUT('viridis'))
    expect(buildLUT('hot')).toBe(buildLUT('hot'))
  })
})

describe('getColormapStops', () => {
  it('starts and ends where the image LUT does, with the same fallback', () => {
    const stops = getColormapStops('magma')
    expect(buildLUT('magma')[0]).toEqual(stops[0])
    expect(buildLUT('magma')[255]).toEqual(stops[stops.length - 1])
    expect(getColormapStops('does-not-exist')).toEqual(getColormapStops('viridis'))
  })
})
