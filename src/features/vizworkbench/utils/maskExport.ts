/**
 * Mask export utilities.
 *
 * ROI masks and KMeans cluster masks are both H×W boolean rasters. Any number
 * of them can be OR-ed together into a SINGLE binary mask (1 = the pixel
 * belongs to at least one selected region) and downloaded as .npz or .csv.
 *
 * Both formats embed provenance metadata (datasetName / shape / pixelSizeUm)
 * plus a SHA-256 over the pixel payload, so a later import (or downstream
 * Python) can tell which dataset the mask belongs to and whether the bytes
 * still match what was exported:
 *   .npz — zip (STORE) with two .npy entries, mirroring np.savez:
 *            mask → uint8 array, shape (H, W), 0/1 per pixel
 *            meta → uint8 array of UTF-8 JSON bytes
 *                   (read: json.loads(d['meta'].tobytes()))
 *   .csv — `#` comment header lines, then one 0/1 row per raster line
 *          (np.loadtxt and pd.read_csv(comment='#') skip the header)
 *
 * The hash always covers the same canonical payload bytes — row-major uint8
 * 0/1, H×W — so the .npz and .csv of one mask share the same digest.
 */

import { createSHA256 } from 'hash-wasm'
import { downloadBlob } from '@/shared/utils/download'
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js'

export type ExportFormat = 'npz' | 'csv'

/** What the export panel selects; resolved to one merged mask by the parent. */
export interface MaskExportPayload {
  format: ExportFormat
  roiIds: string[]
  clusterIds: number[]
}

/** Provenance supplied by the caller; shape and sha256 are derived here. */
export interface MaskExportMeta {
  datasetName: string
  /** Raw horizontal/vertical pixel size in µm; null when the dataset has none. */
  pixelSizeUm: { x: number; y: number } | null
}

/** The metadata embedded in every export (JSON in .npz, `#` header in .csv). */
export interface EmbeddedMaskMeta {
  formatVersion: 1
  datasetName: string
  /** [rows, cols] of the raster the sha256 covers. */
  shape: [number, number]
  /** Raw horizontal/vertical pixel size in µm; null when unknown. */
  pixelSizeUm: { x: number; y: number } | null
  /** SHA-256 (hex) over the canonical payload: row-major uint8 (0/1), H×W bytes. */
  sha256: string
}

export type MaskImportFormat = 'npz' | 'npy' | 'csv'

export interface MaskImportResult {
  /** Flat row-major 0/1 pixels. */
  mask: Uint8Array<ArrayBuffer>
  shape: [number, number]
  format: MaskImportFormat
  meta: EmbeddedMaskMeta | null
}

export interface MaskImportOptions {
  /** Reject files whose raster shape differs from the current image. */
  expectedShape?: [number, number]
  /** Reject provenance from another dataset; empty provenance is accepted. */
  expectedDatasetName?: string
}

// ── helpers ──────────────────────────────────────────────────────

/** Sanitise a label for use as a filename component. */
function safeFilename(label: string): string {
  const cleaned = label.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60)
  return cleaned || 'mask'
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hasher = await createSHA256()
  hasher.update(data)
  return hasher.digest('hex')
}

function importError(message: string): Error {
  return new Error(`Invalid mask file: ${message}`)
}

function validateMeta(value: unknown): EmbeddedMaskMeta | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<EmbeddedMaskMeta>
  if (v.formatVersion !== 1 || typeof v.datasetName !== 'string' || !Array.isArray(v.shape))
    return null
  const shape = v.shape
  if (shape.length !== 2 || !shape.every((n) => Number.isInteger(n) && n >= 0)) return null
  if (typeof v.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(v.sha256)) return null
  const pixelSizeUm = v.pixelSizeUm
  if (
    pixelSizeUm !== null &&
    (!pixelSizeUm ||
      typeof pixelSizeUm !== 'object' ||
      !Number.isFinite(pixelSizeUm.x) ||
      !Number.isFinite(pixelSizeUm.y))
  ) {
    return null
  }
  return {
    formatVersion: 1,
    datasetName: v.datasetName,
    shape: [shape[0]!, shape[1]!],
    pixelSizeUm: pixelSizeUm as EmbeddedMaskMeta['pixelSizeUm'],
    sha256: v.sha256,
  }
}

