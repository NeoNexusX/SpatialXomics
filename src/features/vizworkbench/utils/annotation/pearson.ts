/** 峰对（两个 zarr 轴下标）的缓存键，与顺序无关 */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * 两张离子图的空间共定位：Pearson 相关系数。
 *
 * 只在至少一张图非零的像素上计算——组织外两张图都是 0，把这些像素算进去会把 r 抬高。
 * 调用方先对两张图做热点截顶（chaos.hotspotClip），避免个别极亮像素主导 r。
 * 有效像素少于 minPixels 或任一张图方差为 0 → null。
 */
export function pearsonUnionMask(a: Float32Array, b: Float32Array, minPixels = 20): number | null {
  if (a.length !== b.length) return null
  let n = 0
  let sa = 0
  let sb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x > 0 || y > 0) {
      n++
      sa += x
      sb += y
    }
  }
  if (n < minPixels) return null
  const ma = sa / n
  const mb = sb / n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x > 0 || y > 0) {
      const dx = x - ma
      const dy = y - mb
      cov += dx * dy
      va += dx * dx
      vb += dy * dy
    }
  }
  if (!(va > 0) || !(vb > 0)) return null
  const r = cov / Math.sqrt(va * vb)
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null
}
