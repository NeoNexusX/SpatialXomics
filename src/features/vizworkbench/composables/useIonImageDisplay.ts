import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { getColormapStops } from '@/shared/viz/colormapLut'
import type { ZarrSession } from './useZarrIonImage'

const DEFAULT_COLORMAP = 'inferno'

function computeRange(matrix: Float32Array) {
  // Collect non-zero values, then sort a Float32Array copy with the native
  // typed-array numeric sort (identical ordering to (a, b) => a - b for the
  // finite, non-negative intensity values we handle here).
  const nonZeroVals: number[] = []
  for (let i = 0; i < matrix.length; i++) {
    const v = matrix[i]!
    if (Number.isFinite(v) && v > 0) nonZeroVals.push(v)
  }
  if (!nonZeroVals.length)
    return { displayMin: 0, displayMax: 1, dataMax: 1, sorted: [] as number[] }
  const sortedF32 = Float32Array.from(nonZeroVals).sort()
  const p95 = sortedF32[Math.floor(sortedF32.length * 0.95)] ?? sortedF32[sortedF32.length - 1]!
  const dataMax = sortedF32[sortedF32.length - 1]!
  return { displayMin: 0, displayMax: p95, dataMax, sorted: Array.from(sortedF32) }
}

/** Short intensity label for the range strip and the spectrum header. */
export function formatIonValue(value: number): string {
  if (value === 0) return '0'
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + 'e6'
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + 'e3'
  if (Math.abs(value) < 0.01) return value.toExponential(1)
  return value.toFixed(1)
}

/**
 * How the single image is drawn: colormap, intensity scale (TIC normalization
 * included), gamma and the display range. `matrix` is the image the page
 * shows; the ROI statistics and the collect tool read it too.
 */