interface ParsedNpy {
  data: Uint8Array<ArrayBuffer>
  shape: number[]
}

/** Parse the little-endian NumPy v1/v2 header used by our exports. */
function parseNpy(bytes: Uint8Array): ParsedNpy {
  if (
    bytes.length < 12 ||
    bytes[0] !== 0x93 ||
    new TextDecoder().decode(bytes.subarray(1, 6)) !== 'NUMPY'
  ) {
    throw importError('missing NumPy header')
  }
  const major = bytes[6]
  const headerSize =
    major === 1
      ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(8, true)
      : major === 2
        ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true)
        : 0
  const headerOffset = major === 2 ? 12 : 10
  if (!headerSize || headerOffset + headerSize > bytes.length)
    throw importError('truncated NumPy header')
  const header = new TextDecoder().decode(bytes.subarray(headerOffset, headerOffset + headerSize))
  const descr = /['\"]descr['\"]\s*:\s*['\"]([^'\"]+)['\"]/.exec(header)?.[1]
  if (descr !== '|u1' && descr !== 'u1' && descr !== '|b1' && descr !== 'b1') {
    throw importError(`unsupported dtype ${descr ?? '(unknown)'}`)
  }
  const fortran = /['\"]fortran_order['\"]\s*:\s*(True|False)/.exec(header)?.[1]
  if (fortran !== 'False') throw importError('Fortran-order arrays are not supported')
  const shapeText = /['\"]shape['\"]\s*:\s*\(([^)]*)\)/.exec(header)?.[1]
  const shape = shapeText
    ? shapeText
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => n !== 0 || shapeText.trim() === '0')
    : []
  if (!shape.length || shape.some((n) => !Number.isInteger(n) || n < 0))
    throw importError('invalid shape')
  const size = shape.reduce((a, b) => a * b, 1)
  const data = bytes.slice(headerOffset + headerSize)
  if (data.length < size) throw importError('truncated NumPy payload')
  return { data: data.slice(0, size), shape }
}

function checkShape(shape: number[], expected?: [number, number]) {
  if (shape.length !== 2) throw importError('mask must be a 2-D raster')
  if (expected && (shape[0] !== expected[0] || shape[1] !== expected[1])) {
    throw importError(
      `shape ${shape[0]}×${shape[1]} does not match image ${expected[0]}×${expected[1]}`,
    )
  }
}

async function parseNpz(
  bytes: Uint8Array,
): Promise<{ parsed: ParsedNpy; meta: EmbeddedMaskMeta | null }> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  const isFileEntry = (entry: Entry): entry is FileEntry => !entry.directory
  try {
    const entries = await reader.getEntries()
    const maskEntry = entries.find(
      (entry): entry is FileEntry =>
        isFileEntry(entry) && entry.filename.replace(/\\/g, '/').endsWith('mask.npy'),
    )
    if (!maskEntry) throw importError('NPZ does not contain mask.npy')
    const parsed = parseNpy(await maskEntry.getData(new Uint8ArrayWriter()))
    let meta: EmbeddedMaskMeta | null = null
    const metaEntry = entries.find(
      (entry): entry is FileEntry =>
        isFileEntry(entry) && entry.filename.replace(/\\/g, '/').endsWith('meta.npy'),
    )
    if (metaEntry) {
      const metaNpy = parseNpy(await metaEntry.getData(new Uint8ArrayWriter()))
      try {
        meta = validateMeta(JSON.parse(new TextDecoder().decode(metaNpy.data)))
      } catch {
        throw importError('meta.npy is not valid JSON')
      }
      if (!meta) throw importError('meta.npy has an unsupported schema')
    } else throw importError('NPZ does not contain meta.npy/SHA-256 provenance')
    return { parsed, meta }
  } finally {
    await reader.close()
  }
}

