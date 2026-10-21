/**
 * KMeans worker - runs `ml-kmeans` off the main thread.
 *
 * Input is the raw float32 UMAP embedding (`scaled_embedding` + one (x, y)
 * grid coordinate pair per point, 0-based like the analysis group writes):
 * cluster the true 3D UMAP vectors, then map labels back onto the tissue grid
 * via the coordinates - the same convention ClusteringZarrStore rasterizes
 * with, so the rendered KMeans aligns pixel-perfectly with the UMAP overlay.
 *
 * Runs KMeans synchronously here (blocking the worker is fine - it never
 * touches the UI thread), and posts back the rendered labels + RGB with
 * transferable buffers (zero-copy).
 *
 * Determinism: `ml-kmeans` is called with a fixed `seed` and k-means++
 * initialization (seeded via `ml-random`), so the same input + k always yields
 * the same clusters.
 */

import { kmeans } from 'ml-kmeans'
import { kmeansColor } from './regionPalette'

interface KmeansRequest {
  /** Request id echoed back so the host can drop stale responses. */
  id: number
  height: number
  width: number
  k: number
  seed: number
  maxIterations: number
  /** The raw UMAP embedding - coordinates (x, y) uint32 pairs, 0-based +
   *  scaled_embedding float32 triplets in [0, 1], `count` points. */
  embedding: {
    coordinates: Uint32Array
    scaledEmbedding: Float32Array
    count: number
  }
}

interface KmeansResponse {
  id: number
  labels: Int32Array
  rgb: Uint8Array
  pointCount: number
  iterations: number
}

interface KmeansError {
  id: number
  error: string
}

// Minimal worker-global typing. The project compiles with the DOM lib only
// (no `webworker` lib), so we type just the surface we use instead of pulling
// in the full webworker lib, which would clash with DOM globals.
interface WorkerGlobalScope {
  onmessage: ((ev: MessageEvent<KmeansRequest>) => void) | null
  postMessage(message: KmeansResponse | KmeansError, transfer: Transferable[]): void
  postMessage(message: KmeansResponse | KmeansError): void
}
const scope = self as unknown as WorkerGlobalScope

scope.onmessage = (e: MessageEvent<KmeansRequest>) => {
  const { id, height, width, k, seed, maxIterations, embedding } = e.data
  try {
    const nPixels = height * width

    // ---- collect points + reverse index back to pixel space ----
    // `data` holds one 3D point per tissue pixel (scaled to the 0-255 scale,
    // matching the rasterized UMAP image), `pixelIndex` maps point i ->
    // pixel offset y * width + x (coordinates are 0-based).
    const count = embedding.count
    const data = new Array(count)
    const pixelIndex = new Int32Array(count)
    const { coordinates, scaledEmbedding } = embedding
    for (let i = 0; i < count; i++) {
      data[i] = [
        scaledEmbedding[i * 3]! * 255,
        scaledEmbedding[i * 3 + 1]! * 255,
        scaledEmbedding[i * 3 + 2]! * 255,
      ]
      const col = coordinates[i * 2]!
      const row = coordinates[i * 2 + 1]!
      pixelIndex[i] = row * width + col
    }

    if (count < 2) {
      scope.postMessage({ id, error: '[kmeans] not enough tissue pixels to cluster' })
      return
    }

    const kk = Math.max(2, Math.min(Math.round(k), count))

    // ---- run KMeans (sync here - this thread is disposable) ----
    const result = kmeans(data, kk, {
      seed,
      maxIterations,
      initialization: 'kmeans++',
    })

    // ---- render labels + RGB ----
    const labels = new Int32Array(nPixels).fill(-1)
    const rgb = new Uint8Array(nPixels * 3)
    for (let i = 0; i < count; i++) {
      const px = pixelIndex[i]!
      const cluster = result.clusters[i]!
      labels[px] = cluster
      const { r, g, b } = kmeansColor(cluster)
      rgb[px * 3] = r
      rgb[px * 3 + 1] = g
      rgb[px * 3 + 2] = b
    }

    // Transfer the output buffers back (zero-copy); the input was a copy.
    scope.postMessage({ id, labels, rgb, pointCount: count, iterations: result.iterations }, [
      labels.buffer,
      rgb.buffer,
    ])
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
