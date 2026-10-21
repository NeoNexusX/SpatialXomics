import { describe, expect, it } from 'vitest'
import { hotspotClip } from '../chaos'

/** 截顶的定义：非零像素升序排好，第 ⌈p% · n⌉ 个值作上限 */
function reference(img: Float32Array, percentile: number): Float32Array {
  const nz = Float32Array.from(img.filter((v) => v > 0)).sort()
  if (nz.length === 0) return img
  const idx = Math.min(nz.length - 1, Math.ceil((percentile / 100) * nz.length) - 1)
  const cap = nz[Math.max(0, idx)]!
  return img.map((v) => (v > cap ? cap : v))
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

describe('hotspotClip', () => {
  it('caps at the same percentile value as sorting the non-zero pixels', () => {
    const rnd = lcg(1)
    const cases: Float32Array[] = [
      new Float32Array(0),
      new Float32Array(10),
      Float32Array.of(5),
      Float32Array.of(3, 1),
      // 已排序 / 逆序
      Float32Array.from({ length: 1000 }, (_, i) => i + 1),
      Float32Array.from({ length: 1000 }, (_, i) => 1000 - i),
      // 全相同、大量重复和 0
      new Float32Array(777).fill(2),
      Float32Array.from({ length: 5000 }, () => Math.floor(rnd() * 4)),
      // 稀疏 + 少量热点
      Float32Array.from({ length: 4096 }, () =>
        rnd() < 0.3 ? 0 : rnd() < 0.01 ? 1e6 * rnd() : rnd(),
      ),
      // 含负值
      Float32Array.from({ length: 3000 }, () => (rnd() - 0.3) * 100),
    ]
    for (const img of cases) {
      for (const p of [0, 1, 50, 99, 100]) expect(hotspotClip(img, p)).toEqual(reference(img, p))
    }
  })
})
