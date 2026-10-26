import { describe, expect, it } from 'vitest'
import { hotspotClip, measureOfChaos } from '../chaos'
import { pairKey, pearsonUnionMask } from '../pearson'
import { qValues } from '../fdr'
import {
  colocScore,
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_SCORE_RATIO,
  isValidScoreRatio,
  isValidScoreRatioPart,
  massScore,
  normalizeScoreRatio,
  spatialScore,
  totalScore,
} from '../score'
import { dbSliceFor, matchTargets } from '../match'
import { fmtMz } from '../format'

const W = 40
const H = 40

describe('m/z display precision', () => {
  it('shows six decimals so nearby observed and theoretical masses remain distinguishable', () => {
    expect(fmtMz(181.071762)).toBe('181.071762')
    expect(fmtMz(181.071835)).toBe('181.071835')
    expect(fmtMz(100)).toBe('100.000000')
    expect(fmtMz(null)).toBe('–')
  })
})

/** 中心亮、向外线性衰减的圆盘（各阈值切出同心层） */
function gradedDisc(cx: number, cy: number, r: number): Float32Array {
  const img = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d <= r) img[y * W + x] = 1 - d / r
    }
  }
  return img
}

describe('measureOfChaos (level sets)', () => {
  it('scores a structured blob above fragmented islands', () => {
    let seed = 42
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    const islands = new Float32Array(W * H)
    for (let b = 0; b < 25; b++) {
      const x0 = 1 + Math.floor(rnd() * 36)
      const y0 = 1 + Math.floor(rnd() * 36)
      for (let dy = 0; dy < 3; dy++)
        for (let dx = 0; dx < 3; dx++) islands[(y0 + dy) * W + x0 + dx] = 0.4 + rnd() * 0.6
    }
    const blob = measureOfChaos(gradedDisc(20, 20, 6), W, H)!
    const isl = measureOfChaos(islands, W, H)!
    expect(blob).toBeGreaterThan(0.9)
    expect(blob).toBeGreaterThan(isl)
  })

  it('returns null for degenerate images', () => {
    const speckle = new Float32Array(W * H)
    for (let i = 0; i < speckle.length; i += 7) speckle[i] = ((i % 5) + 1) / 5
    // 1 像素散点被腐蚀光，各层计数相同
    expect(measureOfChaos(speckle, W, H)).toBeNull()
    expect(measureOfChaos(new Float32Array(W * H), W, H)).toBeNull()
    expect(measureOfChaos(new Float32Array(W * H).fill(1), W, H)).toBeNull()
    expect(measureOfChaos(new Float32Array(10), 4, 4)).toBeNull()
  })

  it('clips the hottest 1 % of non-zero pixels', () => {
    const img = new Float32Array(200).fill(1)
    img[0] = 1000
    img[1] = 0
    const out = hotspotClip(img, 99)
    expect(out[0]).toBe(1)
    expect(out[1]).toBe(0)
  })
})

describe('pearsonUnionMask', () => {
  it('ignores pixels where both images are zero', () => {
    const a = gradedDisc(20, 20, 8)
    const b = gradedDisc(20, 20, 8).map((v) => v * 3)
    expect(pearsonUnionMask(a, b)).toBeCloseTo(1, 6)
    // 不同位置的两个圆盘：只看组织内像素时负相关；把背景 0 算进去会被抬高
    const c = gradedDisc(10, 10, 6)
    const d = gradedDisc(30, 30, 6)
    expect(pearsonUnionMask(c, d)!).toBeLessThan(0)
  })

  it('is undefined for too few pixels or zero variance', () => {
    const tiny = new Float32Array(W * H)
    tiny[5] = 1
    expect(pearsonUnionMask(tiny, tiny)).toBeNull()
    const flat = new Float32Array(W * H).fill(2)
    expect(pearsonUnionMask(flat, gradedDisc(20, 20, 8))).toBeNull()
  })

  it('keys peak pairs independent of order', () => {
    expect(pairKey(7, 3)).toBe(pairKey(3, 7))
  })
})

