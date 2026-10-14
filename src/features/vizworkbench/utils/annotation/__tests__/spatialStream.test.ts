import { describe, expect, it } from 'vitest'
import positiveCsv from '../__fixtures__/peaks.positive.csv?raw'
import { buildTestDb } from '../__fixtures__/testDb'
import { testPeaks } from '../__fixtures__/testPeaks'
import { countNonZero, hotspotClip, measureOfChaos } from '../chaos'
import { pairKey, pearsonUnionMask } from '../pearson'
import { AnnotationSession, compareIons } from '../pipeline'
import { colocScore, DEFAULT_ENGINE_CONFIG, spatialScore, totalScore } from '../score'
import type { AdductId } from '@/shared/chem/adducts'
import type { AnnotationResult, IonAnnotation } from '@/features/vizworkbench/types/annotation'

const W = 24
const H = 20
const CONFIG = { ...DEFAULT_ENGINE_CONFIG, seed: 7 }
const ADDUCTS: { id: AdductId; fit: number }[] = [
  { id: 'M+H', fit: 1 },
  { id: 'M+Na', fit: 0.9 },
  { id: 'M+K', fit: 0.9 },
]
const db = buildTestDb()

function newSession(retainBytes?: number) {
  const session = new AnnotationSession(
    {
      db,
      peaks: testPeaks(positiveCsv),
      adducts: ADDUCTS,
      tolerance: { value: 5, unit: 'ppm', origin: 'user' },
      config: CONFIG,
    },
    { retainBytes },
  )
  return { session, result: session.run() }
}

