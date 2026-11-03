/**
 * On-demand reader for the UMAP clustering data embedded in a run's zarr.
 *
 * Since the backend clustering update,
 * clustering results are written back into the run's own zarr — there is no
 * separate clustering zarr anymore. The UMAP group lives at `analysis/umap`:
 *
 *     <root>/analysis/umap/coordinates/      - (n, 2) uint32, tissue-pixel (x, y)
 *     <root>/analysis/umap/scaled_embedding/ - (n, 3) float32, 3D UMAP in [0, 1]
 *
 * The backend analysis pipeline only runs the first two steps (UMAP reduction
 * + scaling); the third step — mapping the embedding onto the tissue grid —
 * is done here: every tissue pixel takes round(scaled_embedding * 255) as its
 * RGB. Grid dims come from the root zarr's `spatial_shape` (never derived
 * from coordinate maxima, so missing edge rows/columns can't shrink the grid).
 *
 * `coordinates` + `scaled_embedding` are the raw embedding (one 3D vector per
 * tissue pixel) — the input both for the rasterization here and for the local
 * KMeans. The synthesized RGB image drives the overlay; background pixels
 * (0,0,0) are treated as transparent by the caller. No backend kmeans arrays
 * are fetched — KMeans is computed locally in the browser.
 */

import { createOssClient, OssError, ossKey } from '../zarr/ossClient'
import type { OssClient } from '../zarr/ossClient'
import type { ZarrAccessResponse, RootAttrs } from '../zarr/types/zarr'
import type { ClusteringImage, UmapData, UmapEmbedding } from './types/clustering'
import type { ZarrV3ArrayMetadata, ZarrV3GroupMetadata } from '../zarr/types/zarrV3'
import { assertV3Array, computeNDChunkKey } from '../zarr/zarrMetadata'
import { decodePayload } from '../zarr/zarrDecode'
import { makeTypedArray } from '../zarr/zarrDtype'
import { readFullArray } from '../zarr/zarrReader'

/** Path of the UMAP group inside the run's zarr. */
const UMAP_GROUP = 'analysis/umap'

export class ClusteringZarrStore {
  private oss: OssClient
  private folderPath: string
  private _disposed = false
  /** Root spatial_shape ([height, width]) - grid for embedding rasterization. */
  private spatialShape: [number, number] | null = null

  constructor(
    source: ZarrAccessResponse,
    refreshAccess?: () => Promise<ZarrAccessResponse>,
  ) {
    this.oss = createOssClient(source, { refresh: refreshAccess })
    this.folderPath = source.folder_path
  }

  dispose(): void {
    this._disposed = true
  }

  /**
   * Read the UMAP group zarr.json (validate v3 group) and the run zarr's root
   * `spatial_shape` (the grid the embedding rasterizes onto).
   */
  async init(): Promise<void> {
    const [root, rootAttrs] = await Promise.all([
      this.readJson<ZarrV3GroupMetadata>('zarr.json'),
      this.readRootAttrs(),
    ])
    if (root.zarr_format !== 3 || root.node_type !== 'group') {
      throw new Error(
        `[ClusteringZarrStore] unsupported ${UMAP_GROUP} zarr format/node_type: ${root.zarr_format}/${root.node_type}`,
      )
    }
    this.spatialShape = rootAttrs.spatial_shape
  }

  /**
   * Load the full UMAP result: the raw embedding (`coordinates` +
   * `scaled_embedding`) plus the rasterized (H, W, 3) image synthesized from
   * it on the tissue grid. The embedding arrays are mandatory - a group
   * without them is not a valid clustering result.
   */
  async loadUmap(): Promise<UmapData> {
    const embedding = await this.loadUmapEmbedding()
    if (!embedding) {
      throw new Error(
        `[ClusteringZarrStore] ${UMAP_GROUP} is missing coordinates/scaled_embedding`,
      )
    }
    return { image: this.rasterizeEmbedding(embedding), embedding }
  }

  /**
   * Rasterize the raw embedding onto the tissue grid: every tissue pixel takes
   * round(scaled_embedding * 255) as RGB, everything else stays (0,0,0)
   * background. Grid dims come from the run zarr's root `spatial_shape`
   * (never derived from coordinate maxima, so missing edge rows/columns can't
   * shrink the grid).
   *
   * NOTE on coordinates: the analysis group's `coordinates` are 0-based — the
   * analysis library normalizes before writing — so unlike the main zarr's
   * axes/coordinates, the root `coordinate_base` is NOT subtracted here.
   */
  private rasterizeEmbedding(emb: UmapEmbedding): ClusteringImage {
    if (!this.spatialShape) throw new Error('[ClusteringZarrStore] call init() first')
    const [height, width] = this.spatialShape
    const { coordinates, scaledEmbedding, count } = emb
    const data = new Uint8Array(width * height * 3)
    for (let i = 0; i < count; i++) {
      const col = coordinates[i * 2]!
      const row = coordinates[i * 2 + 1]!
      if (col < 0 || col >= width || row < 0 || row >= height) continue
      const off = (row * width + col) * 3
      data[off] = Math.round(scaledEmbedding[i * 3]! * 255)
      data[off + 1] = Math.round(scaledEmbedding[i * 3 + 1]! * 255)
      data[off + 2] = Math.round(scaledEmbedding[i * 3 + 2]! * 255)
    }
    return { data, height, width, channels: 3 }
  }

