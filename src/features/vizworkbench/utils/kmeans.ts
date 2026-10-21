/**
 * Frontend KMeans clustering over the UMAP embedding matrix.
 *
 * Input is the raw embedding (`coordinates` + `scaled_embedding`, one float32
 * 3D vector per tissue pixel) that the backend ships after its two analysis
 * steps. Labels are mapped back onto the tissue grid via the coordinates, so
 * the rendered result aligns pixel-perfectly with the UMAP overlay.
 *
 * The actual clustering runs in a dedicated Web Worker (kmeans.worker.ts) so
 * the main thread stays free for rendering / interaction, even on large
 * images. `ml-kmeans` lives entirely inside the worker - it's never loaded on
 * the main thread. The worker is a module-level singleton: created on first
 * use (or preloaded on entering the result page) and reused for every run.
 *
 * Deterministic: the worker calls `ml-kmeans` with a fixed `seed` and k-means++
 * init, so the same input and k always produce the same clusters (what the
 * user sees is what they export).
 */

export interface KmeansResult {
  /** (H×W) cluster id per pixel; -1 = background (not clustered). */
  labels: Int32Array
  /** (H×W×3) rendered RGB; background pixels are (0,0,0). */
  rgb: Uint8Array
  /** Number of foreground points that were clustered. */
  pointCount: number
  /** Lloyd iterations actually run (early-stopped on convergence). */
  iterations: number
}

/** Raw UMAP embedding input; mirrors UmapEmbedding in clustering types. */
export interface KmeansEmbeddingInput {
  coordinates: Uint32Array
  scaledEmbedding: Float32Array
  count: number
}

interface PendingRequest {
  id: number
  resolve: (r: KmeansResult) => void
  reject: (e: Error) => void
}

// Singleton worker + a single in-flight request. KMeans runs are
// user-initiated and serialized by the `kmeansComputing` flag in the UI, so
// only one request is ever pending at a time; the id lets us drop stale
// responses defensively.
let worker: Worker | null = null
let pending: PendingRequest | null = null
let nextRequestId = 1

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./kmeans.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data as {
      id: number
      labels?: Int32Array
      rgb?: Uint8Array
      pointCount?: number
      iterations?: number
      error?: string
    }
    if (!pending || pending.id !== msg.id) return // stale / orphaned
    const { resolve, reject } = pending
    pending = null
    if (msg.error) {
      reject(new Error(msg.error))
    } else {
      resolve({
        labels: msg.labels!,
        rgb: msg.rgb!,
        pointCount: msg.pointCount!,
        iterations: msg.iterations!,
      })
    }
  }
  worker.onerror = (e: ErrorEvent) => {
    if (pending) {
      pending.reject(new Error(e.message || '[kmeans] worker error'))
      pending = null
    }
  }
  return worker
}

/**
 * Preload the ml-kmeans worker (fire-and-forget). Creating the worker makes it
 * fetch + import `ml-kmeans` in its own thread, so by the time the user clicks
 * the KMeans button the chunk is already downloaded. Safe to call repeatedly.
 */
export function preloadKmeans(): void {
  getWorker()
}

/**
 * Cluster the tissue pixels into `k` clusters, off the main thread. The
 * worker clusters the raw float32 UMAP vectors and maps labels back via the
 * grid coordinates (0-based, as the analysis group writes them). `k` is
 * clamped to [2, pointCount]; throws when there are fewer than 2 points.
 * Inputs are copied to the worker (the main thread keeps its cached copy for
 * the UMAP overlay / scatter view); results come back via transferable
 * buffers.
 */
export async function computeKmeansFromUmap(
  embedding: KmeansEmbeddingInput,
  height: number,
  width: number,
  k: number,
  seed = 42,
  maxIterations = 30,
): Promise<KmeansResult> {
  const id = nextRequestId++
  const w = getWorker()
  return new Promise<KmeansResult>((resolve, reject) => {
    // Defensive: a second call while one is in flight would otherwise leave
    // the older request's promise pending forever (its resolve/reject would
    // be silently overwritten). The UI serializes runs via kmeansComputing,
    // so this path should never fire in practice.
    pending?.reject(new Error('[kmeans] request superseded by a newer run'))
    pending = { id, resolve, reject }
    // Send a copy (no transfer): the main thread still needs the cached
    // embedding for the UMAP overlay and scatter view. Results return
    // zero-copy.
    w.postMessage({ id, height, width, k, seed, maxIterations, embedding })
  })
}
