import { describe, expect, it } from 'vitest'
import {
  compositeMask,
  countSignal,
  roiMaskOutline,
  signalMask,
  summarizeRoiMask,
} from '../roiMask'

describe('summarizeRoiMask', () => {
  const mask = Uint8Array.of(0, 1, 0, 1, 1, 1)

  it('counts pixels and computes stats over the masked matrix values', () => {
    // masked values: 20, 40, 50, 60 → mean 42.5, std √218.75
    const { pixelCount, stats } = summarizeRoiMask(mask, Float32Array.of(10, 20, 30, 40, 50, 60))
    expect(pixelCount).toBe(4)
    expect(stats?.mean).toBeCloseTo(42.5)
    expect(stats?.std).toBeCloseTo(Math.sqrt(218.75))
    expect(stats?.min).toBe(20)
    expect(stats?.max).toBe(60)
  })

  it('returns null stats when the matrix is missing or size-mismatched', () => {
    expect(summarizeRoiMask(mask, null).stats).toBeNull()
    expect(summarizeRoiMask(mask, new Float32Array(3)).stats).toBeNull()
    // The pixel count comes from the mask itself and is always available.
    expect(summarizeRoiMask(mask, null).pixelCount).toBe(4)
  })
})

describe('signal masks', () => {
  // The last cell was never acquired, so the image holds 0 there just like a missing ion.
  const acquired = Uint8Array.of(1, 1, 1, 1, 1, 0)
  const matrix = Float32Array.of(5, 0, Number.NaN, 0.5, 0, 0)

  it('splits acquired pixels by signal and leaves unacquired cells out of both', () => {
    expect(Array.from(signalMask(matrix, acquired, 'present'))).toEqual([1, 0, 0, 1, 0, 0])
    expect(Array.from(signalMask(matrix, acquired, 'absent'))).toEqual([0, 1, 1, 0, 1, 0])
    expect(countSignal(matrix, acquired)).toEqual({ present: 2, absent: 3 })
  })
})

describe('roiMaskOutline', () => {
  it('traces both the outer border and the hole of a mask', () => {
    const mask = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1])
    expect(roiMaskOutline(mask, 3, 3)).toBe(
      'M0 0h3 M1 1h1 M1 2h1 M0 3h3 M0 0v3 M1 1v1 M2 1v1 M3 0v3',
    )
  })
})

describe('compositeMask', () => {
  const red = { r: 255, g: 0, b: 0 }
  const blue = { r: 0, g: 0, b: 255 }
  const pixels = (rgba: Uint8ClampedArray) =>
    Array.from({ length: rgba.length / 4 }, (_, i) => Array.from(rgba.subarray(i * 4, i * 4 + 4)))

  it('writes the color as is over transparent pixels and leaves the rest alone', () => {
    const rgba = new Uint8ClampedArray(8)
    compositeMask(rgba, Uint8Array.of(1, 0), red, 153)
    expect(pixels(rgba)).toEqual([
      [255, 0, 0, 153],
      [0, 0, 0, 0],
    ])
  })

  it('blends with opaque pixels and keeps them opaque', () => {
    const rgba = Uint8ClampedArray.of(100, 100, 100, 255)
    compositeMask(rgba, Uint8Array.of(1), blue, 51)
    // 80% of the gray below, 20% blue
    expect(pixels(rgba)).toEqual([[80, 80, 131, 255]])
  })

  it('stacks translucent layers source-over', () => {
    const rgba = new Uint8ClampedArray(4)
    compositeMask(rgba, Uint8Array.of(1), red, 128)
    compositeMask(rgba, Uint8Array.of(1), blue, 128)
    // The lower layer shows through the upper one: 128 + 128 × 127 / 255 ≈ 192 alpha.
    expect(pixels(rgba)).toEqual([[85, 0, 170, 192]])
  })

  it('paints nothing at zero alpha', () => {
    const rgba = new Uint8ClampedArray(4)
    compositeMask(rgba, Uint8Array.of(1), red, 0)
    expect(pixels(rgba)).toEqual([[0, 0, 0, 0]])
  })
})
