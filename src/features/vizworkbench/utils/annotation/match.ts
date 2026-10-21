/**
 * 候选生成 + 峰匹配。
 *
 * 库按中性质量升序；固定加合物时 m/z = (nmol·M + shift)/charge 是 M 的单调递增函数，
 * 候选 m/z 天然有序，直接和（升序的）峰做双指针归并，不需要排序，也不需要把
 * 候选数组生成出来。每个加合物先按峰的 m/z 范围在库里裁出下标区间，只遍历这一段。
 *
 * decoy 每个分子分到的元素不同，候选不再整体有序，逐个候选二分查找窗口起点。
 */

import type { Tolerance } from '@/features/vizworkbench/types/annotation'
import { lowerBound, upperBound } from './bisect'
import { matchableRange, matchWindow } from './tolerance'

export interface MatchAdduct {
  charge: number
  nmol: number
  shift: number
}

/** 匹配结果（列式）：第 k 条命中 = 分子 mol[k] 以加合物 adduct[k] 落在峰 peak[k] */
export interface Hits {
  mol: number[]
  adduct: number[]
  peak: number[]
  theo: number[]
  errPpm: number[]
}

export function emptyHits(): Hits {
  return { mol: [], adduct: [], peak: [], theo: [], errPpm: [] }
}

function pushHit(h: Hits, mol: number, adduct: number, peak: number, theo: number, obs: number) {
  h.mol.push(mol)
  h.adduct.push(adduct)
  h.peak.push(peak)
  h.theo.push(theo)
  h.errPpm.push(((obs - theo) / theo) * 1e6)
}

/** 本加合物下，库里理论 m/z 可能落进峰的 m/z 范围的下标区间 [i0, i1) */
export function dbSliceFor(
  mass: Float64Array,
  a: MatchAdduct,
  mzMin: number,
  mzMax: number,
  tol: Pick<Tolerance, 'value' | 'unit'>,
): [number, number] {
  const [cLo, cHi] = matchableRange(mzMin, mzMax, tol)
  const mLo = (a.charge * cLo - a.shift) / a.nmol
  const mHi = (a.charge * cHi - a.shift) / a.nmol
  return [lowerBound(mass, mLo), upperBound(mass, mHi)]
}

/** 窗口 [lo, hi] 内离 c 最近的峰（从 start 往右扫）；没有返回 -1 */
function closestInWindow(mz: Float64Array, start: number, hi: number, c: number): number {
  let best = -1
  let bestD = Infinity
  for (let q = start; q < mz.length && mz[q]! <= hi; q++) {
    const d = Math.abs(mz[q]! - c)
    if (d < bestD) {
      bestD = d
      best = q
    }
  }
  return best
}

/** 目标匹配：每个加合物在裁出的库区间里与峰双指针归并 */
export function matchTargets(
  mass: Float64Array,
  adducts: readonly MatchAdduct[],
  mz: Float64Array,
  tol: Pick<Tolerance, 'value' | 'unit'>,
): Hits {
  const hits = emptyHits()
  if (mz.length === 0 || mass.length === 0) return hits
  const mzMin = mz[0]!
  const mzMax = mz[mz.length - 1]!
  adducts.forEach((a, ai) => {
    const [i0, i1] = dbSliceFor(mass, a, mzMin, mzMax, tol)
    let p = 0
    for (let i = i0; i < i1; i++) {
      const c = (a.nmol * mass[i]! + a.shift) / a.charge
      const [lo, hi] = matchWindow(c, tol)
      // 窗口下界随 i 单调右移，指针不回退
      while (p < mz.length && mz[p]! < lo) p++
      if (p >= mz.length) break
      const best = closestInWindow(mz, p, hi, c)
      if (best >= 0) pushHit(hits, i, ai, best, c, mz[best]!)
    }
  })
  return hits
}

/**
 * decoy 匹配：shiftOf(i) 给出分子 i 在本组（某目标加合物、某次重复）里的 decoy 位移。
 * 匹配规则与目标完全一致，只是位移不同。
 */
export function matchDecoys(
  mass: Float64Array,
  target: MatchAdduct,
  adductIndex: number,
  shiftOf: (mol: number) => number,
  mz: Float64Array,
  tol: Pick<Tolerance, 'value' | 'unit'>,
  out: Hits,
): void {
  if (mz.length === 0) return
  const [cLo, cHi] = matchableRange(mz[0]!, mz[mz.length - 1]!, tol)
  for (let i = 0; i < mass.length; i++) {
    const c = (target.nmol * mass[i]! + shiftOf(i)) / target.charge
    if (c < cLo || c > cHi) continue
    const [lo, hi] = matchWindow(c, tol)
    const best = closestInWindow(mz, lowerBound(mz, lo), hi, c)
    if (best >= 0) pushHit(out, i, adductIndex, best, c, mz[best]!)
  }
}
