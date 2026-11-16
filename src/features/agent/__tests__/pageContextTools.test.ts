/**
 * get_page / get_dataset / get_ion / get_annotation / 排名窗口工具的行为锁定：
 * - get_page：完整页面状态（header/dataset/ion/annotation 头与 rank 1–10 预览）
 * - get_dataset：排除表（imagePath/hashMd5/publicId 不出现，organism 等样本字段出现），
 *   raw 未知键透传，'--' 占位转 null
 * - get_ion：通道列表与 ROI/掩膜段；withImage:false 省略 images 字段（不返回 []）
 * - get_annotation：默认窗口 rank 1–10；offset:19/limit:11 返回 rank 20–30；
 *   窗口与筛选解耦；精确 rowIds/mzs 与 offset/limit 互斥
 * - get_mean_spectrum_top_peaks / get_pixel_spectrum：任意 rank 窗口（先完整排序再切片）
 * - get_ion_image：mz/mzs/rowIds 选择器互斥
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../plugins/tool-page-context'
import * as toolPageContextPlugin from '../plugins/tool-page-context'
import { apply as applyIonImage } from '../plugins/tool-ion-image'
import { SystemPrompt } from '../plugins/system-prompt'
import { ToolRuntime } from '../plugins/tools'
import { SkillsRegistry } from '../plugins/skill'
import type { ToolDefinition, ToolRunContext } from '../plugins/tools'
import { registerContextProviders, unregisterContextProviders } from '../bridge/analysisContext'
import {
  dataModeRef,
  ionDims,
  mzAxisRef,
  pixelSpectrum,
  resetZarrSharedState,
  setZarrStore,
} from '@/services/zarr/zarrSharedState'
import type { AnnotationRow } from '../bridge/analysisTypes'
import type { ZarrOssStore } from '@/services/zarr/zarrOssStore'

/** 不拉起 cordis：桩 ctx 捕获注册的工具定义，直接执行 execute */
function loadTools(): ToolDefinition[] {
  const defs: ToolDefinition[] = []
  apply({
    tools: { register: (def: ToolDefinition) => defs.push(def) },
  } as unknown as Parameters<typeof apply>[0])
  applyIonImage({
    tools: { register: (def: ToolDefinition) => defs.push(def) },
  } as unknown as Parameters<typeof applyIonImage>[0])
  return defs
}

const exec: ToolRunContext = {
  signal: new AbortController().signal,
  callId: 't',
  name: 'get_page',
}

function loadTool(name: string): ToolDefinition {
  const def = loadTools().find((d) => d.name === name)
  if (!def) throw new Error(`tool ${name} not registered`)
  return def
}

function runTool(name: string, args: Record<string, unknown> = {}) {
  return loadTool(name).execute(args as never, { ...exec, name }) as Promise<unknown>
}

/** 测试用注释行（rank 连续，i+1） */
function annotationRows(n: number): AnnotationRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    rank: i + 1,
    name: `row ${i + 1}`,
    origin: null,
    candidates: [],
    formula: `C${i + 1}H${2 * i + 2}`,
    adduct: '[M+H]+',
    theoMz: 100 + i,
    obsMz: 100.005 + i,
    errPpm: 1,
    intensity: 1000 - i,
    massScore: 0.9,
    adductFit: 0.8,
    chaos: null,
    coloc: null,
    spatialScore: null,
    totalScore: 0.85,
    q: 0.05,
    siblings: [],
    samePeak: [],
    missingAdducts: [],
  }))
}

// jsdom 无 canvas：mock 渲染层返回固定 1×1 PNG（模块级，被 vitest 提升）
vi.mock('../plugins/tool-ion-image/render', async (importOriginal) => {
  const original = await importOriginal<typeof import('../plugins/tool-ion-image/render')>()
  const stubImage = () => ({
    dataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==',
    mime: 'image/png' as const,
    width: 1,
    height: 1,
    label: 'stub',
  })
  return {
    ...original,
    renderIonImages: vi.fn(() => ({ images: [stubImage()], description: 'stub render (jsdom)' })),
    renderOverlayImage: vi.fn(stubImage),
    renderSpectrumPlot: vi.fn(stubImage),
  }
})

