import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZarrIncompatibleError, ZarrStore } from '../zarrStore'
import { ZarrFetchError } from '../zarrHttpClient'

// 内存里的 zarr 目录：zarr 内相对路径 → 对象字节；不存在的路径按真实客户端的方式抛 not_found。
// requested 记下每次读取的路径；failures 里的路径读取时抛出给定错误
const { objects, requested, failures } = vi.hoisted(() => ({
  objects: new Map<string, ArrayBuffer>(),
  requested: [] as string[],
  failures: new Map<string, Error>(),
}))

vi.mock('../zarrHttpClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../zarrHttpClient')>()
  return {
    ...actual,
    createZarrHttpClient: () => ({
      getObjectArrayBuffer: async (path: string) => {
        requested.push(path)
        const failure = failures.get(path)
        if (failure) throw failure
        const buf = objects.get(path)
        if (!buf) {
          throw new actual.ZarrFetchError('not_found', `object not found: ${path}`, path, 404)
        }
        return buf.slice(0)
      },
    }),
  }
})

const ZARR_URL = 'https://cdn.test/processed/run.zarr/'

type NumericArray = Float32Array | Float64Array | Uint32Array | BigInt64Array

function putJson(path: string, value: unknown) {
  objects.set(path, new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer)
}

function putGroup(path: string, attributes: Record<string, unknown>) {
  putJson(path ? `${path}/zarr.json` : 'zarr.json', { zarr_format: 3, node_type: 'group', attributes })
}

/** 未压缩的 zarr v3 数组，沿第一维按 chunkShape[0] 切块（边缘块不补齐），其余维不分块 */
function putArray(path: string, dataType: string, shape: number[], chunkShape: number[], data: NumericArray) {
  putJson(`${path}/zarr.json`, {
    zarr_format: 3,
    node_type: 'array',
    shape,
    data_type: dataType,
    chunk_grid: { name: 'regular', configuration: { chunk_shape: chunkShape } },
    chunk_key_encoding: { name: 'default', configuration: { separator: '/' } },
    codecs: [{ name: 'bytes', configuration: { endian: 'little' } }],
    fill_value: 0,
  })
  const bytesPerRow = shape.slice(1).reduce((a, b) => a * b, 1) * data.BYTES_PER_ELEMENT
  const trailingKey = shape.slice(1).map(() => '/0').join('')
  const rowsPerChunk = chunkShape[0]!
  for (let c = 0; c * rowsPerChunk < shape[0]!; c++) {
    const startRow = c * rowsPerChunk
    const endRow = Math.min(shape[0]!, startRow + rowsPerChunk)
    objects.set(
      `${path}/c/${c}${trailingKey}`,
      data.buffer.slice(startRow * bytesPerRow, endRow * bytesPerRow) as ArrayBuffer,
    )
  }
}

const int64 = (values: number[]) => BigInt64Array.from(values.map((v) => BigInt(v)))

// 2×3 网格上采集了 5 个像素（(3, 2) 是未采集的背景），坐标 1-based
const COORDS = [
  [1, 1],
  [2, 1],
  [3, 1],
  [1, 2],
  [2, 2],
] as const
const N_PIXELS = COORDS.length
const MZ_AXIS = [100.5, 200.5, 300.5, 400.5]
const N_MZ = MZ_AXIS.length

function putCommon() {
  putGroup('', {
    format: 'massflow.msi_zarr',
    format_version: '1.1',
    write_state: 'complete',
    coordinate_order: ['x', 'y', 'z'],
    coordinate_base: 1,
    spatial_shape: [2, 3],
  })
  putArray(
    'axes/coordinates',
    'uint32',
    [N_PIXELS, 3],
    [N_PIXELS, 3],
    Uint32Array.from(COORDS.flatMap(([x, y]) => [x, y, 1])),
  )
}

