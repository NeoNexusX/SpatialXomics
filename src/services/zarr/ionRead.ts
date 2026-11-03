import { ZARR_STORE } from '@/shared/config/defaults'
import { lowerBound, upperBound } from '@/shared/utils/bisect'
import { mzAxisRef, store, ionDims, dataModeRef } from './zarrSharedState'

// ---- Helper: find m/z range indices (continuous mode) ----

export function findMzRangeIndices(targetIdx: number, tolerance: number): number[] {
  const mzAxis = mzAxisRef.value
  if (!mzAxis) return []
  const target = mzAxis[targetIdx]
  if (target == null) return [targetIdx]

  const start = lowerBound(mzAxis, target - tolerance)
  const end = upperBound(mzAxis, target + tolerance)

  if (start >= end) return [targetIdx]
  return Array.from({ length: end - start }, (_, offset) => start + offset)
}

// ---- Helper: load ion image slice sum (continuous mode) ----

export async function loadIonSliceSum(indices: number[]): Promise<Float32Array> {
  const s = store
  if (!s) throw new Error('Zarr store is unavailable')
  if (!indices.length) throw new Error('No m/z indices were selected')
  if (!ionDims.value) throw new Error('Ion-image dimensions are unavailable')
  const { width, height } = ionDims.value
  const matrix = await s.getSummedIonImageByMzIndices(indices)
  if (matrix.length !== width * height) {
    throw new Error(`ion matrix size mismatch: expected ${width * height}, got ${matrix.length}`)
  }
  return matrix
}

/**
 * Load one ion image by m/z index WITHOUT touching the single-image state
 * (`ionMatrix` / `selectedMzIndex`). Used by the multi-channel overlay, which
 * keeps its own per-channel matrices.
 *
 * Throws on any failure (missing store, non-continuous data, invalid index,
 * or a store swap while the read was in flight) — callers surface the message
 * on the channel row.
 */
export async function loadIonMatrixByIndex(idx: number, tolerance: number): Promise<Float32Array> {
  if (dataModeRef.value !== 'continuous') {
    throw new Error('Multi-ion overlay is only available for continuous data')
  }
  const requestStore = store
  const axis = mzAxisRef.value
  if (!requestStore || !axis) throw new Error('Zarr store is unavailable')
  if (idx < 0 || idx >= axis.length) throw new Error('Invalid m/z index')
  // 钳位容差到 [min, max]，与 loadForMzIndex 保持一致的语义
  const tol = Math.min(ZARR_STORE.maxMzTolerance, Math.max(ZARR_STORE.minMzTolerance, tolerance))
  const matrix = await loadIonSliceSum(findMzRangeIndices(idx, tol))
  // 读取期间 store 被 dispose/替换（换 run 或离开页面）→ 结果作废
  if (!store || store !== requestStore) throw new Error('Zarr session changed')
  return matrix
}

// ---- Binary search in m/z axis ----

export function findClosestMzIndex(target: number): number {
  const a = mzAxisRef.value
  if (!a || !a.length) return -1
  if (target <= a[0]!) return 0
  const lastIndex = a.length - 1
  if (target >= a[lastIndex]!) return lastIndex

  const lo = lowerBound(a, target)
  const prev = lo - 1
  return Math.abs(target - a[prev]!) <= Math.abs(a[lo]! - target) ? prev : lo
}