  /** Root attributes of the run zarr (spatial_shape, coordinate_base, ...). */
  private async readRootAttrs(): Promise<RootAttrs> {
    const ab = await this.oss.getObjectArrayBuffer(ossKey(this.folderPath, 'zarr.json'))
    const text = new TextDecoder('utf-8').decode(new Uint8Array(ab))
    const root = JSON.parse(text) as ZarrV3GroupMetadata
    const attrs = root.attributes as unknown as RootAttrs | undefined
    if (!attrs?.spatial_shape) {
      throw new Error('[ClusteringZarrStore] root zarr.json missing spatial_shape')
    }
    return attrs
  }

  /**
   * Read `coordinates` (uint32[n, 2]) + `scaled_embedding` (float32[n, 3]).
   * Returns null when `coordinates` is absent — i.e. the run's zarr has no
   * clustering result (task never run / still computing), which the caller
   * surfaces as "not available yet" rather than a hard error.
   */
  private async loadUmapEmbedding(): Promise<UmapEmbedding | null> {
    let coordMeta: ZarrV3ArrayMetadata
    try {
      coordMeta = await this.readArrayMeta('coordinates')
    } catch (e) {
      if (e instanceof OssError && e.code === 'not_found') return null
      throw e
    }
    if (
      coordMeta.data_type !== 'uint32' ||
      coordMeta.shape.length !== 2 ||
      coordMeta.shape[1] !== 2
    ) {
      throw new Error(
        `[ClusteringZarrStore] coordinates: expected (n, 2) uint32, got (${coordMeta.shape.join(', ')}) ${coordMeta.data_type}`,
      )
    }
    const embMeta = await this.readArrayMeta('scaled_embedding')
    if (
      embMeta.data_type !== 'float32' ||
      embMeta.shape.length !== 2 ||
      embMeta.shape[1] !== 3
    ) {
      throw new Error(
        `[ClusteringZarrStore] scaled_embedding: expected (n, 3) float32, got (${embMeta.shape.join(', ')}) ${embMeta.data_type}`,
      )
    }
    const count = coordMeta.shape[0]!
    if (embMeta.shape[0] !== count) {
      throw new Error(
        `[ClusteringZarrStore] coordinates/scaled_embedding row count mismatch: ${count} vs ${embMeta.shape[0]}`,
      )
    }
    const [coordinates, scaledEmbedding] = await Promise.all([
      this.readTypedArray('coordinates', coordMeta) as Promise<Uint32Array>,
      this.readTypedArray('scaled_embedding', embMeta) as Promise<Float32Array>,
    ])
    return { coordinates, scaledEmbedding, count }
  }

  /**
   * Read a whole array and return it as the typed-array view matching its
   * dtype (uint32 / float32 / ...). `readArrayFull` returns raw bytes; this
   * slices a clean ArrayBuffer and views it with `makeTypedArray`.
   */
  private async readTypedArray(
    arrayPath: string,
    meta: ZarrV3ArrayMetadata,
  ): Promise<Uint32Array | Float32Array | Float64Array | Int32Array> {
    const out = await this.readArrayFull(arrayPath, meta)
    const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
    const arr = makeTypedArray(meta.data_type, buf)
    if (
      !(arr instanceof Uint32Array) &&
      !(arr instanceof Float32Array) &&
      !(arr instanceof Float64Array) &&
      !(arr instanceof Int32Array)
    ) {
      throw new Error(`[ClusteringZarrStore] ${arrayPath}: unsupported dtype ${meta.data_type}`)
    }
    return arr
  }

  // ========== internal ==========

  private async readArrayMeta(arrayPath: string): Promise<ZarrV3ArrayMetadata> {
    const meta = await this.readJson<ZarrV3ArrayMetadata>(`${arrayPath}/zarr.json`)
    assertV3Array(meta, arrayPath)
    return meta
  }

  /**
   * Read a whole array as one contiguous row-major buffer (single- and
   * multi-chunk arrays alike).
   */
  private async readArrayFull(
    arrayPath: string,
    meta: ZarrV3ArrayMetadata,
  ): Promise<Uint8Array> {
    return readFullArray(meta, arrayPath, async (coords) => {
      const chunkKey = computeNDChunkKey(meta, coords)
      const raw = await this.oss.getObjectArrayBuffer(this.key(`${arrayPath}/${chunkKey}`))
      if (this._disposed) throw new Error('[ClusteringZarrStore] disposed during read')
      return decodePayload(meta, raw)
    })
  }

  /** All arrays live under the UMAP group, so the rest of the store uses plain array names. */
  private key(relativePath: string): string {
    return ossKey(this.folderPath, `${UMAP_GROUP}/${relativePath.replace(/^\/+/, '')}`)
  }

  private async readJson<T>(relativePath: string): Promise<T> {
    const key = this.key(relativePath)
    const ab = await this.oss.getObjectArrayBuffer(key)
    const text = new TextDecoder('utf-8').decode(new Uint8Array(ab))
    try {
      return JSON.parse(text) as T
    } catch (e) {
      throw new Error(
        `[ClusteringZarrStore] failed to parse JSON at ${key}: ${(e as Error).message}`,
      )
    }
  }
}
