/**
 * Full-array reader for zarr v3 arrays.
 *
 * Handles single- and multi-chunk arrays of any dimensionality (1D/2D/3D+).
 * All chunks are fetched in parallel through the caller-supplied `fetchChunk`
 * (one HTTP GET + decodePayload per chunk-grid coordinate), then reassembled;
 * edge chunks are read in either layout writers use - spec-compliant unpadded
 * (actual size) or padded to the full chunk_shape (detected by payload size;
 * last-dimension padding interleaves fill values with real data, so the
 * strides must match the stored layout). Pure (no instance state, no
 * network) - fetching stays in each store via the shared zarrHttpClient.
 */

import { bytesPerElement } from './zarrDtype'
import type { ZarrV3ArrayMetadata } from './types/zarrV3'

/**
 * Read an entire zarr v3 array as one contiguous row-major buffer.
 * `label` is used in error messages.
 */
export async function readFullArray(
  meta: ZarrV3ArrayMetadata,
  label: string,
  fetchChunk: (coords: number[]) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const shape = meta.shape
  const chunkShape = meta.chunk_grid.configuration.chunk_shape
  const bpe = bytesPerElement(meta.data_type)
  const totalBytes = shape.reduce((a, b) => a * b, 1) * bpe
  const ndim = shape.length

  const chunkCounts = shape.map((s, i) => Math.ceil(s / chunkShape[i]!))
  const totalChunks = chunkCounts.reduce((a, b) => a * b, 1)

  // Fast path: single chunk covering the whole array. Only take it when the
  // payload is exactly the array size - an oversized payload may be a chunk
  // padded to chunk_shape (see the padded-edge handling below) and needs the
  // general path's stride logic to be read correctly.
  if (totalChunks === 1) {
    const payload = await fetchChunk(shape.map(() => 0))
    if (payload.byteLength === totalBytes) return payload
    if (payload.byteLength < totalBytes) {
      throw new Error(
        `[zarrReader] ${label}: chunk too small (${payload.byteLength} < ${totalBytes} bytes)`,
      )
    }
  }

  // Enumerate every chunk-grid coordinate (row-major over the grid).
  const allCoords: number[][] = []
  const enumerate = (d: number, acc: number[]) => {
    if (d === ndim) {
      allCoords.push([...acc])
      return
    }
    for (let i = 0; i < chunkCounts[d]!; i++) {
      acc[d] = i
      enumerate(d + 1, acc)
    }
  }
  enumerate(0, new Array(ndim).fill(0))
  const payloads = await Promise.all(allCoords.map(fetchChunk))

  // Element strides (row-major) of the full array.
  const fullStrides = new Array<number>(ndim)
  fullStrides[ndim - 1] = 1
  for (let i = ndim - 2; i >= 0; i--) fullStrides[i] = fullStrides[i + 1]! * shape[i + 1]!

  const out = new Uint8Array(totalBytes)
  for (let ci = 0; ci < allCoords.length; ci++) {
    const coords = allCoords[ci]!
    const payload = payloads[ci]!
    // Edge chunks can be smaller than chunk_shape.
    const origin = coords.map((c, d) => c * chunkShape[d]!)
    const actual = coords.map((c, d) => Math.min(chunkShape[d]!, shape[d]! - origin[d]!))
    const chunkBytes = actual.reduce((a, b) => a * b, 1) * bpe
    if (payload.byteLength < chunkBytes) {
      throw new Error(
        `[zarrReader] ${label}: chunk (${coords.join(',')}) too small (${payload.byteLength} < ${chunkBytes} bytes)`,
      )
    }

    // The v3 spec stores edge chunks unpadded, but some writers pad every
    // chunk to the full chunk_shape (fill value in the unused tail). Padding
    // in the LAST dimension interleaves fill values with real data, so the
    // payload size tells the two layouts apart and the strides must match:
    // padded chunks are laid out at full chunk_shape, unpadded at `actual`.
    const fullChunkBytes = chunkShape.reduce((a, b) => a * b, 1) * bpe
    const padded = chunkBytes < fullChunkBytes && payload.byteLength >= fullChunkBytes

    // Element strides (row-major) within this chunk.
    const chunkStrides = new Array<number>(ndim)
    chunkStrides[ndim - 1] = 1
    for (let i = ndim - 2; i >= 0; i--) {
      const dimLen = padded ? chunkShape[i + 1]! : actual[i + 1]!
      chunkStrides[i] = chunkStrides[i + 1]! * dimLen
    }

    // Copy row by row along the last dim (contiguous in both buffers).
    const lastBytes = actual[ndim - 1]! * bpe
    let outerCount = 1
    for (let i = 0; i < ndim - 1; i++) outerCount *= actual[i]!
    for (let r = 0; r < outerCount; r++) {
      let rem = r
      let chunkOffElems = 0
      let fullOffElems = 0
      for (let d = ndim - 2; d >= 0; d--) {
        const coord = rem % actual[d]!
        rem = Math.floor(rem / actual[d]!)
        chunkOffElems += coord * chunkStrides[d]!
        fullOffElems += (origin[d]! + coord) * fullStrides[d]!
      }
      fullOffElems += origin[ndim - 1]! // last-dim stride is 1
      out.set(
        payload.subarray(chunkOffElems * bpe, chunkOffElems * bpe + lastBytes),
        fullOffElems * bpe,
      )
    }
  }
  return out
}
