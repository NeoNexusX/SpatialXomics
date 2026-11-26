import { describe, expect, it } from 'vitest'
import { countSignal, signalMask, summarizeRoiMask } from '../roiMask'

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