afterEach(() => {
  resetZarrSharedState()
  unregisterContextProviders()
  setZarrStore(null)
  vi.restoreAllMocks()
})

describe('get_annotation rank window', () => {
  const registerAnnotations = (n: number, visibleRows = n) =>
    registerContextProviders({
      annotations: () => ({
        count: n,
        rows: () => annotationRows(n),
        panelRows: () => annotationRows(n),
        weights: { mass: 0.6, adduct: 0.1, spatial: 0.3 },
        panel: () => ({
          summary: null,
          conditions: null,
          filters: {
            qLevel: 'all',
            adductFilter: [],
            siblingsOnly: false,
            moleculeFilter: null,
            searchQuery: 'filtered!',
            sortKey: 'total',
            sortReverse: false,
          },
          visibleRows,
          runState: 'done',
          dbInfo: { label: 'HMDB', count: 100 },
          peakStats: { axis: 100, nonZero: 90, kept: 80 },
        }),
      }),
    })

  it('default window returns rank 1-10 with paging metadata', async () => {
    registerAnnotations(30)
    const out = JSON.parse(String(await runTool('get_annotation')))
    expect(out.rows).toHaveLength(10)
    expect(out.rows[0].rank).toBe(1)
    expect(out.rows[9].rank).toBe(10)
    expect(out.paging).toMatchObject({ total: 30, offset: 0, returned: 10, nextOffset: 10 })
    // 面板头带归一化权重（与 conditions.scoreRatio 的输入比例对应）
    expect(out.panel.weights).toEqual({ mass: 0.6, adduct: 0.1, spatial: 0.3 })
  })

  it('offset 19 + limit 11 returns rank 20-30 regardless of table filters', async () => {
    registerAnnotations(30, 5) // 表格筛选后只剩 5 行可见：窗口仍读全量
    const out = JSON.parse(String(await runTool('get_annotation', { offset: 19, limit: 11 })))
    expect(out.rows.map((r: AnnotationRow) => r.rank)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
    expect(out.paging).toMatchObject({ total: 30, offset: 19, returned: 11, nextOffset: null })
    // 面板头报告筛选态与可见行数，窗口口径不受影响
    expect(out.panel.filters.searchQuery).toBe('filtered!')
    expect(out.panel.visibleRows).toBe(5)
  })

  it('beyond-total offset returns an empty page with valid paging metadata', async () => {
    registerAnnotations(12)
    const out = JSON.parse(String(await runTool('get_annotation', { offset: 50, limit: 10 })))
    expect(out.rows).toEqual([])
    expect(out.paging).toMatchObject({ total: 12, offset: 50, returned: 0, nextOffset: null })
  })

  it('exact rowIds conflict with the rank window', async () => {
    registerAnnotations(30)
    await expect(runTool('get_annotation', { rowIds: [3], offset: 5 })).rejects.toThrow(
      /mutually exclusive/i,
    )
  })

  it('exact rowIds returns the requested full rows', async () => {
    registerAnnotations(30)
    const out = String(await runTool('get_annotation', { rowIds: [4, 2] }))
    expect(out).toContain('rowId: 4')
    expect(out).toContain('rowId: 2')
  })

  it('returns a zero-row page when annotation context exists but has no matches', async () => {
    registerContextProviders({
      annotations: () => ({
        count: 0,
        rows: () => [],
        panelRows: () => [],
        weights: { mass: 0.6, adduct: 0.1, spatial: 0.3 },
        panel: () => ({
          summary: null, conditions: null, filters: null, visibleRows: 0,
          runState: 'done', dbInfo: null, peakStats: null,
        }),
      }),
    })
    const out = JSON.parse(String(await runTool('get_annotation')))
    expect(out.rows).toEqual([])
    expect(out.paging).toMatchObject({ total: 0, returned: 0, nextOffset: null })
    expect(out.panel.runState).toBe('done')
  })

  it('keeps oversized first row results valid and advances the cursor', async () => {
    const row = annotationRows(1)[0]!
    row.candidates = Array.from({ length: 500 }, (_, i) => ({
      id: `candidate-${i}`, name: 'compound'.repeat(50), origin: null,
    }))
    registerContextProviders({
      annotations: () => ({
        count: 2,
        rows: () => [row, ...annotationRows(1).map((r) => ({ ...r, id: 2, rank: 2 }))],
        panelRows: () => [row, ...annotationRows(1).map((r) => ({ ...r, id: 2, rank: 2 }))],
        panel: () => ({ summary: null, conditions: null, filters: null, visibleRows: 2,
          runState: 'done', dbInfo: null, peakStats: null }),
      }),
    })
    const raw = String(await runTool('get_annotation'))
    const out = JSON.parse(raw)
    expect(raw.length).toBeLessThan(12000)
    expect(out.rows[0]).toMatchObject({ id: 1, rank: 1, truncated: true })
    expect(out.paging).toMatchObject({ returned: 1, nextOffset: 1 })
  })

  it('unregistered annotations page degrades to an unavailable hint', async () => {
    await expect(runTool('get_annotation')).resolves.toMatch(/not available in the current page context/)
  })
})

describe('get_page combined snapshot', () => {
  it('returns header + annotation preview rank 1-10 and no full row dump', async () => {
    registerContextProviders({
      pageHeader: () => ({ datasetName: 'liver section', status: 'completed' }),
      annotations: () => ({
        count: 25,
        rows: () => annotationRows(25),
        panelRows: () => annotationRows(25),
        weights: { mass: 0.6, adduct: 0.1, spatial: 0.3 },
        panel: () => ({
          summary: null,
          conditions: null,
          filters: null,
          visibleRows: 25,
          runState: 'done',
          dbInfo: null,
          peakStats: null,
        }),
      }),
    })
    const value = (await runTool('get_page', { withImage: false })) as {
      page: Record<string, unknown>
    }
    const page = value.page as { header: unknown; annotation: { rows: AnnotationRow[] } }
    expect(page.header).toEqual({ datasetName: 'liver section', status: 'completed' })
    expect(page.annotation.rows).toHaveLength(10)
    expect(page.annotation.rows[0]!.rank).toBe(1)
    // 渲染层保持 JSON 可解析且标注预览
    const rendered = JSON.stringify(page)
    expect(rendered).toContain('"rank":1')
  })

  it('returns a rendered ToolImage for get_page and preserves the turn-start target', async () => {
    const readIon = await import('../plugins/tool-ion-image')
    const readSpy = vi.spyOn(readIon, 'readIon').mockResolvedValue({
      matrix: new Float32Array([1]), width: 1, height: 1, mz: 100, tolerance: 0.01, label: 'ion',
    })
    registerContextProviders({
      selectedIon: () => ({ mz: 200, tolerance: 0.02, matrix: new Float32Array([1]), width: 1, height: 1 }),
    })
    const captured = {
      type: 'turn/start', turnId: 'turn', user: { role: 'user', content: 'question' },
      binding: { datasetId: 'd', generation: 1, page: { selectedIon: { mz: 100, tolerance: 0.01 } } },
      baseSurface: [],
    } as const
    const value = (await loadTool('get_page').execute(
      { withImage: true } as never,
      { ...exec, session: { events: [captured] } as never },
    )) as { page: Record<string, unknown>; images?: { dataUrl: string; mime: string }[] }
    expect(value.images?.[0]).toMatchObject({ dataUrl: expect.stringContaining('data:image/png'), mime: 'image/png' })
    expect(value.page.imageTarget).toEqual({ mz: 100, tolerance: 0.01, source: 'turn-start' })
    expect(readSpy).toHaveBeenCalledWith(100, 0.01, expect.any(AbortSignal))
  })

  it('returns the initial KMeans computing state without a completed cluster result', async () => {
    registerContextProviders({
      kmeans: () => ({
        k: null, clusterSizes: [], selectedIds: [],
        view: {
          clusters: [], labelsAvailable: false, computing: true, visible: false,
          labels: () => null, rgb: () => null, dims: () => null,
        },
      }),
    })
    const result = await loadTool('get_kmeans').execute({ withImage: false } as never, exec) as { state: { computing: boolean; clusters: unknown[] } }
    expect(result.state).toMatchObject({ computing: true, clusters: [] })
  })
  it('renders KMeans and UMAP overlays only when requested and available', async () => {
    const renderer = await import('../plugins/tool-ion-image/render')
    registerContextProviders({
      kmeans: () => ({
        k: 2, clusterSizes: [1, 1], selectedIds: [0],
        view: {
          clusters: [
            { id: 0, color: [255, 0, 0], count: 1 },
            { id: 1, color: [0, 255, 0], count: 1 },
          ],
          labelsAvailable: true, computing: false, visible: true,
          labels: () => Int32Array.from([0, 1]),
          rgb: () => Uint8Array.from([255, 0, 0, 0, 255, 0]),
          dims: () => ({ width: 2, height: 1 }),
        },
      }),
      umap: () => ({
        ready: true, visible: true, computing: false, error: null,
        grid: { width: 1, height: 1 },
        rgb: () => Uint8Array.from([0, 0, 0]),
        occupancyMask: () => Uint8Array.from([1]),
      }),
    })
    const kmeans = loadTool('get_kmeans')
    const disabled = await kmeans.execute({ withImage: false } as never, exec) as { images?: unknown }
    expect(disabled.images).toBeUndefined()
    await kmeans.execute({ withImage: true } as never, exec)
    // 图例 = visibleIds ∩ clusters：selectedIds [0] 只含簇 0，簇 1 不进图例
    expect(renderer.renderOverlayImage).toHaveBeenCalledWith(
      expect.any(Uint8Array), 2, 1, 'KMeans overlay',
      expect.objectContaining({ labels: expect.any(Int32Array) }),
      [{ color: [255, 0, 0], label: '#0 (1 px)' }],
    )
    const umap = await loadTool('get_umap').execute({ withImage: true } as never, exec) as { images?: unknown[] }
    expect(umap.images).toHaveLength(1)
    expect(renderer.renderOverlayImage).toHaveBeenCalledWith(
      expect.any(Uint8Array), 1, 1, 'UMAP overlay', { occupancy: Uint8Array.from([1]) },
    )
  })


  it('budgets combined page and dataset JSON without breaking syntax', async () => {
    registerContextProviders({
      datasetInfo: () => ({
        attrs: { huge: 'x'.repeat(20000) }, acquisition: {}, sourceFile: null, methods: [],
        displayRange: null, imageInfo: { pixels: null, nonZero: null, totalIon: null, pixelSize: null },
      }),
      pageHeader: () => ({ datasetName: 'x', status: '' }),
    })
    const dataset = String(await runTool('get_dataset'))
    expect(dataset.length).toBeLessThan(12000)
    expect(() => JSON.parse(dataset)).not.toThrow()
    const page = await runTool('get_page', { withImage: false }) as { page: unknown }
    const rendered = JSON.stringify(page.page)
    expect(rendered.length).toBeLessThan(12000)
    expect(() => JSON.parse(rendered)).not.toThrow()
    expect(rendered).toContain('truncated')
  })

  it('keeps the annotation preview cursor honest under the combined page budget', async () => {
    // 行膨胀到超过预览子预算：get_page 的注释段必须截断，且游标与实际行数一致
    const fatRows = annotationRows(30).map((r) => ({ ...r, name: 'x'.repeat(600) }))
    registerContextProviders({
      pageHeader: () => ({ datasetName: 'liver section', status: 'completed' }),
      datasetInfo: () => ({
        attrs: { huge: 'x'.repeat(20000) }, acquisition: {}, sourceFile: null, methods: [],
        displayRange: null, imageInfo: { pixels: null, nonZero: null, totalIon: null, pixelSize: null },
      }),
      annotations: () => ({
        count: 30,
        rows: () => fatRows,
        panelRows: () => fatRows,
        weights: { mass: 0.6, adduct: 0.1, spatial: 0.3 },
        panel: () => ({
          summary: null, conditions: null, filters: null, visibleRows: 30,
          runState: 'done', dbInfo: null, peakStats: null,
        }),
      }),
    })
    const value = (await runTool('get_page', { withImage: false })) as {
      page: {
        annotation: {
          rows: unknown[]
          truncated?: boolean
          paging: { total: number; offset: number; returned: number; nextOffset: number | null }
        }
      }
    }
    const rendered = JSON.stringify(value.page)
    expect(rendered.length).toBeLessThan(12000)
    expect(value.page.annotation.rows.length).toBeLessThan(10)
    expect(value.page.annotation.truncated).toBe(true)
    // 不变量：无论内层子预算还是外层组合预算截断，游标永远与实际行数一致
    const { rows, paging } = value.page.annotation
    expect(paging.returned).toBe(rows.length)
    expect(paging.nextOffset).toBe(rows.length < paging.total ? rows.length : null)
  })
})

describe('get_dataset source file projection', () => {
  it('passes through unknown raw keys, drops excluded keys in both naming forms, and nulls -- placeholders', async () => {
    registerContextProviders({
      datasetInfo: () => ({
        attrs: { name: 'liver section', polarity: 'positive' },
        acquisition: {},
        sourceFile: {
          // 未知后端键：自动透传
          new_backend_field: 'visible-in-panel',
          organism: 'mouse',
          // 排除表（两种命名）
          publicId: 'p1',
          public_id: 'p1',
          imagePath: 'oss/key',
          image_path: 'oss/key',
          hashMd5: 'deadbeef',
          file_verify_code: 'deadbeef',
          raw: { evil: true },
        },
        methods: ['Peak Picking'],
        displayRange: null,
        imageInfo: { pixels: null, nonZero: null, totalIon: null, pixelSize: null },
      }),
    })
    const out = JSON.parse(String(await runTool('get_dataset')))
    expect(out.sourceFile.new_backend_field).toBe('visible-in-panel')
    expect(out.sourceFile.organism).toBe('mouse')
    expect(out.sourceFile.publicId).toBeUndefined()
    expect(out.sourceFile.public_id).toBeUndefined()
    expect(out.sourceFile.imagePath).toBeUndefined()
    expect(out.sourceFile.image_path).toBeUndefined()
    expect(out.sourceFile.hashMd5).toBeUndefined()
    expect(out.sourceFile.file_verify_code).toBeUndefined()
    expect(out.sourceFile.raw).toBeUndefined()
    expect(out.attrs.name).toBe('liver section')
  })

  it('falls back to the zarr overview when the provider is not registered', async () => {
    dataModeRef.value = 'continuous'
    ionDims.value = { width: 4, height: 3 }
    mzAxisRef.value = Float64Array.from([100.0001, 200.5, 300.25])
    const out = String(await runTool('get_dataset'))
    expect(out).toContain('dataMode: continuous')
  })

  it('converges on a huge attrs array within the character budget (no quadratic freeze)', async () => {
    // 20k-element array field passing through zarr attrs: the previous
    // pop-one-element-per-pass loop re-stringified the whole root every
    // iteration (~54s measured); the 5s default test timeout is the canary.
    registerContextProviders({
      datasetInfo: () => ({
        attrs: {
          name: 'big',
          hugeTrace: Array.from({ length: 20_000 }, (_, i) => i * 0.5),
        },
        acquisition: {},
        sourceFile: { organism: 'mouse' },
        methods: [],
        displayRange: null,
        imageInfo: { pixels: null, nonZero: null, totalIon: null, pixelSize: null },
      }),
    })
    const out = String(await runTool('get_dataset'))
    expect(out.length).toBeLessThanOrEqual(12_000)
    expect(() => JSON.parse(out)).not.toThrow()
    expect(out).toContain('"truncated":true')
    expect(out).toContain('hugeTrace')
  })
})

describe('get_ion view', () => {
  it('reports channels and ROI/mask segments from the provider view', async () => {
    registerContextProviders({
      selectedIon: () => ({
        mz: 741.531,
        tolerance: 0.01,
        matrix: new Float32Array([1, 2, 3, 4]),
        width: 2,
        height: 2,
        view: {
          mz: 741.531,
          tolerance: 0.01,
          dataMode: 'continuous',
          display: {
            colormap: 'inferno',
            intensityScale: 'linear',
            gamma: 1,
            displayMin: 0,
            displayMax: 3,
            globalMin: 0,
            globalMax: 4,
          },
          spectrum: { view: 'pixel', selectedPixel: { x: 3, y: 2 } },
          channels: {
            enabled: true,
            overlayActive: true,
            list: [
              { id: 1, mz: 200, color: [255, 0, 0], visible: true, opacity: 1, loading: false, error: null },
            ],
          },
          roi: { confirmed: 2, selected: 1 },
          masks: { imported: 3 },
        },
      }),
    })
    const value = (await runTool('get_ion', { withImage: false })) as {
      ion: { channels: { list: { mz: number }[] }; roi: { confirmed: number }; masks: { imported: number } }
    }
    expect(value.ion.channels.list[0]!.mz).toBe(200)
    expect(value.ion.roi).toEqual({ confirmed: 2, selected: 1 })
    expect(value.ion.masks).toEqual({ imported: 3 })
  })
})

describe('spectrum rank windows', () => {
  it('mean spectrum windows page arbitrary ranks after a full sort', async () => {
    mzAxisRef.value = Float64Array.from({ length: 30 }, (_, i) => 100 + i)
    const { meanSpectrumRef } = await import('@/services/zarr/zarrSharedState')
    meanSpectrumRef.value = Float32Array.from({ length: 30 }, (_, i) => 30 - i) // 强度 30..1
    const page1 = JSON.parse(String(await runTool('get_mean_spectrum_top_peaks')))
    expect(page1.peaks).toHaveLength(10)
    expect(page1.peaks[0].mz).toBe(100)
    expect(page1.window).toMatchObject({ total: 30, offset: 0, nextOffset: 10 })
    // rank 20–30：offset 19 + limit 11
    const page3 = JSON.parse(
      String(await runTool('get_mean_spectrum_top_peaks', { offset: 19, limit: 11 })),
    )
    expect(page3.peaks.map((p: { mz: number }) => p.mz)).toEqual(
      Array.from({ length: 11 }, (_, i) => 119 + i),
    )
    expect(page3.window).toMatchObject({ total: 30, returned: 11, nextOffset: null })
  })

  it('pixel spectrum windows page arbitrary ranks for the loaded pixel', async () => {
    pixelSpectrum.value = {
      pixelIndex: 1,
      x: 2,
      y: 3,
      mz: Float64Array.from({ length: 30 }, (_, i) => 100 + i),
      intensity: Float32Array.from({ length: 30 }, (_, i) => 30 - i),
    }
    const raw = String(await runTool('get_pixel_spectrum', { offset: 19, limit: 11, withImage: false }))
    const out = JSON.parse(raw.slice(raw.indexOf('{')))
    expect(out.window).toMatchObject({ total: 30, offset: 19, returned: 11 })
    expect(out.peaks.map((p: { mz: number }) => p.mz)).toEqual(
      Array.from({ length: 11 }, (_, i) => 119 + i),
    )
  })

  it('attaches a full-spectrum stick plot with the window peaks highlighted', async () => {
    const renderer = await import('../plugins/tool-ion-image/render')
    pixelSpectrum.value = {
      pixelIndex: 1,
      x: 2,
      y: 3,
      mz: Float64Array.from([100, 101, 102, 103]),
      intensity: Float32Array.from([4, 30, 10, 2]),
    }
    const value = (await runTool('get_pixel_spectrum', { limit: 2 })) as {
      text: string
      images: unknown[]
    }
    expect(value.text).toContain('"window"')
    expect(value.images).toHaveLength(1)
    // 全谱按强度降序传入；高亮 = 当前窗口（rank 1–2）的 mz
    expect(vi.mocked(renderer.renderSpectrumPlot)).toHaveBeenCalledWith(
      [
        { mz: 101, intensity: 30 },
        { mz: 102, intensity: 10 },
        { mz: 100, intensity: 4 },
        { mz: 103, intensity: 2 },
      ],
      { label: 'pixel #1 (x=2, y=3)', highlightMzs: [101, 102] },
    )
    const def = loadTool('get_pixel_spectrum')
    expect(def.output!.render!({} as never, value)).toBe(value.text)
    expect(def.output!.images!({} as never, value, exec as never)).toBe(value.images)
  })

  it('attaches one plot per explicit pixel index', async () => {
    const renderer = await import('../plugins/tool-ion-image/render')
    vi.mocked(renderer.renderSpectrumPlot).mockClear()
    setZarrStore({
      getPixelSpectrum: async (index: number) => ({
        pixelIndex: index,
        x: index + 1,
        y: 1,
        mz: Float64Array.from([100, 101]),
        intensity: Float32Array.from([1, 9]),
      }),
      loadCoordinates: async () => new Uint32Array([1, 1, 1, 2, 1, 1]),
    } as unknown as ZarrOssStore)
    const value = (await runTool('get_pixel_spectrum', { pixelIndices: [0, 1] })) as {
      images: unknown[]
    }
    expect(value.images).toHaveLength(2)
    expect(
      vi.mocked(renderer.renderSpectrumPlot).mock.calls.map((call) => call[1]!.label),
    ).toEqual(['pixel #0 (x=1, y=1)', 'pixel #1 (x=2, y=1)'])
  })

  it('omits images (never []) when disabled, unloaded or rendering fails', async () => {
    const renderer = await import('../plugins/tool-ion-image/render')
    pixelSpectrum.value = {
      pixelIndex: 1,
      x: 2,
      y: 3,
      mz: Float64Array.from([100]),
      intensity: Float32Array.from([5]),
    }
    const def = loadTool('get_pixel_spectrum')
    // withImage:false —— 纯字符串结果，output.images 恒 undefined
    const disabled = await runTool('get_pixel_spectrum', { withImage: false })
    expect(typeof disabled).toBe('string')
    expect(
      def.output!.images!({ withImage: false } as never, disabled, exec as never),
    ).toBeUndefined()
    // 渲染抛错 —— 退回纯字符串
    vi.mocked(renderer.renderSpectrumPlot).mockImplementationOnce(() => {
      throw new Error('Canvas rendering is unavailable')
    })
    const failed = await runTool('get_pixel_spectrum', {})
    expect(typeof failed).toBe('string')
    expect(failed).toContain('"window"')
    // 未加载谱 —— 引导文案不变
    pixelSpectrum.value = null
    const unloaded = await runTool('get_pixel_spectrum', {})
    expect(unloaded).toContain('No single-pixel spectrum loaded yet')
  })

  it('offset beyond total returns an empty window instead of erroring', async () => {
    mzAxisRef.value = Float64Array.from({ length: 5 }, (_, i) => 100 + i)
    const { meanSpectrumRef } = await import('@/services/zarr/zarrSharedState')
    meanSpectrumRef.value = Float32Array.from([1, 2, 3, 4, 5])
    const out = JSON.parse(String(await runTool('get_mean_spectrum_top_peaks', { offset: 99, limit: 10 })))
    expect(out.peaks).toEqual([])
    expect(out.window).toMatchObject({ total: 5, offset: 99, returned: 0, nextOffset: null })
  })
})

describe('get_ion_image selector exclusivity', () => {
  it('rejects concurrent selectors without silent precedence', async () => {
    await expect(runTool('get_ion_image', { mz: 100, mzs: [200] })).rejects.toThrow(
      /mutually exclusive/i,
    )
    await expect(runTool('get_ion_image', { mzs: [200], rowIds: [3] })).rejects.toThrow(
      /mutually exclusive/i,
    )
  })
})

describe('批量工具调用（array 参数走完整 ToolRuntime 管线；自 tool-bio 迁入）', () => {
  function mkCtx() {
    const ctx = new Context()
    ctx.plugin(SystemPrompt)
    ctx.plugin(ToolRuntime)
    // toolPageContext.inject 声明了 ['tools','skills']：skills 服务缺位
    // 时 fiber 静默失败（工具一个都注册不上，正是 bootstrap.test.ts 把关的场景）。
    // 必须传模块对象（带 inject 声明），传裸 apply 会丢 inject。
    ctx.plugin(SkillsRegistry)
    ctx.plugin(toolPageContextPlugin)
    return ctx
  }

  it('get_annotation 精确单查在无 provider 时返回 unavailable 提示而非报错', async () => {
    const ctx = mkCtx()
    await new Promise((r) => setTimeout(r, 10))
    try {
      const r = await ctx.tools.execute({
        callId: 'c1',
        name: 'get_annotation',
        arguments: { mz: 760.58 },
        signal: new AbortController().signal,
      })
      expect(r.isError).toBe(false)
      expect(r.content).toContain('Annotation data')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('get_annotation 批量 mzs：一次调用返回逐行分节结果', async () => {
    const mkRow = (id: number, name: string, obsMz: number): AnnotationRow =>
      ({
        id,
        rank: id,
        name,
        origin: 'endogenous',
        candidates: [{ id: '', name, origin: 'endogenous' }],
        formula: 'C42H82NO8P',
        adduct: '[M+H]+',
        theoMz: obsMz,
        obsMz,
        errPpm: 0,
        intensity: 1,
        massScore: 1,
        adductFit: 1,
        chaos: null,
        coloc: null,
        spatialScore: null,
        totalScore: 1,
        q: 0.01,
        siblings: [],
        samePeak: [],
        missingAdducts: [],
      }) as AnnotationRow
    registerContextProviders({
      annotations: () => ({
        count: 3,
        rows: () => [mkRow(1, 'PC 34:1', 760.5856), mkRow(2, 'PC 36:4', 806.5696), mkRow(3, 'SM d18:1/16:0', 703.5748)],
      }),
    })
    const ctx = mkCtx()
    await new Promise((r) => setTimeout(r, 10))
    try {
      const r = await ctx.tools.execute({
        callId: 'c2',
        name: 'get_annotation',
        arguments: { mzs: [760.5856, 806.5696, 999.9] },
        signal: new AbortController().signal,
      })
      expect(r.isError).toBe(false)
      // 逐行分节：命中的两行 + 未命中的 m/z 行
      expect(r.content).toContain('### m/z 760.5856')
      expect(r.content).toContain('PC 34:1')
      expect(r.content).toContain('### m/z 806.5696')
      expect(r.content).toContain('PC 36:4')
      expect(r.content).toContain('### m/z 999.9')
      expect(r.content).toContain('No annotation row matched near m/z 999.9')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
