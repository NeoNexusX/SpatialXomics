import { computed, reactive, ref, shallowRef, watch, onBeforeUnmount, type Ref } from 'vue'
import { getZarrUrl } from '@/services/zarr/api/zarrAccessApi'
import { createClustering } from '@/services/clustering/api/clusteringApi'
import type { ClusteringTaskResponse, UmapEmbedding } from '@/services/clustering/types/clustering'
import { ClusteringZarrStore } from '@/services/clustering/clusteringZarrStore'
import {
  computeKmeansFromUmap,
  embeddingWithin,
  preloadKmeans,
} from '@/features/vizworkbench/utils/kmeans'
import type { KmeansRegion, RegionGrid } from '@/features/vizworkbench/utils/region'
import { kmeansColor, rgbCss } from '@/features/vizworkbench/utils/regionPalette'
import { dataModeRef } from '@/features/vizworkbench/composables/useZarrIonImage'
import { useToast } from '@/shared/composables/useToast'
import { downloadCanvas } from '@/shared/utils/download'
import { extractBackendError } from '@/shared/api/httpClient'
import { t } from '@/i18n'

export type OverlayKind = 'umap' | 'kmeans'

/** A KMeans cluster derived from the local label + RGB images. */
export interface KmeansCluster {
  /** Cluster id from the local KMeans labels. */
  id: number
  /** Display color assigned by the local KMeans renderer. */
  color: [number, number, number]
  /** Number of foreground pixels in this cluster. */
  count: number
}

/** Restricts a KMeans run to the pixels set in `mask` (row-major, ion-image grid). */
export interface KmeansScope {
  mask: Uint8Array
  label: string
}

/** A published local KMeans result. */
interface KmeansResult {
  /** Request number. Region ids include it, so a new result never matches an old selection. */
  request: number
  k: number
  /** The region the result was restricted to (null = every tissue pixel). */
  scope: KmeansScope | null
  grid: RegionGrid
  /** -1 = background. */
  labels: Int32Array
  rgb: Uint8Array
  clusters: KmeansCluster[]
}

/**
 * Derive the cluster list from the label image. Colors come straight from the
 * shared region palette (same table the worker renders with), so the chips,
 * overlay, compare panel and thumbnail all show the identical color without
 * sampling the rendered raster. Background is judged by the label value (-1).
 */
function deriveKmeansClusters(labels: Int32Array): KmeansCluster[] {
  const map = new Map<number, KmeansCluster>()
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]!
    if (id < 0) continue
    let c = map.get(id)
    if (!c) {
      const { r, g, b } = kmeansColor(id)
      c = { id, color: [r, g, b], count: 0 }
      map.set(id, c)
    }
    c.count++
  }
  return [...map.values()].sort((a, b) => a.id - b.id)
}

/**
 * UMAP / KMeans overlay data.
 *
 * UMAP comes from the run's own zarr (GET /processes/{run_id}/zarr - the same
 * zarr_url as the algorithm data): the backend clustering task writes its
 * results back into the embedded `analysis/umap` group (raw coordinates +
 * scaled embedding); ClusteringZarrStore rasterizes that onto the ion-image
 * grid. KMeans is computed LOCALLY in the browser from the embedding
 * (see utils/kmeans.ts) with a user-chosen k.
 *
 * Task lifecycle (backend UMAP generation): null → processing → completed/failed.
 * - Page entry (continuous runs): probeExisting() silently reads the run
 *   zarr's analysis/umap group. If the UMAP file exists, the task already
 *   finished - load + auto-enable. A missing group (never run / still
 *   computing) is swallowed; the user opts in manually.
 * - Opt-in confirm: createClusteringTask() POSTs (idempotent get-or-create)
 *   and branches on clustering_status. A processing task is polled by
 *   re-POSTing every 5s until completed (load + ready) or failed (stop and
 *   surface the backend error; the visible Retry action only retries the Zarr
 *   read).
 * - `ready` is only ever set by a successful zarr load - the status fields
 *   steer the UI, but the data itself is the final gate.
 */