function parseCsv(text: string): { parsed: ParsedNpy; meta: EmbeddedMaskMeta | null } {
  const lines = text.split(/\r?\n/)
  const dataRows: number[][] = []
  let datasetName = ''
  let headerShape: [number, number] | null = null
  let pixelSizeUm: { x: number; y: number } | null = null
  let sha256 = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      const comment = line.slice(1).trim()
      if (comment.startsWith('datasetName:')) datasetName = comment.slice(12).trim()
      else if (comment.startsWith('shape:')) {
        const parts = comment.slice(6).split(',').map(Number)
        if (parts.length === 2 && parts.every((n) => Number.isInteger(n) && n >= 0))
          headerShape = [parts[0]!, parts[1]!]
      } else if (comment.startsWith('pixelSizeUm:')) {
        const parts = comment.slice(12).split(',').map(Number)
        if (parts.length === 2 && parts.every(Number.isFinite))
          pixelSizeUm = { x: parts[0]!, y: parts[1]! }
      } else if (comment.startsWith('sha256:')) sha256 = comment.slice(7).trim()
      continue
    }
    const values = line
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
    if (!values.length || values.some((n) => n !== 0 && n !== 1))
      throw importError('CSV rows must contain only 0 or 1')
    if (dataRows.length && values.length !== dataRows[0]!.length)
      throw importError('CSV rows have inconsistent widths')
    dataRows.push(values)
  }
  if (!dataRows.length || !dataRows[0]!.length) throw importError('CSV contains no raster rows')
  const shape: [number, number] = [dataRows.length, dataRows[0]!.length]
  const data = new Uint8Array(shape[0] * shape[1])
  dataRows.forEach((row, r) => row.forEach((v, c) => (data[r * shape[1] + c] = v)))
  if (headerShape && (headerShape[0] !== shape[0] || headerShape[1] !== shape[1]))
    throw importError('CSV shape header does not match rows')
  const meta = sha256
    ? validateMeta({ formatVersion: 1, datasetName, shape, pixelSizeUm, sha256 })
    : null
  if (sha256 && !meta) throw importError('CSV metadata header is incomplete or invalid')
  return { parsed: { data, shape }, meta }
}

/** Read a MassVision .npz/.csv mask and validate its provenance and dimensions. */
export async function importMask(
  file: Blob,
  options: MaskImportOptions = {},
): Promise<MaskImportResult> {
  const name = typeof File !== 'undefined' && file instanceof File ? file.name.toLowerCase() : ''
  const buffer =
    typeof file.arrayBuffer === 'function'
      ? await file.arrayBuffer()
      : await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error ?? new Error('Unable to read mask file'))
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.readAsArrayBuffer(file)
        })
  const bytes = new Uint8Array(buffer)
  const isNpz = name.endsWith('.npz') || (bytes[0] === 0x50 && bytes[1] === 0x4b)
  const isNpy = name.endsWith('.npy') || bytes[0] === 0x93
  let parsed: ParsedNpy
  let meta: EmbeddedMaskMeta | null = null
  let format: MaskImportFormat
  if (isNpz) {
    ;({ parsed, meta } = await parseNpz(bytes))
    format = 'npz'
  } else if (isNpy) {
    parsed = parseNpy(bytes)
    format = 'npy'
  } else {
    ;({ parsed, meta } = parseCsv(new TextDecoder().decode(bytes)))
    format = 'csv'
  }
  checkShape(parsed.shape, options.expectedShape)
  if (parsed.data.some((value) => value !== 0 && value !== 1)) {
    throw importError('mask payload must contain only 0 or 1')
  }
  if (meta) {
    if (meta.shape[0] !== parsed.shape[0] || meta.shape[1] !== parsed.shape[1])
      throw importError('metadata shape does not match mask')
    const actualHash = await sha256Hex(parsed.data)
    if (actualHash.toLowerCase() !== meta.sha256.toLowerCase())
      throw importError('SHA-256 does not match mask bytes')
    if (
      options.expectedDatasetName &&
      meta.datasetName &&
      meta.datasetName !== options.expectedDatasetName
    ) {
      throw importError(
        `dataset “${meta.datasetName}” does not match current dataset “${options.expectedDatasetName}”`,
      )
    }
  } else throw importError('mask metadata/SHA-256 is missing; import an exported MassVision mask')
  return { mask: parsed.data, shape: [parsed.shape[0]!, parsed.shape[1]!], format, meta }
}

