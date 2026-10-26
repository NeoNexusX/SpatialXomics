import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  buildMaskExport,
  crc32,
  importMask,
  summarizeImportedMask,
  type EmbeddedMaskMeta,
  type MaskExportMeta,
} from '../maskExport'

// ── test helpers ─────────────────────────────────────────────────

/** Build a boolean raster from strings of '0'/'1'. */
function maskOf(rows: string[]): boolean[][] {
  return rows.map((r) => [...r].map((ch) => ch === '1'))
}

const META: MaskExportMeta = {
  datasetName: 'colon_2024',
  pixelSizeUm: { x: 10, y: 10 },
}

/** SHA-256 hex over the canonical payload, via an INDEPENDENT implementation. */
function sha256Independent(payload: number[]): string {
  return createHash('sha256').update(new Uint8Array(payload)).digest('hex')
}

/** Minimal zip reader: walk the central directory, return name → STORE data. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('EOCD signature not found')

  const count = dv.getUint16(eocd + 10, true)
  let ptr = dv.getUint32(eocd + 16, true)
  const out = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) throw new Error('bad central header')
    const crc = dv.getUint32(ptr + 16, true)
    const size = dv.getUint32(ptr + 24, true)
    const nameLen = dv.getUint16(ptr + 28, true)
    const localOff = dv.getUint32(ptr + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))

    if (dv.getUint32(localOff, true) !== 0x04034b50) throw new Error('bad local header')
    if (dv.getUint16(localOff + 8, true) !== 0) throw new Error('entry not STOREd')
    const localNameLen = dv.getUint16(localOff + 26, true)
    const data = bytes.subarray(localOff + 30 + localNameLen, localOff + 30 + localNameLen + size)
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for entry ${name}`)
    out.set(name, data)
    ptr += 46 + nameLen
  }
  return out
}

/** Minimal .npy reader: return the header dict string and the data bytes. */
function parseNpy(entry: Uint8Array): { dict: string; data: Uint8Array } {
  const magic = String.fromCharCode(...entry.subarray(0, 6))
  if (magic !== '\x93NUMPY') throw new Error(`bad npy magic: ${magic}`)
  const dv = new DataView(entry.buffer, entry.byteOffset, entry.byteLength)
  const headerLen = dv.getUint16(8, true)
  if ((10 + headerLen) % 64 !== 0) throw new Error('npy header not 64-byte aligned')
  return {
    dict: String.fromCharCode(...entry.subarray(10, 10 + headerLen)),
    data: entry.subarray(10 + headerLen),
  }
}

// ── tests ────────────────────────────────────────────────────────