export function useOverlayData(runId: string, ionRows: Ref<number>, ionCols: Ref<number>) {
  // State - UMAP and KMeans are mutually exclusive: only one shows at a time.
  const umapVisible = ref(false)
  const kmeansVisible = ref(false)
  const overlayData = ref<Uint8ClampedArray | null>(null)
  const overlayLoading = ref(false)
  const overlayError = ref<string | null>(null)
  // Independent overlay opacity per mode (stored as 0-255 alpha; default 255 = 100%).
  const umapAlpha = ref(255)
  const kmeansAlpha = ref(255)

  let store: ClusteringZarrStore | null = null
  let umapRgb: Uint8Array | null = null
  let umapEmbedding: UmapEmbedding | null = null
  let kmeansRequest = 0
  let dims: { height: number; width: number } | null = null
  let probed = false

  /** The current local KMeans result; null until the user runs one. */
  const kmeansResult = shallowRef<KmeansResult | null>(null)
  /** KMeans clusters (id + color + pixel count), empty until the user runs a local clustering. */
  const kmeansClusters = computed(() => kmeansResult.value?.clusters ?? [])
  const kmeansRegions = computed<KmeansRegion[]>(() => {
    const result = kmeansResult.value
    if (!result) return []
    return result.clusters.map(({ id, color: [r, g, b] }) => ({
      id: `kmeans:${result.request}:${id}`,
      kind: 'kmeans',
      clusterId: id,
      label: t('vizworkbench.kmeans.cluster', { id }),
      color: rgbCss({ r, g, b }),
      grid: result.grid,
      labels: result.labels,
    }))
  })
  /** False until a local KMeans run produced labels - the UI should say so
   *  explicitly rather than hide the picker silently. */
  const kmeansLabelsAvailable = computed(() => kmeansResult.value !== null)
  /** The k of the currently computed KMeans result (null = never run). */
  const kmeansK = computed(() => kmeansResult.value?.k ?? null)
  /** The region the current result was restricted to (null = every tissue pixel). */
  const kmeansScope = computed(() => kmeansResult.value?.scope ?? null)
  /** True while a local KMeans computation is in flight. */
  const kmeansComputing = ref(false)
  /** Selected cluster ids: drives both the overlay mask and the export mask.
   *  null = show all (default); an empty Set = explicitly hide all. */
  const selectedKmeansIds = ref<Set<number> | null>(null)

  // Clustering task lifecycle refs (see the module comment above).
  const clusteringCreating = ref(false)
  const clusteringComputing = ref(false)
  const clusteringReady = ref(false)
  const clusteringRefreshing = ref(false)
  const { showToast } = useToast()

  // ---- clustering-status polling: reuse POST while the task is in flight ----
  // Poll interval fixed at 5s; completed / failed status ends the chain.
  const POLL_INTERVAL_MS = 5000
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  /** True while a poll chain is live; stopPolling ends it. */
  let polling = false

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
    polling = false
  }

  /**
   * One poll tick: re-POST the (idempotent) clustering endpoint and branch on
   * clustering_status via applyTaskStatus. Stops on completed/failed —
   * critical for failed, since the current backend version re-triggers a
   * failed task on POST. A transient request error keeps the chain alive.
   */
  async function pollOnce() {
    try {
      const task = await createClustering(runId)
      if (!polling) return // polling stopped meanwhile
      await applyTaskStatus(task)
    } catch (e) {
      console.warn('[useOverlayData] clustering status poll failed:', e)
      if (polling) scheduleNextPoll()
    }
  }

  function scheduleNextPoll() {
    if (!polling) return
    // One pending tick at most - a manual Refresh hitting the processing
    // branch must not stack a second timer on top of the chain's own.
    if (pollTimer) return
    pollTimer = setTimeout(() => {
      pollTimer = null
      if (polling) pollOnce()
    }, POLL_INTERVAL_MS)
  }

  /** Start a poll chain (no-op if one is already live). The first tick waits
   *  one interval - the caller just received a fresh status from its own
   *  POST, so re-POSTing immediately would be redundant. */
  function startPolling() {
    if (polling) return
    stopPolling()
    polling = true
    scheduleNextPoll()
  }

  /** Drop the cached zarr store + rasters and mark the data not-ready. */
  function clearCache() {
    stopPolling()
    store?.dispose()
    store = null
    umapRgb = null
    umapEmbedding = null
    kmeansResult.value = null
    kmeansRequest++
    kmeansComputing.value = false
    dims = null
    selectedKmeansIds.value = null
    clusteringReady.value = false
  }

  /**
   * Load the clustering zarr and cache the UMAP raster + embedding matrix
   * (KMeans is computed locally on demand). Pure read - never POSTs. Safe to
   * call repeatedly; cached after the first success. With `silent`, failures
   * are swallowed without touching overlayError (used by the page-entry
   * probe, where "no UMAP group yet" is the normal case). Returns whether
   * the data is ready afterwards.
   */
  async function loadClusteringData(loadOpts: { silent?: boolean } = {}): Promise<boolean> {
    // Cache hit: umap raster + dims.
    if (umapRgb && dims) return true
    overlayLoading.value = true
    if (!loadOpts.silent) overlayError.value = null
    try {
      // The UMAP group (analysis/umap) is embedded in the run's own zarr -
      // same zarr_url as the algorithm data, no zarr_type parameter.
      const s = new ClusteringZarrStore(await getZarrUrl(runId))
      await s.init()
      const umap = await s.loadUmap()
      store = s
      umapRgb = umap.image.data
      umapEmbedding = umap.embedding
      dims = { height: umap.image.height, width: umap.image.width }
      clusteringReady.value = true
      clusteringComputing.value = false
      // Preload the ml-kmeans chunk now - the user is on the result page and
      // UMAP is ready, so KMeans is the natural next action. Fire-and-forget.
      preloadKmeans()
      return true
    } catch (e) {
      if (!loadOpts.silent) {
        console.error('[useOverlayData] failed to load clustering data:', e)
        overlayError.value = e instanceof Error ? e.message : String(e)
      } else {
        // Keep the entry probe quiet: a missing UMAP group is the normal
        // "task not run yet" case, not an error worth surfacing.
        console.warn('[useOverlayData] silent clustering probe failed:', e)
      }
      // NOTE: do NOT clearCache() here. A transient failure (CORS, token,
      // decode) must not throw away rasters that already loaded fine.
      return false
    } finally {
      overlayLoading.value = false
    }
  }

  /**
   * Branch on the task record returned by the (idempotent) clustering POST.
   * 'completed' still has to prove itself by loading the zarr; 'failed'
   * surfaces its error; anything else keeps the UI in the computing state and
   * starts the 5s status polling.
   */
  async function applyTaskStatus(task: ClusteringTaskResponse) {
    const s = (task.clustering_status || '').toLowerCase()
    if (s === 'completed') {
      stopPolling()
      const ok = await loadClusteringData()
      if (ok) showToast(t('vizworkbench.overlay.ready'), 'success')
      // else: overlayError + Retry already surfaced by loadClusteringData.
      return
    }
    if (s.includes('fail') || task.error_message) {
      stopPolling()
      clusteringComputing.value = false
      // 后端 error_message 不外显（内容/长度不可控），统一一句话；原始任务记录留控制台
      if (task.error_message)
        console.error('[useOverlayData] clustering task failed:', task.error_message)
      overlayError.value = t('vizworkbench.overlay.taskFailed')
      return
    }
    clusteringComputing.value = true
    // Continue the poll chain: the next tick is one interval away whether this
    // status came from the initial create POST (startPolling begins the chain)
    // or from a poll/Refresh tick (scheduleNextPoll keeps it going).
    if (polling) scheduleNextPoll()
    else startPolling()
  }

  /**
   * Opt-in enable flow: POST /processes/{run_id}/clustering. The POST is an
   * idempotent get-or-create, so this also covers "task already exists" -
   * the response status tells us where the task stands.
   */
  async function createClusteringTask() {
    if (clusteringCreating.value) return
    clusteringCreating.value = true
    try {
      const task = await createClustering(runId)
      await applyTaskStatus(task)
      if (clusteringComputing.value) {
        showToast(t('vizworkbench.overlay.taskStarted'), 'info')
      }
    } catch (e) {
      showToast(extractBackendError(e, t('vizworkbench.overlay.createFailed')), 'error')
    } finally {
      clusteringCreating.value = false
    }
  }

  /**
   * Refresh button: re-POST (idempotent) and branch on clustering_status.
   * The 5s polling already covers progress; this is a manual accelerator that
   * only shows while the task is computing.
   */
  async function refreshClusteringStatus() {
    if (clusteringRefreshing.value) return
    clusteringRefreshing.value = true
    try {
      const task = await createClustering(runId)
      await applyTaskStatus(task)
      if (clusteringComputing.value) {
        showToast(t('vizworkbench.overlay.stillComputing'), 'info')
      }
    } catch (e) {
      showToast(extractBackendError(e, t('vizworkbench.overlay.refreshFailed')), 'error')
    } finally {
      clusteringRefreshing.value = false
    }
  }

  /**
   * Page-entry probe (continuous runs only): silently try reading the run
   * zarr's analysis/umap group. If the UMAP file exists, a finished task
   * already exists - load it and let clusteringReady auto-enable the toggle.
   * A missing group (task never run / still processing) or a transient read
   * failure is swallowed; the user can still opt in manually, at which point
   * the POST reveals the real status and polling takes over.
   */
  async function probeExisting() {
    if (probed) return
    probed = true
    await loadClusteringData({ silent: true })
  }

  /**
   * Turn an (H×W×3) uint8 raster into an ion-image-sized RGBA overlay.
   * Background pixels (0,0,0) get alpha 0 (transparent). Returns null (and
   * sets overlayError) if the raster grid doesn't match the ion image.
   */
  function rgbToRgba(
    rgb: Uint8Array,
    height: number,
    width: number,
    alpha: number,
  ): Uint8ClampedArray | null {
    const rows = ionRows.value
    const cols = ionCols.value
    if (!rows || !cols) return null
    if (height !== rows || width !== cols) {
      overlayError.value = t('vizworkbench.overlay.sizeMismatch', {
        clusterSize: `${height}×${width}`,
        ionSize: `${rows}×${cols}`,
      })
      return null
    }
    const rgba = new Uint8ClampedArray(rows * cols * 4)
    const n = rows * cols
    for (let i = 0; i < n; i++) {
      const r = rgb[i * 3]!
      const g = rgb[i * 3 + 1]!
      const b = rgb[i * 3 + 2]!
      if (r === 0 && g === 0 && b === 0) continue
      const off = i * 4
      rgba[off] = r
      rgba[off + 1] = g
      rgba[off + 2] = b
      rgba[off + 3] = alpha
    }
    return rgba
  }

  function toggleKmeansCluster(id: number) {
    const all = kmeansClusters.value.map((c) => c.id)
    const cur = selectedKmeansIds.value ?? new Set(all)
    const next = new Set(cur)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedKmeansIds.value = next
  }

  function selectAllKmeansClusters() {
    selectedKmeansIds.value = null // null = all
  }

  function clearKmeansClusters() {
    selectedKmeansIds.value = new Set()
  }

  const computeUmapOverlay = () => {
    if (!umapRgb || !dims) return null
    return rgbToRgba(umapRgb, dims.height, dims.width, umapAlpha.value)
  }

  const computeKmeansOverlay = () => {
    const result = kmeansResult.value
    if (!result || !dims) return null
    const rgba = rgbToRgba(result.rgb, dims.height, dims.width, kmeansAlpha.value)
    if (!rgba) return null
    // Mask out unselected clusters. Background stays decided by RGB (0,0,0)
    // since the label image's background convention is ambiguous.
    const selected = selectedKmeansIds.value
    if (selected !== null) {
      const { labels } = result
      for (let i = 0; i < labels.length; i++) {
        if (!selected.has(labels[i]!)) rgba[i * 4 + 3] = 0
      }
    }
    return rgba
  }

  const recomputeOverlay = () => {
    // Overlays are mutually exclusive, so at most one is non-null here.
    if (umapVisible.value) overlayData.value = computeUmapOverlay()
    else if (kmeansVisible.value) overlayData.value = computeKmeansOverlay()
    else overlayData.value = null
  }

  /**
   * Run KMeans locally with a user-chosen k over the raw float32 UMAP
   * embedding, cache the resulting labels + rendered RGB, and show the KMeans
   * overlay. Deterministic (fixed seed): same k and scope → same clusters.
   * Re-running with a different k or scope replaces the previous result. With
   * a scope, only its pixels are clustered; the rest stay unlabelled.
   */
  async function runKmeans(k: number, scope: KmeansScope | null = null): Promise<boolean> {
    if (kmeansComputing.value) return false
    const request = ++kmeansRequest
    kmeansComputing.value = true
    try {
      const ok = await loadClusteringData()
      if (!ok || request !== kmeansRequest || !umapEmbedding || !dims) return false
      const { height, width } = dims
      if (scope && scope.mask.length !== height * width)
        throw new Error('[useOverlayData] the ROI grid does not match the UMAP grid')
      const input = scope ? embeddingWithin(umapEmbedding, scope.mask, width) : umapEmbedding
      if (scope && input.count < 2) {
        showToast(t('vizworkbench.overlay.kmeansScopeTooSmall'), 'warning')
        return false
      }
      const result = await computeKmeansFromUmap(input, height, width, k, 42, 30)
      if (request !== kmeansRequest) return false
      kmeansResult.value = {
        request,
        k,
        scope,
        grid: { runId, shape: [height, width] },
        labels: result.labels,
        rgb: result.rgb,
        clusters: deriveKmeansClusters(result.labels),
      }
      selectedKmeansIds.value = null // default: show all clusters
      // Show the result (mutually exclusive with UMAP).
      kmeansVisible.value = true
      umapVisible.value = false
      recomputeOverlay()
      return true
    } catch (e) {
      console.error('[useOverlayData] local kmeans failed:', e)
      if (request === kmeansRequest) overlayError.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      if (request === kmeansRequest) kmeansComputing.value = false
    }
  }

  const toggleOverlay = async (kind: OverlayKind) => {
    const visible = kind === 'umap' ? umapVisible : kmeansVisible
    const other = kind === 'umap' ? kmeansVisible : umapVisible
    if (!visible.value) {
      // Load first; only flip visibility on success so a failed load doesn't
      // leave the overlay "on" with nothing to draw.
      const ok = await loadClusteringData()
      if (!ok) return
      visible.value = true
      // Mutually exclusive: opening one overlay closes the other.
      other.value = false
    } else {
      visible.value = false
    }
    recomputeOverlay()
  }

  /** Retry after a failed clustering load. Re-reads the zarr without
   *  clearing the cache, so a transient error doesn't blank the overlays. */
  const retryClustering = async () => {
    overlayError.value = null
    await loadClusteringData()
    recomputeOverlay()
  }

  // Recompute only the affected overlay when its opacity changes.
  watch(umapAlpha, () => {
    if (umapVisible.value && umapRgb) recomputeOverlay()
  })
  watch(kmeansAlpha, () => {
    if (kmeansVisible.value && kmeansResult.value) recomputeOverlay()
  })

  // Recompute the KMeans overlay when the cluster selection changes. Deep
  // watch: the ref holds a Set whose membership is mutated in place.
  watch(
    selectedKmeansIds,
    () => {
      if (kmeansVisible.value && kmeansResult.value) recomputeOverlay()
    },
    { deep: true },
  )

  // Recompute overlays once BOTH the raster data and the ion dimensions are
  // available, whichever arrives last (the zarr load can beat the ion image).
  watch([ionRows, ionCols, clusteringReady], () => {
    if (!ionRows.value || !ionCols.value) return
    if (umapVisible.value && !umapRgb) return
    if (kmeansVisible.value && !kmeansResult.value) return
    if (umapVisible.value || kmeansVisible.value) recomputeOverlay()
  })

  // Page-entry UMAP probe: once the zarr data mode is known, and only for
  // continuous storage (processed data has no UMAP).
  watch(
    dataModeRef,
    (mode) => {
      if (runId && mode === 'continuous') probeExisting()
    },
    { immediate: true },
  )

  // Release the clustering zarr store + cached rasters on unmount.
  onBeforeUnmount(() => {
    clearCache()
    overlayData.value = null
  })

  /** Current KMeans labels (Int32Array, -1 = background) or null if not run. */
  function getKmeansLabels(): Int32Array | null {
    return kmeansResult.value?.labels ?? null
  }

  /** Current UMAP RGB raster (H×W×3 uint8) or null if not loaded. */
  function getUmapRgb(): Uint8Array | null {
    return umapRgb
  }

  /** Current KMeans RGB raster (H×W×3 uint8) or null if not run. */
  function getKmeansRgb(): Uint8Array | null {
    return kmeansResult.value?.rgb ?? null
  }

  /** Overlay raster grid dims or null if the clustering zarr never loaded. */
  function getOverlayDims(): { width: number; height: number } | null {
    return dims ? { width: dims.width, height: dims.height } : null
  }

  /**
   * UMAP occupancy mask (row-major 0/1, 1 = a tissue pixel holds an embedding
   * point). Derived from the embedding coordinates, NOT from RGB: a valid point
   * can legitimately map to RGB (0,0,0), so color-based background detection
   * would silently drop it.
   */
  function getUmapOccupancyMask(): Uint8Array | null {
    if (!umapEmbedding || !dims) return null
    const { width, height } = dims
    const mask = new Uint8Array(width * height)
    const { coordinates, count } = umapEmbedding
    for (let i = 0; i < count; i++) {
      const col = coordinates[i * 2]!
      const row = coordinates[i * 2 + 1]!
      if (col < 0 || col >= width || row < 0 || row >= height) continue
      mask[row * width + col] = 1
    }
    return mask
  }

  /**
   * Export an RGB raster (H×W×3 uint8) as a scaled-up PNG download.
   * Background pixels (0,0,0) become transparent. Used by the UMAP/KMeans
   * export buttons so the user gets a clean image without the ion image.
   */
  function exportRgbPng(rgb: Uint8Array, width: number, height: number, filename: string) {
    const scale = 4 // upscale for a usable image (originals are small, e.g. 93×227)
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false

    // Build a 1:1 ImageData from the RGB raster, then drawImage upscaled.
    const src = document.createElement('canvas')
    src.width = width
    src.height = height
    const sctx = src.getContext('2d')!
    const imgData = sctx.createImageData(width, height)
    for (let i = 0; i < width * height; i++) {
      const r = rgb[i * 3]!
      const g = rgb[i * 3 + 1]!
      const b = rgb[i * 3 + 2]!
      imgData.data[i * 4] = r
      imgData.data[i * 4 + 1] = g
      imgData.data[i * 4 + 2] = b
      // Background (0,0,0) = transparent, everything else = opaque
      imgData.data[i * 4 + 3] = r || g || b ? 255 : 0
    }
    sctx.putImageData(imgData, 0, 0)
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height)

    downloadCanvas(canvas, filename)
  }

  /** Export the UMAP RGB image as a standalone PNG (no ion image background). */
  function exportUmapPng() {
    if (!umapRgb || !dims) return
    exportRgbPng(umapRgb, dims.width, dims.height, 'umap_image.png')
  }

  /** Overlay opacity as 0-255 alpha, one value per overlay kind. */
  function setOverlayAlpha(kind: OverlayKind, alpha: number) {
    const value = Math.max(0, Math.min(255, alpha))
    if (kind === 'umap') umapAlpha.value = value
    else kmeansAlpha.value = value
  }

  /** Export the KMeans RGB image as a standalone PNG (no ion image background). */
  function exportKmeansPng() {
    const result = kmeansResult.value
    if (!result || !dims) return
    exportRgbPng(result.rgb, dims.width, dims.height, `kmeans_k${result.k}.png`)
  }

  return reactive({
    umapVisible,
    kmeansVisible,
    overlayData,
    overlayLoading,
    overlayError,
    /** True while the initial create-task POST is in flight. */
    clusteringCreating,
    /** True when the task exists but hasn't completed - show Refresh. */
    clusteringComputing,
    /** True once the clustering zarr is loaded - buttons become interactive. */
    clusteringReady,
    /** True while a refresh POST is in flight. */
    clusteringRefreshing,
    /** Overlay opacities as 0-255 alpha; set through setOverlayAlpha. */
    umapAlpha,
    kmeansAlpha,
    setOverlayAlpha,
    /** KMeans clusters (id + color + pixel count) for the picker UI. */
    kmeansClusters,
    kmeansRegions,
    /** False until a local KMeans run produced labels - show a hint instead of the picker. */
    kmeansLabelsAvailable,
    /** The k of the current KMeans result (null = never run). */
    kmeansK,
    /** The region the current KMeans result was restricted to (null = all pixels). */
    kmeansScope,
    /** True while a local KMeans computation is in flight. */
    kmeansComputing,
    /** Selected cluster ids (null = all); drives overlay + export mask. */
    selectedKmeansIds,
    toggleOverlay,
    retryClustering,
    /** Run KMeans locally over the UMAP raster with a user-chosen k. */
    runKmeans,
    toggleKmeansCluster,
    selectAllKmeansClusters,
    clearKmeansClusters,
    /** Current KMeans labels (Int32Array, -1 = background) or null. */
    getKmeansLabels,
    /** Current UMAP RGB raster (H×W×3) or null if not loaded. */
    getUmapRgb,
    /** Current KMeans RGB raster (H×W×3) or null if not run. */
    getKmeansRgb,
    /** Overlay raster grid dims or null if the clustering zarr never loaded. */
    getOverlayDims,
    /** UMAP occupancy mask (coordinates-derived; color-independent). */
    getUmapOccupancyMask,
    /** Export the UMAP RGB image as a standalone PNG. */
    exportUmapPng,
    /** Export the KMeans RGB image as a standalone PNG. */
    exportKmeansPng,
    /** Opt-in enable: POST the (idempotent) clustering task. */
    createClusteringTask,
    /** Refresh button: re-POST and branch on clustering_status. */
    refreshClusteringStatus,
  })
}

export type ClusteringState = ReturnType<typeof useOverlayData>
