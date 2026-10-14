/**
 * 空间混乱度（ρ_chaos，level-set 方法）与热点截顶。
 *
 * 离子图按最大值归一化，取 nlevels 个强度阈值（0, 1/n, …, (n−1)/n）逐层二值化；
 * 每层先十字膨胀、再 3×3 腐蚀（图像边界外按 0 处理），然后数 4-连通区域。
 * 混乱度 = 1 − 各层区域总数 / (非零像素数 × nlevels)：分布成块 → 区域少 → 分高；
 * 散点噪声 → 区域多 → 分低。
 */

/** 十字结构元膨胀，边界外视为 0 */
function dilateCross(bw: Uint8Array, w: number, h: number, out: Uint8Array): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      out[i] =
        bw[i] ||
        (x > 0 && bw[i - 1]) ||
        (x < w - 1 && bw[i + 1]) ||
        (y > 0 && bw[i - w]) ||
        (y < h - 1 && bw[i + w])
          ? 1
          : 0
    }
  }
}

/** 3×3 全 1 结构元腐蚀，边界外视为 0 */
function erodeSquare(bw: Uint8Array, w: number, h: number, out: Uint8Array): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = 1
      for (let dy = -1; dy <= 1 && keep; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || !bw[ny * w + nx]) {
            keep = 0
            break
          }
        }
      }
      out[y * w + x] = keep
    }
  }
}

/** 4-连通区域个数 */
function countComponents(bw: Uint8Array, w: number, h: number): number {
  const seen = new Uint8Array(bw.length)
  const stack: number[] = []
  let count = 0
  for (let i = 0; i < bw.length; i++) {
    if (!bw[i] || seen[i]) continue
    count++
    seen[i] = 1
    stack.push(i)
    while (stack.length > 0) {
      const p = stack.pop()!
      const x = p % w
      const y = (p / w) | 0
      if (x > 0 && bw[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1
        stack.push(p - 1)
      }
      if (x < w - 1 && bw[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1
        stack.push(p + 1)
      }
      if (y > 0 && bw[p - w] && !seen[p - w]) {
        seen[p - w] = 1
        stack.push(p - w)
      }
      if (y < h - 1 && bw[p + w] && !seen[p + w]) {
        seen[p + w] = 1
        stack.push(p + w)
      }
    }
  }
  return count
}

/**
 * ρ_chaos。全零图像、或各层区域数完全相同（如 1 像素散点被腐蚀光）→ null；
 * 恰为 1 的退化结果由调用方记为 0。
 */
export function measureOfChaos(
  img: Float32Array,
  w: number,
  h: number,
  nlevels = 10,
): number | null {
  if (img.length !== w * h || nlevels < 1) return null
  let max = 0
  let notNull = 0
  for (let i = 0; i < img.length; i++) {
    const v = img[i]!
    if (v > 0) notNull++
    if (v > max) max = v
  }
  if (notNull === 0 || !(max > 0)) return null

  const bw = new Uint8Array(img.length)
  const tmp = new Uint8Array(img.length)
  let objSum = 0
  let first = -1
  let allSame = true
  for (let k = 0; k < nlevels; k++) {
    const level = k / nlevels
    for (let i = 0; i < img.length; i++) bw[i] = img[i]! / max > level ? 1 : 0
    dilateCross(bw, w, h, tmp)
    erodeSquare(tmp, w, h, bw)
    const n = countComponents(bw, w, h)
    if (first < 0) first = n
    else if (n !== first) allSame = false
    objSum += n
  }
  if (allSame) return null
  const score = 1 - objSum / (notNull * nlevels)
  return Number.isFinite(score) ? score : null
}

/**
 * a 里第 k 小（0 起）的值，与升序排序后的 a[k] 相同；会原地打乱 a。a 里不能有 NaN。
 * 快速选择平均 O(n)，比整体排序快数倍；分区轮数异常多时（刻意构造的输入）改为排序剩下的区间。
 */
function selectKth(a: Float32Array, k: number): number {
  let lo = 0
  let hi = a.length - 1
  let rounds = 64 + 2 * Math.ceil(Math.log2(a.length + 1))
  while (hi > lo) {
    if (--rounds < 0) {
      a.subarray(lo, hi + 1).sort()
      break
    }
    // 三数取中作枢轴：已排好序或分段有序的数据不会退化
    const x = a[lo]!
    const y = a[(lo + hi) >>> 1]!
    const z = a[hi]!
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y
    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i]! < pivot) i++
      while (a[j]! > pivot) j--
      if (i <= j) {
        const t = a[i]!
        a[i++] = a[j]!
        a[j--] = t
      }
    }
    // [lo, j] ≤ 枢轴，[i, hi] ≥ 枢轴，两者之间都等于枢轴
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else return pivot
  }
  return a[k]!
}

/** 热点去除：把超过非零像素第 percentile 百分位的值截到该百分位 */
export function hotspotClip(img: Float32Array, percentile = 99): Float32Array {
  const n = countNonZero(img)
  if (n === 0) return img
  const nz = new Float32Array(n)
  for (let i = 0, k = 0; i < img.length; i++) if (img[i]! > 0) nz[k++] = img[i]!
  const idx = Math.min(n - 1, Math.ceil((percentile / 100) * n) - 1)
  const cap = selectKth(nz, Math.max(0, idx))
  const out = new Float32Array(img.length)
  for (let i = 0; i < img.length; i++) out[i] = img[i]! > cap ? cap : img[i]!
  return out
}

/** 非零像素数 */
export function countNonZero(img: Float32Array): number {
  let n = 0
  for (let i = 0; i < img.length; i++) if (img[i]! > 0) n++
  return n
}
