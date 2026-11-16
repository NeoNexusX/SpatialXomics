/**
 * Chunk payload decompression for zarr v3 arrays over OSS.
 *
 * gzip / zlib / deflate go through the native DecompressionStream; zstd goes
 * through zstddec (WASM, initialized once as a singleton). Everything here is
 * pure (no instance state, no network) - the network fetch stays in each
 * store via the shared OssClient.
 */

import { ZSTDDecoder } from 'zstddec'
import type { ZarrV3ArrayMetadata } from './types/zarrV3'

// ---------- zstd decoder (singleton) ----------

let zstdDecoderPromise: Promise<ZSTDDecoder> | null = null

export function getZstdDecoder(): Promise<ZSTDDecoder> {
  if (!zstdDecoderPromise) {
    const decoder = new ZSTDDecoder()
    zstdDecoderPromise = decoder.init().then(() => decoder)
  }
  return zstdDecoderPromise
}

// ---------- decompression helpers ----------

async function decompressBytes(payload: Uint8Array, codecName: string): Promise<Uint8Array> {
  const run = async (format: 'gzip' | 'deflate' | 'deflate-raw') => {
    const stream = new Blob([payload as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream(format))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  }
  if (codecName === 'gzip') return run('gzip')
  try {
    return await run('deflate-raw')
  } catch {
    return run('deflate')
  }
}

/**
 * Decompress a raw chunk payload according to the array's codecs.
 * gzip / zlib / deflate via native DecompressionStream, zstd via zstddec.
 * Pass-through when no compression codec is set.
 */
export async function decodePayload(
  meta: ZarrV3ArrayMetadata,
  raw: ArrayBuffer,
): Promise<Uint8Array> {
  let payload: Uint8Array = new Uint8Array(raw)

  const bytesCodec = (meta.codecs ?? []).find(
    (c) => ['gzip', 'zlib', 'deflate', 'zstd'].includes(c.name),
  )
  if (bytesCodec) {
    payload =
      bytesCodec.name === 'zstd'
        ? (await getZstdDecoder()).decode(payload)
        : await decompressBytes(payload, bytesCodec.name)
  }
  return payload
}