describe('crc32', () => {
  it('matches the IEEE 802.3 check value', () => {
    // Standard CRC-32 test vector.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})

describe('buildMaskExport (.npz)', () => {
  it('produces a zip with mask + meta entries carrying hashable metadata', async () => {
    const { bytes, filename, mime } = await buildMaskExport(maskOf(['010', '111']), 'npz', META)

    expect(filename).toBe('colon_2024_mask.npz')
    expect(mime).toBe('application/octet-stream')

    const entries = unzip(bytes)
    expect([...entries.keys()].sort()).toEqual(['mask.npy', 'meta.npy'])

    const maskNpy = parseNpy(entries.get('mask.npy')!)
    expect(maskNpy.dict).toContain("'descr': '|u1'")
    expect(maskNpy.dict).toContain("'fortran_order': False")
    expect(maskNpy.dict).toContain("'shape': (2, 3)")
    expect([...maskNpy.data]).toEqual([0, 1, 0, 1, 1, 1])

    const metaNpy = parseNpy(entries.get('meta.npy')!)
    const meta = JSON.parse(new TextDecoder().decode(metaNpy.data)) as EmbeddedMaskMeta
    expect(meta.formatVersion).toBe(1)
    expect(meta.datasetName).toBe('colon_2024')
    expect(meta.shape).toEqual([2, 3])
    expect(meta.pixelSizeUm).toEqual({ x: 10, y: 10 })
    // Hash verified against node:crypto, not hash-wasm — two independent
    // implementations agreeing rules out a bug shared by writer and checker.
    expect(meta.sha256).toBe(sha256Independent([0, 1, 0, 1, 1, 1]))
  })

  it('omits pixelSizeUm (null) instead of writing a placeholder', async () => {
    const { bytes } = await buildMaskExport(maskOf(['1']), 'npz', {
      datasetName: 'd',
      pixelSizeUm: null,
    })
    const metaNpy = parseNpy(unzip(bytes).get('meta.npy')!)
    const meta = JSON.parse(new TextDecoder().decode(metaNpy.data)) as EmbeddedMaskMeta
    expect(meta.pixelSizeUm).toBeNull()
  })

  it('falls back to "mask" when the dataset has no name', async () => {
    const { filename } = await buildMaskExport(maskOf(['1']), 'npz', {
      datasetName: '',
      pixelSizeUm: null,
    })
    expect(filename).toBe('mask.npz')
  })
})

describe('buildMaskExport (.csv)', () => {
  it('writes a # header that loadtxt/pandas skip, then 0/1 rows', async () => {
    const { bytes, filename, mime } = await buildMaskExport(maskOf(['010', '111']), 'csv', META)

    expect(filename).toBe('colon_2024_mask.csv')
    expect(mime).toBe('text/csv')

    const lines = new TextDecoder().decode(bytes).split('\n')
    expect(lines[0]).toBe('# datasetName: colon_2024')
    expect(lines).toContain('# datasetName: colon_2024')
    expect(lines).toContain('# shape: 2,3')
    expect(lines).toContain('# pixelSizeUm: 10,10')
    expect(lines).toContain(`# sha256: ${sha256Independent([0, 1, 0, 1, 1, 1])}`)
    expect(lines.slice(-2)).toEqual(['0,1,0', '1,1,1'])
  })

  it('omits the pixelSizeUm line when unknown', async () => {
    const { bytes } = await buildMaskExport(maskOf(['1']), 'csv', {
      datasetName: 'd',
      pixelSizeUm: null,
    })
    const text = new TextDecoder().decode(bytes)
    expect(text).not.toContain('pixelSizeUm')
  })
})

describe('hash semantics', () => {
  it('is deterministic for identical masks and format-independent', async () => {
    const mask = maskOf(['010', '111'])
    const [npz, csv] = await Promise.all([
      buildMaskExport(mask, 'npz', META),
      buildMaskExport(mask, 'csv', META),
    ])
    const npzMeta = JSON.parse(
      new TextDecoder().decode(parseNpy(unzip(npz.bytes).get('meta.npy')!).data),
    ) as EmbeddedMaskMeta
    const csvSha = new TextDecoder()
      .decode(csv.bytes)
      .split('\n')
      .find((l) => l.startsWith('# sha256: '))
      ?.slice('# sha256: '.length)
    expect(npzMeta.sha256).toBe(csvSha)
  })

  it('changes when a single pixel flips', async () => {
    const shaOf = async (mask: boolean[][]) => {
      const { bytes } = await buildMaskExport(mask, 'csv', META)
      return new TextDecoder()
        .decode(bytes)
        .split('\n')
        .find((l) => l.startsWith('# sha256: '))
        ?.slice('# sha256: '.length)
    }
    const a = await shaOf(maskOf(['010', '111']))
    const b = await shaOf(maskOf(['010', '110']))
    expect(a).not.toBe(b)
    expect(a).toBe(sha256Independent([0, 1, 0, 1, 1, 1]))
    expect(b).toBe(sha256Independent([0, 1, 0, 1, 1, 0]))
  })
})

describe('importMask', () => {
  it('round-trips an exported NPZ and verifies its metadata', async () => {
    const exported = await buildMaskExport(maskOf(['010', '111']), 'npz', META)
    const result = await importMask(new File([exported.bytes], exported.filename), {
      expectedShape: [2, 3],
      expectedDatasetName: META.datasetName,
    })

    expect(result.format).toBe('npz')
    expect(result.shape).toEqual([2, 3])
    expect([...result.mask]).toEqual([0, 1, 0, 1, 1, 1])
    expect(result.meta?.sha256).toBe(sha256Independent([0, 1, 0, 1, 1, 1]))
  })

  it('rejects a CSV whose payload no longer matches the embedded SHA-256', async () => {
    const exported = await buildMaskExport(maskOf(['010', '111']), 'csv', META)
    const text = new TextDecoder().decode(exported.bytes).replace('1,1,1', '1,1,0')

    await expect(importMask(new File([text], exported.filename))).rejects.toThrow('SHA-256')
  })

  it('rejects a mask from another dataset even when its hash is valid', async () => {
    const exported = await buildMaskExport(maskOf(['1']), 'csv', META)

    await expect(
      importMask(new File([exported.bytes], exported.filename), {
        expectedShape: [1, 1],
        expectedDatasetName: 'another_dataset',
      }),
    ).rejects.toThrow('does not match current dataset')
  })
})

describe('summarizeImportedMask', () => {
  it('counts pixels and computes stats over the masked matrix values', async () => {
    const exported = await buildMaskExport(maskOf(['010', '111']), 'csv', META)
    const result = await importMask(new File([exported.bytes], exported.filename), {
      expectedShape: [2, 3],
    })
    // masked values: 20, 40, 50, 60 → mean 42.5, std √218.75
    const summary = summarizeImportedMask(
      result,
      'colon_mask.csv',
      new Float32Array([10, 20, 30, 40, 50, 60]),
    )

    expect(summary.name).toBe('colon_mask.csv')
    expect(summary.format).toBe('csv')
    expect(summary.pixelCount).toBe(4)
    expect(summary.stats?.mean).toBeCloseTo(42.5)
    expect(summary.stats?.std).toBeCloseTo(Math.sqrt(218.75))
    expect(summary.stats?.min).toBe(20)
    expect(summary.stats?.max).toBe(60)
  })

  it('returns null stats when the matrix is missing or size-mismatched', async () => {
    const exported = await buildMaskExport(maskOf(['010', '111']), 'csv', META)
    const result = await importMask(new File([exported.bytes], exported.filename), {
      expectedShape: [2, 3],
    })

    expect(summarizeImportedMask(result, 'm.csv', null).stats).toBeNull()
    expect(summarizeImportedMask(result, 'm.csv', new Float32Array(3)).stats).toBeNull()
    // 像素数来自掩膜本身，始终可得
    expect(summarizeImportedMask(result, 'm.csv', null).pixelCount).toBe(4)
  })
})