describe('scores', () => {
  it('decays the mass score with the error', () => {
    const tol = { value: 5, unit: 'ppm' } as const
    expect(massScore(0, 500, tol, 0.5)).toBe(1)
    expect(massScore(2.5, 500, tol, 0.5)).toBeCloseTo(Math.exp(-0.5), 9)
    expect(massScore(-5, 500, tol, 0.5)).toBeCloseTo(Math.exp(-2), 9)
    // Da 单位：误差换算成 Da 再比
    expect(massScore(10, 500, { value: 0.005, unit: 'Da' }, 0.5)).toBeCloseTo(Math.exp(-2), 9)
  })

  it('weights co-localization at 80% and chaos at 20%, with missing evidence counting as zero', () => {
    const weights = DEFAULT_ENGINE_CONFIG.spatialWeights
    expect(spatialScore(0.8, null, weights)).toBeCloseTo(0.16, 9)
    expect(spatialScore(0.8, 0.9, weights)).toBeCloseTo(0.88, 9)
    expect(spatialScore(0.8, -0.5, weights)).toBeCloseTo(0.16, 9)
    expect(spatialScore(1, 1, weights)).toBe(1)
    expect(spatialScore(0, 1, weights)).toBe(0.8)
  })

  it.each([null, -0.5, 0, 0.05, 0.1, NaN, Infinity])(
    'gives correlation %s no co-localization contribution',
    (r) => {
      expect(colocScore(r)).toBe(0)
      expect(spatialScore(0.8, r, DEFAULT_ENGINE_CONFIG.spatialWeights)).toBeCloseTo(0.16, 9)
    },
  )

  it('accepts correlation strictly above 0.1 without rescaling its value', () => {
    const r = 0.100001
    expect(colocScore(r)).toBe(r)
    expect(spatialScore(0.8, r, DEFAULT_ENGINE_CONFIG.spatialWeights)).toBeCloseTo(
      0.16 + 0.8 * r,
      9,
    )
    expect(colocScore(1.01)).toBe(1)
  })

  it('counts uncomputed spatial scores as zero without changing computed scores', () => {
    const cfg = DEFAULT_ENGINE_CONFIG
    expect(totalScore(1, 1, null, cfg)).toBeCloseTo(0.6, 9)
    expect(totalScore(0, 0, null, cfg)).toBe(0)
    expect(totalScore(1, 1, 0.95, cfg)).toBeCloseTo(0.98, 9)
    expect(totalScore(1, 0, 0, cfg)).toBe(0.4)
  })
})

describe('score weight ratio', () => {
  it('defaults to 4 : 2 : 4, i.e. weights 0.4 / 0.2 / 0.4', () => {
    expect(DEFAULT_SCORE_RATIO).toEqual({ mass: 4, adduct: 2, spatial: 4 })
    expect(DEFAULT_ENGINE_CONFIG.weights).toEqual({ mass: 0.4, adduct: 0.2, spatial: 0.4 })
  })

  it('divides each part by the sum', () => {
    const w = normalizeScoreRatio({ mass: 5, adduct: 2, spatial: 3 })
    expect(w.mass).toBeCloseTo(0.5, 12)
    expect(w.adduct).toBeCloseTo(0.2, 12)
    expect(w.spatial).toBeCloseTo(0.3, 12)
  })

  it.each([
    [{ mass: 6, adduct: 1, spatial: 3 }],
    [{ mass: 0.1, adduct: 0.1, spatial: 9.8 }],
    [{ mass: 0.1, adduct: 0.2, spatial: 9.7 }],
    [{ mass: 3.33, adduct: 3.33, spatial: 3.34 }],
  ])('accepts %o (each ≥ 0.1, summing to 10)', (ratio) => {
    expect(isValidScoreRatio(ratio)).toBe(true)
  })

  it.each([
    [{ mass: 6, adduct: 1, spatial: 2 }],
    [{ mass: 6, adduct: 1, spatial: 3.5 }],
    [{ mass: 0, adduct: 1, spatial: 9 }],
    [{ mass: 0.05, adduct: 0.95, spatial: 9 }],
    [{ mass: NaN, adduct: 1, spatial: 9 }],
  ])('rejects %o', (ratio) => {
    expect(isValidScoreRatio(ratio)).toBe(false)
  })

  it.each([
    [0.1, true],
    [9.8, true],
    [0.09, false],
    [9.81, false],
    [Number.POSITIVE_INFINITY, false],
  ])('limits a single part %s to 0.1–9.8', (value, ok) => {
    expect(isValidScoreRatioPart(value)).toBe(ok)
  })
})

describe('qValues', () => {
  it('is small when decoys score low and close to 1 when they look like targets', () => {
    const targets = Array.from({ length: 100 }, (_, i) => 1 - i / 200)
    const low = qValues(targets, Array(1000).fill(0.1), 10)
    expect(Math.max(...low)).toBeLessThan(0.02)
    const same = qValues(
      targets,
      targets.flatMap((s) => Array(10).fill(s)),
      10,
    )
    expect(same[99]).toBeGreaterThan(0.95)
  })

  it('is monotone in the score', () => {
    const targets = [0.9, 0.5, 0.7, 0.3, 0.8]
    const q = qValues(targets, [0.85, 0.6, 0.4, 0.2], 1)
    const order = [0, 4, 2, 1, 3]
    for (let i = 1; i < order.length; i++) {
      expect(q[order[i]!]!).toBeGreaterThanOrEqual(q[order[i - 1]!]!)
    }
  })
})

describe('matching', () => {
  const mass = new Float64Array([100, 200, 300, 400])
  const plusH = { charge: 1, nmol: 1, shift: 1.007276 }

  it('only walks the part of the database that can reach the feature range', () => {
    expect(dbSliceFor(mass, plusH, 250, 350, { value: 5, unit: 'ppm' })).toEqual([2, 3])
  })

  it('merges sorted candidates with sorted peaks and keeps the closest peak', () => {
    const mz = new Float64Array([201.0072, 201.00728, 301.008, 401.5])
    const hits = matchTargets(mass, [plusH], mz, { value: 5, unit: 'ppm' })
    expect(hits.mol).toEqual([1, 2])
    expect(hits.peak).toEqual([1, 2])
    expect(Math.abs(hits.errPpm[0]!)).toBeLessThan(0.1)
  })
})