/** 每个峰一张确定的图：几种空间模式（同模式的峰之间相关高）加噪声，部分峰几乎是空的 */
function imageFor(axis: number): Float32Array {
  let h = Math.imul(axis + 1, 0x9e3779b1) >>> 0
  const rnd = () => (h = (Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32
  const img = new Float32Array(W * H)
  if (axis % 7 === 6) {
    for (let i = 0; i < 5; i++) img[Math.floor(rnd() * img.length)] = 1
    return img
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pattern = [x < W / 2 ? 1 : 0.2, Math.exp(-((x - 8) ** 2 + (y - 6) ** 2) / 20), y / H][
        axis % 3
      ]!
      img[y * W + x] = rnd() < 0.15 ? 0 : Math.max(0, pattern + (rnd() - 0.5) * 0.3)
    }
  }
  return img
}

function axesOf(result: AnnotationResult): number[] {
  return [...new Set(result.jobs.flatMap((j) => j.axisIndices))].sort((a, b) => a - b)
}

/** 按给定顺序送图，重读请求立即补送；把 patch 合进行表，返回最终的行、峰对 r 和送图次数 */
function deliverAll(
  session: AnnotationSession,
  result: AnnotationResult,
  order: number[],
  image: (axis: number) => Float32Array | null = imageFor,
) {
  const ions = new Map(result.ions.map((ion) => [ion.id, ion]))
  const pairR = new Map<string, number | null>()
  let finals = 0
  let sent = 0
  const urgent: number[] = []
  const send = (axis: number) => {
    sent++
    const { patch, reread } = session.applyImage(axis, image(axis), W, H)
    urgent.push(...reread)
    if (!patch) return
    for (const u of patch.ions) {
      const ion = ions.get(u.id)!
      ions.set(u.id, {
        ...ion,
        scores: u.scores ?? ion.scores,
        q: u.q !== undefined ? u.q : ion.q,
        rank: u.rank ?? ion.rank,
      })
    }
    for (const [k, r] of patch.pairR) pairR.set(k, r)
    if (patch.final) finals++
  }
  for (const axis of order) {
    send(axis)
    while (urgent.length > 0) send(urgent.shift()!)
  }
  return { ions, pairR, finals, sent }
}

function shuffled(list: number[], seed: number): number[] {
  const out = [...list]
  let h = seed
  for (let i = out.length - 1; i > 0; i--) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
    const j = h % (i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

describe('AnnotationSession.applyImage', () => {
  it('gives the same final scores, q and ranks whatever order the images arrive in', () => {
    const base = newSession()
    const axes = axesOf(base.result)
    const expected = deliverAll(base.session, base.result, axes)
    expect(expected.finals).toBe(1)
    expect(expected.sent).toBe(axes.length)
    const image = W * H * 4
    const runs = [
      { order: [...axes].reverse() },
      { order: shuffled(axes, 1) },
      // 一张图也不留：峰对要靠重读才能算
      { order: axes, retainBytes: 0 },
      { order: shuffled(axes, 2), retainBytes: 3 * image },
    ]
    const sent: number[] = []
    for (const { order, retainBytes } of runs) {
      const { session, result } = newSession(retainBytes)
      const got = deliverAll(session, result, order)
      expect(got.finals).toBe(1)
      expect(got.ions).toEqual(expected.ions)
      expect(got.pairR).toEqual(expected.pairR)
      sent.push(got.sent)
    }
    // 不留图时确实发生了重读
    expect(sent[2]).toBeGreaterThan(axes.length)
  })

  it('scores each ion from its own image and the images of its sibling ions', () => {
    const { session, result } = newSession()
    const { ions, pairR } = deliverAll(session, result, axesOf(result))
    const { minPixels } = CONFIG
    const clipOf = (axis: number) => hotspotClip(imageFor(axis), 99)
    const chaosOf = (axis: number) => {
      const clip = clipOf(axis)
      const chaos = countNonZero(clip) < minPixels ? 0 : (measureOfChaos(clip, W, H) ?? 0)
      return chaos === 1 ? 0 : chaos
    }
    const molecules = new Map(result.molecules.map((m) => [m.id, m]))
    const done = [...ions.values()].filter((ion) => ion.scores.spatialState === 'done')
    expect(done.length).toBe(result.ions.length)
    for (const ion of done) {
      let coloc: number | null = null
      for (const id of molecules.get(ion.moleculeId)!.ionIds) {
        const other = ions.get(id)!.axisIndex
        if (id === ion.id || other === ion.axisIndex) continue
        const r = pearsonUnionMask(clipOf(ion.axisIndex), clipOf(other), minPixels)
        expect(pairR.get(pairKey(ion.axisIndex, other))).toBe(r)
        if (r != null) coloc = Math.max(coloc ?? 0, colocScore(r))
      }
      const chaos = chaosOf(ion.axisIndex)
      const spatial = spatialScore(chaos, coloc, CONFIG.spatialWeights)
      expect(ion.scores).toEqual({
        mass: ion.scores.mass,
        adduct: ion.fit,
        chaos,
        coloc,
        spatial,
        spatialState: 'done',
        total: totalScore(ion.scores.mass, ion.fit, spatial, CONFIG),
      })
    }
    // 最终排名按总分重排
    const ranked = [...ions.values()].sort(compareIons)
    expect(ranked.map((ion) => ion.rank)).toEqual(ranked.map((_, i) => i + 1))
  })

  it('asks for a released image again when its partner peak arrives', () => {
    const { session, result } = newSession(0)
    const job = result.jobs.find((j) => j.axisIndices.length >= 2)!
    const [a, b] = [...job.axisIndices].sort((x, y) => x - y) as [number, number]
    expect(session.applyImage(a, imageFor(a), W, H).reread).toEqual([])
    expect(session.applyImage(b, imageFor(b), W, H).reread).toContain(a)
    const { patch } = session.applyImage(a, imageFor(a), W, H)
    expect(patch!.pairR.map(([key]) => key)).toContain(pairKey(a, b))
  })

  it('marks ions on an unreadable peak as errors and still finishes', () => {
    const { session, result } = newSession()
    const job = result.jobs.find((j) => j.axisIndices.length >= 2)!
    const bad = job.axisIndices[0]!
    const { ions, pairR, finals } = deliverAll(session, result, axesOf(result), (axis) =>
      axis === bad ? null : imageFor(axis),
    )
    expect(finals).toBe(1)
    const onBad = [...ions.values()].filter((ion) => ion.axisIndex === bad)
    expect(onBad.length).toBeGreaterThan(0)
    for (const ion of onBad) {
      expect(ion.scores.spatialState).toBe('error')
      expect(ion.scores.spatial).toBeNull()
    }
    const others: IonAnnotation[] = [...ions.values()].filter((ion) => ion.axisIndex !== bad)
    for (const ion of others) expect(ion.scores.spatialState).toBe('done')
    for (const key of pairR.keys()) expect(key.split('|').map(Number)).not.toContain(bad)
  })

  it('ignores repeated images and peaks outside every job', () => {
    const { session, result } = newSession()
    const axes = axesOf(result)
    deliverAll(session, result, axes)
    expect(session.applyImage(axes[0]!, imageFor(axes[0]!), W, H)).toEqual({
      patch: null,
      reread: [],
    })
    expect(session.applyImage(-1, imageFor(0), W, H)).toEqual({ patch: null, reread: [] })
  })
})