/**
 * ROI 模块下展示的导入掩膜摘要：name/format 来自导入结果，统计在导入时定格
 * （与手绘 ROI confirm 时计算一次的口径一致，不随后续 m/z 切换重算）。
 */
export interface ImportedMaskSummary {
  /** 源文件名（用户认得的标识） */
  name: string
  format: MaskImportFormat
  pixelCount: number
  stats: { mean: number; std: number; min: number; max: number } | null
}

/**
 * Summarize an imported mask for the ROI panel: pixel count always; mean/std/
 * min/max from the current ion matrix when its length matches the raster
 * (skips non-finite values the same way useROI.computeStats does).
 */
export function summarizeImportedMask(
  result: MaskImportResult,
  name: string,
  matrix: Float32Array | null,
): ImportedMaskSummary {
  const mask = result.mask
  let pixelCount = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]) pixelCount++
  const base = { name, format: result.format, pixelCount }
  if (!matrix || matrix.length !== mask.length) return { ...base, stats: null }

  let sum = 0
  let count = 0
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const v = matrix[i] ?? 0
    if (!Number.isFinite(v)) continue
    sum += v
    count++
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!count) return { ...base, stats: null }
  const mean = sum / count
  let sumSq = 0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const v = matrix[i] ?? 0
    if (!Number.isFinite(v)) continue
    sumSq += (v - mean) ** 2
  }
  return { ...base, stats: { mean, std: Math.sqrt(sumSq / count), min, max } }
}

// ── pixel payload (the canonical bytes every format shares) ───────

/** Flatten the boolean raster into row-major uint8 bytes, 0 = false, 1 = true. */
function maskToPayload(mask: boolean[][]): Uint8Array<ArrayBuffer> {
  const height = mask.length
  const width = mask[0]?.length ?? 0
  const payload = new Uint8Array(height * width)
  let off = 0
  for (let r = 0; r < height; r++) {
    const row = mask[r]!
    for (let c = 0; c < width; c++) {
      payload[off++] = row[c] ? 1 : 0
    }
  }
  return payload
}

// ── .npy (NumPy format, dtype=uint8) ──────────────────────────────

/**
 * Wrap raw uint8 bytes as a minimal .npy file. Also used for npz entries —
 * every entry inside an .npz is a complete .npy file (np.savez convention).
 *
 * The output is equivalent to `np.asarray(data, dtype=np.uint8).reshape(shape)`
 * — layout is row-major (C order).
 *
 * Format reference: https://numpy.org/devdocs/reference/generated/numpy.lib.format.html
 *   Header structure (before data):
 *     \x93NUMPY  — 6-byte magic
 *     \x01       — major version
 *     \x00       — minor version
 *     uint16 LE — header length (len(dict_str) + 1, for the trailing \n)
 *     <dict>    — e.g. "{'descr': '|u1', 'fortran_order': False, 'shape': (H, W), }"
 *     \n        — padded so (6+2+header_len) % 64 == 0
 */
