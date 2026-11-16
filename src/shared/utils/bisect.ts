/** 升序数组里第一个 ≥ x 的下标 */
export function lowerBound(arr: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 升序数组里第一个 > x 的下标 */
export function upperBound(arr: ArrayLike<number>, x: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 按 key 升序的数组里第一个 key ≥ x 的下标 */
export function lowerBoundBy<T>(arr: readonly T[], key: (item: T) => number, x: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (key(arr[mid]!) < x) lo = mid + 1
    else hi = mid
  }
  return lo
}
