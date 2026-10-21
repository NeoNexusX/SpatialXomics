/**
 * target-decoy FDR → 每行的 q 值。
 *
 *   FDR(s) = ((总分 ≥ s 的 decoy 数 + 1) / R) / 总分 ≥ s 的目标数
 *
 * R 为 decoy 重复次数（每次重复的假设数与目标相同，所以 decoy 计数要除以 R）；分子加 1 是
 * 保守修正，避免 q = 0。按分数从低到高取累计最小值得到单调的 q。
 */
export function qValues(
  targetScores: ArrayLike<number>,
  decoyScores: ArrayLike<number>,
  replicates: number,
): Float64Array {
  const nT = targetScores.length
  const q = new Float64Array(nT)
  if (nT === 0) return q
  const order = Array.from({ length: nT }, (_, i) => i).sort(
    (a, b) => targetScores[b]! - targetScores[a]!,
  )
  const decoys = Float64Array.from(decoyScores).sort().reverse()
  const R = Math.max(1, replicates)

  const fdr = new Float64Array(nT)
  let d = 0
  let k = 0
  for (let pos = 0; pos < nT; pos++) {
    const s = targetScores[order[pos]!]!
    // 并列分数：目标数取到并列块末尾
    while (k < nT && targetScores[order[k]!]! >= s) k++
    while (d < decoys.length && decoys[d]! >= s) d++
    fdr[pos] = Math.min(1, (d + 1) / R / k)
  }
  let running = 1
  for (let pos = nT - 1; pos >= 0; pos--) {
    running = Math.min(running, fdr[pos]!)
    q[order[pos]!] = running
  }
  return q
}