function npyUint8(data: Uint8Array, shape: number[]): Uint8Array<ArrayBuffer> {
  // Python repr: (N,) for 1-D, (H, W) for 2-D
  const shapeStr = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`
  const dictStr = `{'descr': '|u1', 'fortran_order': False, 'shape': ${shapeStr}, }\n`

  // Total bytes before data = 6 (magic) + 2 (version bytes) + 2 (header_len uint16) + dictStr
  // Must be divisible by 64. Pad with spaces inserted before the trailing \n.
  const prefixLen = 6 + 2 // \x93NUMPY + \x01\x00
  const headerLenField = 2 // uint16
  const preambleBytes = prefixLen + headerLenField + dictStr.length
  const padding = Math.ceil(preambleBytes / 64) * 64 - preambleBytes
  const paddedDict = dictStr.slice(0, -1) + ' '.repeat(padding) + '\n'

  const headerLenVal = paddedDict.length // includes trailing \n
  const totalBytes = prefixLen + headerLenField + headerLenVal + data.length
  const buf = new ArrayBuffer(totalBytes)
  const view = new DataView(buf)

  // Magic: \x93NUMPY
  view.setUint8(0, 0x93)
  for (let i = 0; i < 5; i++) view.setUint8(1 + i, 'NUMPY'.charCodeAt(i))
  // Version: 1.0
  view.setUint8(6, 1)
  view.setUint8(7, 0)
  // Header length (little-endian uint16)
  view.setUint16(8, headerLenVal, true)

  // Dict string (pure ASCII — numbers and fixed keys only)
  const strOffset = 10
  for (let i = 0; i < paddedDict.length; i++) {
    view.setUint8(strOffset + i, paddedDict.charCodeAt(i))
  }

  // Payload bytes
  const out = new Uint8Array(buf)
  out.set(data, strOffset + paddedDict.length)
  return out
}

// ── zip (STORE only) — the container half of .npz ────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 (IEEE 802.3, the zip polynomial). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Build a zip archive with every entry stored uncompressed, matching
 * np.savez's ZIP_STORED convention. Covers what an npz needs: flat names,
 * no per-entry extras, no comments — numpy's zipfile reader round-trips it.
 */
function buildZipStore(
  entries: { name: string; data: Uint8Array<ArrayBuffer> }[],
): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const locals: Uint8Array<ArrayBuffer>[] = []
  const centrals: Uint8Array<ArrayBuffer>[] = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name)
    const crc = crc32(data)

    // Local file header (30 bytes + name), immediately followed by the data.
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // 'PK\x03\x04'
    lv.setUint16(4, 20, true) // version needed (2.0)
    lv.setUint16(6, 0, true) // general purpose flags
    lv.setUint16(8, 0, true) // method: STORE
    lv.setUint16(10, 0, true) // mod time
    lv.setUint16(12, 0x0021, true) // mod date: 1980-01-01 (fixed)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true) // compressed size
    lv.setUint32(22, data.length, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra length
    local.set(nameBytes, 30)
    locals.push(local, data)

    // Central directory header (46 bytes + name), pointing back to `offset`.
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // 'PK\x01\x02'
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0, true) // flags
    cv.setUint16(10, 0, true) // method: STORE
    cv.setUint16(12, 0, true) // mod time
    cv.setUint16(14, 0x0021, true) // mod date
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // extra length
    cv.setUint16(32, 0, true) // comment length
    cv.setUint16(34, 0, true) // disk number start
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, offset, true) // local header offset
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length + data.length
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0)

  // End of central directory record (22 bytes).
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // 'PK\x05\x06'
  ev.setUint16(4, 0, true) // this disk
  ev.setUint16(6, 0, true) // disk with central dir
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true) // central dir offset
  ev.setUint16(20, 0, true) // comment length

  const out = new Uint8Array(offset + centralSize + 22)
  let off = 0
  for (const chunk of [...locals, ...centrals, eocd]) {
    out.set(chunk, off)
    off += chunk.length
  }
  return out
}

// ── mask composition ─────────────────────────────────────────────

/** All-false mask of the given size, indexed [row][col]. */
export function createMask(width: number, height: number): boolean[][] {
  const mask: boolean[][] = new Array(height)
  for (let r = 0; r < height; r++) mask[r] = new Array<boolean>(width).fill(false)
  return mask
}

/**
 * OR `src` into `dest` in place: a destination pixel becomes true if either
 * side is true. Sizes are assumed to match; rows/cols beyond either raster are
 * skipped defensively.
 */
export function orMask(dest: boolean[][], src: boolean[][]): void {
  const rows = Math.min(dest.length, src.length)
  for (let r = 0; r < rows; r++) {
    const destRow = dest[r]!
    const srcRow = src[r]!
    const cols = Math.min(destRow.length, srcRow.length)
    for (let c = 0; c < cols; c++) {
      if (srcRow[c]) destRow[c] = true
    }
  }
}

/**
 * Merge the given KMeans clusters into a binary mask: a pixel is foreground
 * when its label is one of `clusterIds`. Background (label -1) is therefore
 * always excluded.
 */
export function labelsToUnionMask(
  labels: Int32Array,
  width: number,
  height: number,
  clusterIds: Iterable<number>,
): boolean[][] {
  const selected = new Set(clusterIds)
  const mask: boolean[][] = new Array(height)
  for (let r = 0; r < height; r++) {
    const row = new Array<boolean>(width)
    const off = r * width
    for (let c = 0; c < width; c++) {
      row[c] = selected.has(labels[off + c]!)
    }
    mask[r] = row
  }
  return mask
}

// ── public API ───────────────────────────────────────────────────

/** Pure build step: compute payload/hash/meta and assemble the file bytes. */
export async function buildMaskExport(
  mask: boolean[][],
  format: ExportFormat,
  meta: MaskExportMeta,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string; mime: string }> {
  const height = mask.length
  const width = mask[0]?.length ?? 0
  const payload = maskToPayload(mask)
  const sha256 = await sha256Hex(payload)

  const embedded: EmbeddedMaskMeta = {
    formatVersion: 1,
    datasetName: meta.datasetName,
    shape: [height, width],
    pixelSizeUm: meta.pixelSizeUm,
    sha256,
  }

  // File stem: "{datasetName}_mask", falling back to "mask" when unnamed.
  const stem = meta.datasetName ? `${safeFilename(meta.datasetName)}_mask` : 'mask'

  if (format === 'npz') {
    const enc = new TextEncoder()
    const metaBytes = enc.encode(JSON.stringify(embedded))
    const bytes = buildZipStore([
      { name: 'mask.npy', data: npyUint8(payload, [height, width]) },
      { name: 'meta.npy', data: npyUint8(metaBytes, [metaBytes.length]) },
    ])
    return { bytes, filename: `${stem}.npz`, mime: 'application/octet-stream' }
  }

  const lines = [
    `# datasetName: ${embedded.datasetName}`,
    `# shape: ${embedded.shape[0]},${embedded.shape[1]}`,
    ...(embedded.pixelSizeUm
      ? [`# pixelSizeUm: ${embedded.pixelSizeUm.x},${embedded.pixelSizeUm.y}`]
      : []),
    `# sha256: ${embedded.sha256}`,
  ]
  for (const row of mask) lines.push(row.map((v) => (v ? '1' : '0')).join(','))
  return {
    bytes: new TextEncoder().encode(lines.join('\n')),
    filename: `${stem}.csv`,
    mime: 'text/csv',
  }
}

/** Download a single mask as .npz (uint8 + meta) or .csv (0/1 rows + # header). */
export async function exportMask(
  mask: boolean[][],
  format: ExportFormat,
  meta: MaskExportMeta,
): Promise<void> {
  const { bytes, filename, mime } = await buildMaskExport(mask, format, meta)
  downloadBlob(new Blob([bytes], { type: mime }), filename)
}
