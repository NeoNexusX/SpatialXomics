import { describe, it, expect } from 'vitest'
import {
  REGION_PALETTE,
  KMEANS_COLOR_COUNT,
  ROI_COLOR_OFFSET,
  kmeansColor,
  roiColorAt,
  rgbCss,
  hexToRgb,
} from '../regionPalette'

describe('regionPalette', () => {
  it('contains 50 colors and keeps tab20 in the first 20 slots', () => {
    expect(REGION_PALETTE).toHaveLength(50)
    expect(KMEANS_COLOR_COUNT).toBe(20)
    expect(ROI_COLOR_OFFSET).toBe(20)
    // tab20 starts with the classic matplotlib blue/orange pair
    expect(REGION_PALETTE[0]).toEqual({ r: 31, g: 119, b: 180 })
    expect(REGION_PALETTE[2]).toEqual({ r: 255, g: 127, b: 14 })
  })

  it('kmeansColor indexes directly and wraps past the table', () => {
    expect(kmeansColor(0)).toEqual(REGION_PALETTE[0])
    expect(kmeansColor(19)).toEqual(REGION_PALETTE[19])
    expect(kmeansColor(50)).toEqual(REGION_PALETTE[0])
  })

  it('roiColorAt never collides with kmeans colors for the first 30 ROIs', () => {
    const kmeansSlots = new Set(
      Array.from({ length: KMEANS_COLOR_COUNT }, (_, i) => kmeansColor(i)),
    )
    for (let i = 0; i < 30; i++) {
      const c = roiColorAt(i)
      expect(kmeansSlots.has(c)).toBe(false)
      expect(REGION_PALETTE.indexOf(c)).toBeGreaterThanOrEqual(ROI_COLOR_OFFSET)
    }
    // wraps only inside the ROI block
    expect(roiColorAt(30)).toEqual(roiColorAt(0))
  })

  it('all colors are valid 0-255 RGB and unique', () => {
    const keys = new Set<string>()
    for (const c of REGION_PALETTE) {
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(255)
      }
      keys.add(`${c.r},${c.g},${c.b}`)
    }
    expect(keys.size).toBe(REGION_PALETTE.length)
  })

  it('rgbCss / hexToRgb round-trip', () => {
    const c = { r: 31, g: 119, b: 180 }
    expect(rgbCss(c)).toBe('rgb(31,119,180)')
    expect(hexToRgb('#1f77b4')).toEqual(c)
    expect(hexToRgb('1f77b4')).toEqual(c)
    expect(hexToRgb('#zzz')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
  })
})
