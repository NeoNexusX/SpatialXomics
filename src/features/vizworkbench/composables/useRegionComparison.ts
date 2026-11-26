/**
 * Region comparison composable.
 *
 * Compares two region GROUPS (each a non-empty set of KMeans clusters and/or
 * ROIs) by OR-combining the member masks into one raster per side, then
 * streaming through the entire intensity array once and accumulating per-ion
 * statistics (sum, sum-of-squares, non-zero count) for each side. From these
 * it derives mean intensity, detection rate, both ratios (mean and detection),
 * and a category (A-only / B-only / A-enriched / B-enriched / shared, where
 * "enriched" means a higher detection-rate ratio, threshold user-adjustable
 * and re-applied at display time). The
 * streaming/stats pipeline only ever sees two masks, so group semantics live
 * entirely in mask construction.
 *
 * Continuous mode (ion-major storage): every ion has one intensity value
 * per pixel, indexed by axes/coordinates order. Processed mode (pixel-major):
 * intensities are aggregated into fixed-width m/z bins via
 * streamIonStatsProcessed, so results are per bin rather than per ion.
 *
 * Region inputs use row-major binary rasters before conversion to spectra order.
 * Results are dropped once a region they were computed from disappears (a
 * deleted ROI, a re-run KMeans).
 */

import { ref, computed, reactive, shallowRef, watch, onScopeDispose, type Ref } from 'vue'
import {
  getSharedZarrContext,
  meanSpectrumRef,
} from '@/features/vizworkbench/composables/useZarrIonImage'
import { buildRegionMask, type Region, type RegionGrid } from '@/features/vizworkbench/utils/region'
import {
  COMPARISON_A_RGB,
  COMPARISON_B_RGB,
  type RGB,
} from '@/features/vizworkbench/utils/regionPalette'
import type { DataMode } from '@/services/zarr/types/zarr'
import { t } from '@/i18n'

// ---------- types ----------

export type ComparisonCategory = 'a-only' | 'b-only' | 'a-enriched' | 'b-enriched' | 'shared'

export interface IonComparison {
  ionIndex: number
  mz: number
  meanA: number
  meanB: number
  /** meanA / meanB. Infinity = A-only, 0 = B-only. */
  ratio: number
  /** Detection rate (0-1) in region A. */
  detA: number
  /** Detection rate (0-1) in region B. */
  detB: number
  /** detA / detB. Infinity = A-only, 0 = B-only. Drives the enriched category. */
  detRatio: number
  /** detA >= minDetectionRate at run time. Kept so the category can be
   *  re-derived client-side when the enrichment ratio changes. */
  aPresent: boolean
  /** detB >= minDetectionRate at run time. Same rationale as aPresent. */
  bPresent: boolean
  category: ComparisonCategory
}

/**
 * Category from per-ion stats. Pure so it can run both at scan time and
 * again client-side when the user adjusts the enrichment ratio — the
 * category is the ONLY thing the ratio affects, so re-categorizing never
 * requires re-scanning the data.
 */
function categorize(
  detRatio: number,
  aPresent: boolean,
  bPresent: boolean,
  enrichmentRatio: number,
): ComparisonCategory {
  if (aPresent && !bPresent) return 'a-only'
  if (!aPresent && bPresent) return 'b-only'
  if (detRatio >= enrichmentRatio) return 'a-enriched'
  if (detRatio > 0 && 1 / detRatio >= enrichmentRatio) return 'b-enriched'
  return 'shared'
}

/** m/z bin width (Da) for processed-mode region comparison. */
const PROCESSED_BIN_WIDTH = 0.01

// ---------- composable ----------