/** v1.1 continuous：ion_image（离子主序）+ 可选的 spectra（像素主序，像素 p 的第 k 个值为 p*10+k） */
function putContinuous(options: { spectra?: boolean; spectraOffsets?: number[] } = {}) {
  putCommon()
  putArray('axes/mz', 'float64', [N_MZ], [N_MZ], Float64Array.from(MZ_AXIS))
  putGroup('ion_image', { row_axis: 'ion', encoding: 'continuous' })
  putArray(
    'ion_image/intensity',
    'float32',
    [N_MZ * N_PIXELS],
    [10],
    Float32Array.from({ length: N_MZ * N_PIXELS }, (_, i) => i),
  )
  putArray('ion_image/offsets', 'int64', [N_MZ + 1], [N_MZ + 1], int64([0, 5, 10, 15, 20]))
  if (options.spectra === false) return
  putGroup('spectra', { row_axis: 'pixel', encoding: 'continuous' })
  // chunk 为 6 个值：像素 1（元素 4..7）和像素 4（元素 16..19）的谱都跨 chunk 边界
  putArray(
    'spectra/intensity',
    'float32',
    [N_PIXELS * N_MZ],
    [6],
    Float32Array.from({ length: N_PIXELS * N_MZ }, (_, i) => Math.floor(i / N_MZ) * 10 + (i % N_MZ)),
  )
  const offsets = options.spectraOffsets ?? [0, 4, 8, 12, 16, 20]
  putArray('spectra/offsets', 'int64', [offsets.length], [offsets.length], int64(offsets))
}

/** v1.1 processed：只有 spectra（像素主序，每个点自带 m/z），没有 ion_image、axes/mz、平均谱 */
function putProcessed() {
  putCommon()
  putGroup('spectra', { row_axis: 'pixel', encoding: 'processed' })
  putArray('spectra/intensity', 'float32', [7], [4], Float32Array.from([1, 2, 3, 4, 5, 6, 7]))
  const mz = Float64Array.from([101, 102, 103, 201, 202, 301, 302])
  putArray('spectra/mz', 'float64', [7], [4], mz)
  // 像素 2 与像素 4 的谱为空
  putArray('spectra/offsets', 'int64', [N_PIXELS + 1], [N_PIXELS + 1], int64([0, 3, 5, 5, 7, 7]))
}

const forbidden = (path: string) => new ZarrFetchError('forbidden', `forbidden: ${path}`, path, 403)

async function openStore() {
  const store = new ZarrStore(ZARR_URL)
  await store.init()
  return store
}