export function useIonImageDisplay(zarr: ZarrSession) {
  const colormap = ref(DEFAULT_COLORMAP)
  const intensityScale = ref('linear')
  const gamma = ref(1)

  /** The image divided by TIC while TIC normalization is on. Processed data already is a TIC image. */
  const matrix = computed(() => {
    const source = zarr.imageMatrix
    const factors = zarr.normalizationFactors
    if (
      !source ||
      !factors ||
      intensityScale.value === 'linear' ||
      intensityScale.value === 'log' ||
      zarr.isProcessed
    )
      return source
    const result = new Float32Array(source.length)
    for (let i = 0; i < source.length; i++) {
      const denominator = factors[i]!
      result[i] = denominator > 0 ? source[i]! / denominator : 0
    }
    return result
  })

  // ---- Display range ----

  const globalMin = ref(0)
  const globalMax = ref(1)
  const dataMax = ref(1)
  /** Sorted non-zero intensities; replaced per image, never mutated. */
  const sortedNonZero = shallowRef<number[]>([])
  const displayMin = ref(0)
  const displayMax = ref(1)
  /** User's manual display range as fractions of [globalMin, globalMax]
   *  (0..1; typed inputs may fall outside). Once set, a matrix change (m/z
   *  switch, TIC toggle) re-applies these fractions to the new data span
   *  instead of snapping back to the auto range - a max dragged to 100%
   *  stays at 100% of whatever loads next. Cleared by resetRange. */
  let userRange: { lo: number; hi: number } | null = null
  /** True while displayMin/displayMax are assigned programmatically
   *  (applyRange / the matrix watcher), so the recording watch below
   *  doesn't file those assignments as user input. */
  let applyingProgrammatic = false

  const span = computed(() => globalMax.value - globalMin.value || 1)

  const gradientCss = computed(() => {
    const stops = getColormapStops(colormap.value).map((color) => `rgb(${color.join(' ')})`)
    const darkest = stops[0]!
    const brightest = stops[stops.length - 1]!
    const lo = ((displayMin.value - globalMin.value) / span.value) * 100
    const hi = ((displayMax.value - globalMin.value) / span.value) * 100
    const inner = stops
      .map((color, index) => {
        const pct = lo + ((hi - lo) * index) / (stops.length - 1)
        return `${color} ${pct}%`
      })
      .join(', ')
    return `linear-gradient(to top, ${darkest} 0%, ${darkest} ${lo}%, ${inner}, ${brightest} ${hi}%, ${brightest} 100%)`
  })

  const intensityHistogram = computed(() => {
    const bins = 10
    const hist: number[] = new Array(bins).fill(0)
    const values = matrix.value
    if (!values) return hist
    const range = dataMax.value || 1
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!
      if (!Number.isFinite(value)) continue
      const index = Math.min(bins - 1, Math.max(0, Math.floor((value / range) * bins)))
      hist[index] = (hist[index] ?? 0) + 1
    }
    return hist
  })

  const imageInfo = computed(() => {
    const values = matrix.value
    if (!values || !values.length) {
      return { pixels: '--', nonZero: '--', totalIon: '--' }
    }
    let nonZero = 0
    let total = 0
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!
      if (!Number.isFinite(value)) continue
      if (value > 0) nonZero++
      total += value
    }
    return {
      pixels: `${zarr.ionCols} × ${zarr.ionRows}`,
      nonZero: ((nonZero / values.length) * 100).toFixed(1) + '%',
      totalIon: total.toExponential(2),
    }
  })

  /** Finite min – max of the image, for the spectrum header. */
  const intensityRange = computed(() => {
    const values = matrix.value
    if (!values) return '--'
    let minValue = Infinity
    let maxValue = -Infinity
    for (let i = 0; i < values.length; i++) {
      const value = values[i]!
      if (Number.isFinite(value)) {
        if (value < minValue) minValue = value
        if (value > maxValue) maxValue = value
      }
    }
    return `${formatIonValue(minValue === Infinity ? 0 : minValue)} – ${formatIonValue(
      maxValue === -Infinity ? 0 : maxValue,
    )}`
  })

  /** Publish a matrix's range; a manual range survives as fractions of the new span. */
  function applyRange(range: ReturnType<typeof computeRange>) {
    applyingProgrammatic = true
    globalMin.value = range.displayMin
    globalMax.value = range.dataMax
    dataMax.value = range.dataMax
    sortedNonZero.value = range.sorted
    if (userRange) {
      const span = globalMax.value - globalMin.value || 1
      displayMin.value = globalMin.value + userRange.lo * span
      displayMax.value = globalMin.value + userRange.hi * span
    } else {
      displayMin.value = range.displayMin
      displayMax.value = range.displayMax
    }
    applyingProgrammatic = false
  }

  function resetRange() {
    userRange = null
    if (matrix.value) applyRange(computeRange(matrix.value))
  }

  // Keep the user's manual range (e.g. a max at 100%) across matrices; only Reset restores auto.
  watch(
    matrix,
    (values) => {
      if (values) applyRange(computeRange(values))
    },
    { immediate: true },
  )

  // Record manual display-range edits (strip drag / click / numeric input) as
  // fractions of the current global range. Sync flush so the programmatic
  // flag above is still set when applyRange's assignments pass through here.
  watch(
    [displayMin, displayMax],
    ([lo, hi]) => {
      if (applyingProgrammatic) return
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return
      const span = globalMax.value - globalMin.value || 1
      userRange = { lo: (lo - globalMin.value) / span, hi: (hi - globalMin.value) / span }
    },
    { flush: 'sync' },
  )

  // ---- Controls ----

  function setColormap(value: string) {
    colormap.value = value
  }

  function setGamma(value: number) {
    gamma.value = value
  }

  function setDisplayMin(value: number) {
    displayMin.value = value
  }

  function setDisplayMax(value: number) {
    displayMax.value = value
  }

  /** TIC normalization loads its factors on demand; the other scales switch at once. */
  async function setIntensityScale(value: string) {
    intensityScale.value = value
    if (value === 'tic') await zarr.loadNormalization('tic')
    else zarr.clearNormalization()
  }

  /** Default colormap, linear scale, gamma 1 and the automatic range. */
  function reset() {
    colormap.value = DEFAULT_COLORMAP
    intensityScale.value = 'linear'
    gamma.value = 1
    zarr.clearNormalization()
    resetRange()
  }

  // Datasets without stats/tic (older or processed data) hide the TIC option;
  // fall back to Linear rather than show a scale the image no longer uses.
  watch(
    () => zarr.hasTic,
    (hasTic) => {
      if (!hasTic && intensityScale.value === 'tic') {
        intensityScale.value = 'linear'
        zarr.clearNormalization()
      }
    },
  )

  return reactive({
    colormap,
    intensityScale,
    gamma,
    matrix,
    globalMin,
    globalMax,
    displayMin,
    displayMax,
    sortedNonZero,
    gradientCss,
    intensityHistogram,
    imageInfo,
    intensityRange,
    setColormap,
    setIntensityScale,
    setGamma,
    setDisplayMin,
    setDisplayMax,
    resetRange,
    reset,
  })
}

export type IonImageDisplay = ReturnType<typeof useIonImageDisplay>