export function useRegionComparison(deps: {
  regions: Readonly<Ref<Region[]>>
  grid: Readonly<Ref<RegionGrid>>
  dataMode: Readonly<Ref<DataMode | null>>
}) {
  const regionAIds = ref<string[]>([])
  const regionBIds = ref<string[]>([])
  const minDetectionRate = ref(5) // percentage, 1-50
  const noiseFloorPercentile = ref(5) // percentile of non-zero mean spectrum, 0-20
  /** Detection-rate ratio for "enriched", display-time only (1.1-4). */
  const enrichmentRatio = ref(1.5)
  const comparing = ref(false)
  const progress = ref(0)
  const error = ref<string | null>(null)
  const results = shallowRef<IonComparison[]>([])
  /**
   * What the table displays: raw scan results re-categorized under the
   * current enrichmentRatio. The ratio only relabels rows (a-enriched /
   * b-enriched / shared) — every input it needs (detRatio, aPresent,
   * bPresent) is stored per ion — so adjusting it is instant and never
   * re-triggers the scan.
   */
  const categorizedResults = computed<IonComparison[]>(() => {
    const r = enrichmentRatio.value
    return results.value.map((c) => {
      const cat = categorize(c.detRatio, c.aPresent, c.bPresent, r)
      return cat === c.category ? c : { ...c, category: cat }
    })
  })
  /** Breakdown of how many ions were filtered out and why. */
  const filterStats = ref<{ total: number; kept: number; filtered: number }>({
    total: 0,
    kept: 0,
    filtered: 0,
  })

  /** 每次比较一个代次，取消或开始新比较都会让进行中的那次作废 */
  let currentRun = 0

  // 组件卸载时取消进行中的比较，避免后台扫描继续吃 CPU/网络
  onScopeDispose(() => {
    currentRun++
  })
  /** Ids of the regions behind the current results. */
  let lastRegionIds: string[] = []

  watch(deps.regions, (regions) => {
    const ids = new Set(regions.map((region) => region.id))
    regionAIds.value = regionAIds.value.filter((id) => ids.has(id))
    regionBIds.value = regionBIds.value.filter((id) => ids.has(id))
    if (lastRegionIds.some((id) => !ids.has(id))) reset()
  })

  const regionsById = computed(
    () => new Map(deps.regions.value.map((region) => [region.id, region])),
  )
  const selectedRegionsA = computed(() =>
    regionAIds.value
      .map((id) => regionsById.value.get(id))
      .filter((region) => region !== undefined),
  )
  const selectedRegionsB = computed(() =>
    regionBIds.value
      .map((id) => regionsById.value.get(id))
      .filter((region) => region !== undefined),
  )

  // Group identity colors are fixed (blue A / orange B) regardless of member
  // colors - see regionPalette.ts for the rationale.
  const colorA: RGB = COMPARISON_A_RGB
  const colorB: RGB = COMPARISON_B_RGB

  const canCompare = computed(() => {
    if (comparing.value) return false
    if (!selectedRegionsA.value.length || !selectedRegionsB.value.length) return false
    return !regionAIds.value.some((id) => regionBIds.value.includes(id))
  })

  /**
   * Percentile of a sorted-or-unsorted array of values.
   * @param values values to compute from (will be copied + sorted)
   * @param pct percentile 0-100
   */
  function percentile(values: number[], pct: number): number {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const clamped = Math.max(0, Math.min(100, pct))
    return sorted[Math.floor(sorted.length * (clamped / 100))] ?? 0
  }

  /**
   * Compute the noise floor from the pre-computed mean spectrum (continuous
   * mode). Ions whose region means are both below this floor are treated as
   * noise and excluded.
   */
  function computeNoiseFloor(): number {
    const meanSpec = meanSpectrumRef.value
    if (!meanSpec || !meanSpec.length) return 0
    const temp: number[] = []
    for (let i = 0; i < meanSpec.length; i++) {
      const v = meanSpec[i]!
      if (v > 0 && Number.isFinite(v)) temp.push(v)
    }
    return percentile(temp, noiseFloorPercentile.value)
  }

  // ---------- main compare action ----------

  /**
   * Convert raw per-ion/per-bin stats into IonComparison[] with filtering and
   * categorisation. Shared by continuous and processed paths so the result
   * shape and classification logic stays identical.
   */
  function buildComparisons(
    nItems: number,
    mzAt: (i: number) => number,
    sumA: Float64Array,
    countA: Int32Array,
    sumB: Float64Array,
    countB: Int32Array,
    pixelCountA: number,
    pixelCountB: number,
    noiseFloor: number,
  ): IonComparison[] {
    const minRate = minDetectionRate.value / 100
    const comparisons: IonComparison[] = []
    let filteredByDetection = 0
    let filteredByIntensity = 0

    for (let i = 0; i < nItems; i++) {
      const cntA = countA[i]!
      const cntB = countB[i]!
      const detA = pixelCountA > 0 ? cntA / pixelCountA : 0
      const detB = pixelCountB > 0 ? cntB / pixelCountB : 0

      if (detA < minRate && detB < minRate) {
        filteredByDetection++
        continue
      }

      const meanA = pixelCountA > 0 ? sumA[i]! / pixelCountA : 0
      const meanB = pixelCountB > 0 ? sumB[i]! / pixelCountB : 0

      if (meanA < noiseFloor && meanB < noiseFloor) {
        filteredByIntensity++
        continue
      }

      const aPresent = detA >= minRate
      const bPresent = detB >= minRate
      const detRatio = detB > 0 ? detA / detB : detA > 0 ? Infinity : 0
      const category = categorize(detRatio, aPresent, bPresent, enrichmentRatio.value)

      const ratio = meanB > 0 ? meanA / meanB : meanA > 0 ? Infinity : 0

      comparisons.push({
        ionIndex: i,
        mz: mzAt(i),
        meanA,
        meanB,
        ratio,
        detA,
        detB,
        detRatio,
        aPresent,
        bPresent,
        category,
      })
    }

    filterStats.value = {
      total: nItems,
      kept: comparisons.length,
      filtered: filteredByDetection + filteredByIntensity,
    }

    // 初始排序：检出率比值偏离 1 最多的排最前（富集标准即检出率比值）
    comparisons.sort((a, b) => {
      const logA =
        a.detRatio === Infinity ? Infinity : a.detRatio === 0 ? -Infinity : Math.log2(a.detRatio)
      const logB =
        b.detRatio === Infinity ? Infinity : b.detRatio === 0 ? -Infinity : Math.log2(b.detRatio)
      return Math.abs(logB) - Math.abs(logA)
    })

    return comparisons
  }

  async function compare() {
    if (!canCompare.value) return
    const ctx = getSharedZarrContext()
    const store = ctx.store
    if (!store) {
      error.value = t('vizworkbench.compare.dataNotLoaded')
      return
    }

    const run = ++currentRun
    const cancelled = () => run !== currentRun
    comparing.value = true
    progress.value = 0
    error.value = null
    results.value = []

    try {
      const rasterA = buildRegionMask(selectedRegionsA.value, deps.grid.value)
      const rasterB = buildRegionMask(selectedRegionsB.value, deps.grid.value)
      if (!rasterA || !rasterB) {
        error.value = t('vizworkbench.compare.maskBuildFailed')
        return
      }
      lastRegionIds = [...regionAIds.value, ...regionBIds.value]

      // Convert to 1D coordinates-order masks
      const [maskA, maskB] = await Promise.all([
        store.buildPixelMask(rasterA),
        store.buildPixelMask(rasterB),
      ])
      if (cancelled()) return

      if (maskA.pixelCount === 0 || maskB.pixelCount === 0) {
        error.value = t('vizworkbench.compare.emptyRegion')
        return
      }

      const isProcessed = deps.dataMode.value === 'processed'

      let comparisons: IonComparison[]

      if (isProcessed) {
        // ---- Processed mode: m/z binning ----
        const { bins, binCount } = await store.streamIonStatsProcessed(
          [maskA.mask, maskB.mask],
          PROCESSED_BIN_WIDTH,
          (done, total) => {
            progress.value = Math.round((done / total) * 100)
          },
          cancelled,
        )
        if (cancelled()) return
        if (binCount === 0) {
          error.value = t('vizworkbench.compare.noBins')
          return
        }

        // Noise floor: percentile of non-zero bin means across both regions
        const allMeans: number[] = []
        for (let b = 0; b < binCount; b++) {
          const mA = maskA.pixelCount > 0 ? bins[b]!.sum[0]! / maskA.pixelCount : 0
          const mB = maskB.pixelCount > 0 ? bins[b]!.sum[1]! / maskB.pixelCount : 0
          const mx = Math.max(mA, mB)
          if (mx > 0 && Number.isFinite(mx)) allMeans.push(mx)
        }
        const noiseFloor = percentile(allMeans, noiseFloorPercentile.value)

        comparisons = buildComparisons(
          binCount,
          (i) => bins[i]!.mz,
          Float64Array.from(bins, (b) => b.sum[0]!),
          Int32Array.from(bins, (b) => b.count[0]!),
          Float64Array.from(bins, (b) => b.sum[1]!),
          Int32Array.from(bins, (b) => b.count[1]!),
          maskA.pixelCount,
          maskB.pixelCount,
          noiseFloor,
        )
      } else {
        // ---- Continuous mode: shared m/z axis ----
        // 按 spectra 组只取选中区域内像素的谱，工作量与区域大小成正比。
        const stats = await store.streamRegionStatsBySpectra(
          [maskA.mask, maskB.mask],
          (done, total) => {
            progress.value = Math.round((done / total) * 100)
          },
          cancelled,
        )
        if (cancelled()) return
        if (!stats) {
          error.value = t('vizworkbench.compare.needsPixelMajor')
          return
        }

        const mzAxis = ctx.mzAxis
        if (!mzAxis) {
          error.value = t('vizworkbench.compare.noMzAxis')
          return
        }

        const noiseFloor = computeNoiseFloor()

        comparisons = buildComparisons(
          mzAxis.length,
          (i) => mzAxis[i]!,
          stats[0]!.sum,
          stats[0]!.count,
          stats[1]!.sum,
          stats[1]!.count,
          maskA.pixelCount,
          maskB.pixelCount,
          noiseFloor,
        )
      }

      results.value = comparisons
    } catch (e) {
      if (cancelled()) return
      console.error('[useRegionComparison] compare failed:', e)
      error.value = t('vizworkbench.compare.failed')
    } finally {
      if (!cancelled()) comparing.value = false
    }
  }

  // ---------- cleanup ----------

  function cancel() {
    currentRun++
    comparing.value = false
  }

  function reset() {
    currentRun++
    results.value = []
    error.value = null
    progress.value = 0
    comparing.value = false
    filterStats.value = { total: 0, kept: 0, filtered: 0 }
    lastRegionIds = []
  }

  return reactive({
    // State
    regionAIds,
    regionBIds,
    minDetectionRate,
    noiseFloorPercentile,
    enrichmentRatio,
    comparing,
    progress,
    error,
    results,
    categorizedResults,
    filterStats,
    selectedRegionsA,
    selectedRegionsB,
    canCompare,
    colorA,
    colorB,
    // Actions
    compare,
    cancel,
  })
}

export type RegionComparison = ReturnType<typeof useRegionComparison>