describe('ZarrStore', () => {
  beforeEach(() => {
    objects.clear()
    requested.length = 0
    failures.clear()
    // DEV 模式下 init 会打印结构表 / 缺失的可选数组，测试里静音
    vi.spyOn(console, 'table').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects the v1.0 single data/ group layout as incompatible', async () => {
    putCommon()
    putArray('axes/mz', 'float64', [N_MZ], [N_MZ], Float64Array.from(MZ_AXIS))
    putGroup('data', { row_axis: 'ion', encoding: 'continuous' })
    putArray('data/intensity', 'float32', [N_MZ * N_PIXELS], [10], new Float32Array(N_MZ * N_PIXELS))
    putArray('data/offsets', 'int64', [N_MZ + 1], [N_MZ + 1], int64([0, 5, 10, 15, 20]))

    await expect(new ZarrStore(ZARR_URL).init()).rejects.toBeInstanceOf(ZarrIncompatibleError)
  })

  it('reads a continuous pixel spectrum from the spectra group across chunk boundaries', async () => {
    putContinuous()
    const store = await openStore()
    expect(store.dataMode).toBe('continuous')
    expect(store.hasSpectra).toBe(true)

    const second = await store.getPixelSpectrum(1)
    expect(Array.from(second!.intensity)).toEqual([10, 11, 12, 13])
    expect({ x: second!.x, y: second!.y }).toEqual({ x: 2, y: 1 })
    // m/z 直接复用共享轴，不复制
    expect(second!.mz).toBe(await store.loadMzAxis())

    const last = await store.getPixelSpectrum(4)
    expect(Array.from(last!.intensity)).toEqual([40, 41, 42, 43])
    expect({ x: last!.x, y: last!.y }).toEqual({ x: 2, y: 2 })
  })

  it('maps a clicked zero-based grid cell to its index in coordinates order', async () => {
    putContinuous()
    const store = await openStore()
    // (col 1, row 1) → 1-based 坐标 (2, 2) → 第 5 个采集像素
    expect(await store.findPixelByPosition(1, 1)).toBe(4)
  })

  it('rasterizes the acquired cells, leaving background and out-of-grid coordinates out', async () => {
    putContinuous()
    const store = await openStore()
    // 2×3 网格，(3, 2) 没有采集
    expect(Array.from(await store.loadAcquiredRaster())).toEqual([1, 1, 1, 1, 1, 0])

    // 第 3 个像素的坐标落在网格外（x = 4），不占任何格子
    const coords = COORDS.map(([x, y], i) => (i === 2 ? [4, y] : [x, y]))
    putArray(
      'axes/coordinates',
      'uint32',
      [N_PIXELS, 3],
      [N_PIXELS, 3],
      Uint32Array.from(coords.flatMap(([x, y]) => [x!, y!, 1])),
    )
    const shifted = await openStore()
    expect(Array.from(await shifted.loadAcquiredRaster())).toEqual([1, 1, 0, 1, 1, 0])
  })

  it('requires the spectra group for continuous pixel spectra', async () => {
    putContinuous({ spectra: false })
    const store = await openStore()
    expect(store.hasSpectra).toBe(false)
    await expect(store.getPixelSpectrum(0)).rejects.toThrow(/spectra group/)
  })

  it('rejects spectra rows whose length does not match the m/z axis', async () => {
    putContinuous({ spectraOffsets: [0, 3, 8, 12, 16, 20] })
    const store = await openStore()
    await expect(store.getPixelSpectrum(0)).rejects.toThrow(/has 3 values, expected 4/)
  })

  it('reads processed spectra when spectra/ is the main data group', async () => {
    putProcessed()

    const store = await openStore()
    expect(store.dataMode).toBe('processed')

    const spectrum = await store.getPixelSpectrum(1)
    expect(Array.from(spectrum!.mz)).toEqual([201, 202])
    expect(Array.from(spectrum!.intensity)).toEqual([4, 5])
    expect(await store.getPixelSpectrum(2)).toBeNull()
  })

  it('settles processed data from spectra/ without requesting objects it cannot have', async () => {
    putProcessed()
    await openStore()

    // CDN 不缓存 404：processed 没有 ion_image/ 和平均谱，请求它们每次都要回源
    expect(requested).not.toContain('ion_image/zarr.json')
    expect(requested).not.toContain('stats/mean_spectrum/zarr.json')
    expect(requested.filter((path) => path === 'spectra/zarr.json')).toHaveLength(1)
  })

  it('reads each group zarr.json once when opening continuous data', async () => {
    putContinuous()
    const store = await openStore()

    expect(store.hasSpectra).toBe(true)
    expect(requested.filter((path) => path === 'spectra/zarr.json')).toHaveLength(1)
    expect(requested.filter((path) => path === 'ion_image/zarr.json')).toHaveLength(1)
  })

  it('still opens continuous data without pixel spectra when spectra/zarr.json is unreadable', async () => {
    putContinuous()
    failures.set('spectra/zarr.json', forbidden('spectra/zarr.json'))

    const store = await openStore()
    expect(store.dataMode).toBe('continuous')
    expect(store.hasSpectra).toBe(false)
  })

  it('fails when spectra/ would be the main data group but cannot be read', async () => {
    putProcessed()
    const failure = forbidden('spectra/zarr.json')
    failures.set('spectra/zarr.json', failure)

    await expect(new ZarrStore(ZARR_URL).init()).rejects.toBe(failure)
  })
})
