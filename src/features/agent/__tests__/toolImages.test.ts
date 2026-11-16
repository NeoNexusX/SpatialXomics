import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createLockedAgent, text, toolCall, type LockedAgent } from './lockedAgent'
import { defineTool, renderBatch } from '../plugins/tools'
import { createMemoryStorage } from '../plugins/session-persistence'
import { estimateMessage } from '../plugins/token-meter/estimate'
import { setAgentDataset } from '../bridge/datasetBinding'
import { rasterize, displayRange, legendLayout, selectPlotPeaks, isSpectrumHighlight, type RenderOptions } from '../plugins/tool-ion-image/render'
import { readIon } from '../plugins/tool-ion-image'

// jsdom 无 canvas：get_ion_image 的整链路测试只需要 renderIonImages 不抛错
vi.mock('../plugins/tool-ion-image/render', async (importOriginal) => {
  const original = await importOriginal<typeof import('../plugins/tool-ion-image/render')>()
  return {
    ...original,
    renderIonImages: vi.fn(() => ({
      images: [
        {
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==',
          mime: 'image/png' as const,
          width: 1,
          height: 1,
          label: 'stub',
        },
      ],
      description: 'stub render (jsdom)',
    })),
  }
})
import {
  dataModeRef,
  ionDims,
  ticMatrix,
  mzAxisRef,
  setZarrStore,
  resetZarrSharedState,
  polarityRef,
} from '@/services/zarr/zarrSharedState'
import type { ZarrOssStore } from '@/services/zarr/zarrOssStore'
import {
  resolveMassPolarity,
  buildIonImageStats,
  registerContextProviders,
  unregisterContextProviders,
} from '../bridge/analysisContext'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='
const image = { dataUrl: PNG, mime: 'image/png' as const, width: 1, height: 1, label: 'ion A' }
const opened: LockedAgent[] = []
async function setup(
  script: Parameters<typeof createLockedAgent>[0] = [],
  options: Parameters<typeof createLockedAgent>[1] = {},
) {
  const h = await createLockedAgent(script, options)
  opened.push(h)
  return h
}
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(
    'assistant_connection',
    JSON.stringify({ endpoint: 'anthropic', baseUrl: 'https://llm.test', apiKey: 'k', model: 'm' }),
  )
  setAgentDataset('images', true)
})
afterEach(async () => {
  for (const h of opened.splice(0)) await h.dispose()
  resetZarrSharedState()
  setZarrStore(null)
  unregisterContextProviders()
  vi.restoreAllMocks()
})

it('sends tool images through archive middleware, restores them and displays a thumbnail', async () => {
  const h = await setup([toolCall('picture'), text('seen')])
  h.ctx.tools.register(
    defineTool({
      name: 'picture',
      description: 'Image',
      parameters: {},
      async execute() {
        return 'stats'
      },
      output: { render: (_args, value) => value, images: () => [image] },
    }),
  )
  await h.agent.send('show image')
  await h.agent.whenIdle()
  const tool = h.calls[1]!.messages.find((message) => message.role === 'tool')!
  expect(tool).toMatchObject({
    content: 'stats',
    images: [PNG],
    attachments: [{ width: 1, height: 1, label: 'ion A' }],
  })
  const storage = h.storages[0]!.storage
  const batches = await storage.read()
  expect(JSON.stringify(batches)).not.toContain('base64')
  const restored = await h.ctx.sessions.restore(storage)
  const messages = await h.ctx.attachments.hydrate(storage, restored.deriveMessages())
  expect(messages.find((message) => message.role === 'tool')).toEqual(tool)
  await vi.waitFor(() => {
    const part = h.agent
      .snapshot()
      .messages.flatMap((item) => item.parts ?? [])
      .find((part) => part.type === 'tool')
    expect(part?.type === 'tool' && part.images?.[0]).toBeTruthy()
  })
  const ref = tool.role === 'tool' ? tool.attachments![0]! : undefined
  await storage.deleteArtifact(ref!.id)
  await expect(h.ctx.attachments.hydrate(storage, restored.deriveMessages())).rejects.toThrow(
    'ion A',
  )
})

it('rolls back already stored images if the batch fails or is cancelled', async () => {
  const h = await setup()
  const storage = createMemoryStorage()
  const save = storage.putArtifact.bind(storage)
  let calls = 0
  vi.spyOn(storage, 'putArtifact').mockImplementation(async (blob) => {
    if (++calls === 2) throw new Error('storage full')
    return save(blob)
  })
  await expect(
    h.ctx.attachments.saveTools(storage, [image, image], new AbortController().signal),
  ).rejects.toThrow('storage full')
  expect(await storage.listArtifacts()).toEqual([])
  vi.restoreAllMocks()
  const controller = new AbortController()
  vi.spyOn(storage, 'putArtifact').mockImplementation(async (blob) => {
    const id = await save(blob)
    controller.abort()
    return id
  })
  await expect(h.ctx.attachments.saveTools(storage, [image], controller.signal)).rejects.toThrow()
  expect(await storage.listArtifacts()).toEqual([])
})

it('covers rendering with the tool timeout and validates images before delivery', async () => {
  const h = await setup()
  let workSignal: AbortSignal | undefined
  h.ctx.tools.register(
    defineTool({
      name: 'slow-picture',
      description: 'Image',
      parameters: {},
      timeoutMs: 10,
      async execute() {
        return 'stats'
      },
      output: {
        render: (_args, value) => value,
        images: async (_args, _value, exec) => {
          workSignal = exec.signal
          await new Promise((resolve) => setTimeout(resolve, 30))
          return [image]
        },
      },
    }),
  )
  const result = await h.ctx.tools.execute({
    name: 'slow-picture',
    callId: 'a',
    arguments: {},
    signal: new AbortController().signal,
  })
  expect(result.isError).toBe(true)
  expect(result.images).toBeUndefined()
  expect(workSignal?.aborted).toBe(true)
  await expect(
    h.ctx.attachments.saveTools(
      createMemoryStorage(),
      [{ ...image, mime: 'image/jpeg' }],
      new AbortController().signal,
    ),
  ).rejects.toThrow('MIME')
})

it('counts persisted tool images before hydration without double counting', () => {
  const message = {
    role: 'tool' as const,
    name: 'p',
    toolCallId: 'a',
    content: 'stats',
    attachments: [{ id: 'a', mime: image.mime, bytes: 100, width: 384, height: 384 }],
  }
  const tokens = estimateMessage(message)
  expect(tokens).toBeGreaterThan(estimateMessage({ ...message, attachments: [] }))
  expect(estimateMessage({ ...message, images: [PNG] })).toBe(tokens)
})

it('pages long query batches and archives oversized complete evidence', async () => {
  const storage = createMemoryStorage()
  const items = Array.from({ length: 25 }, (_, i) => `query-${i}`)
  const seen: string[] = []
  let offset = 0
  for (let page = 0; page < 25; page++) {
    const result = await renderBatch(
      items,
      (item) => item,
      (item) => `${item} ${'x'.repeat(1000)}`,
      { offset, session: { storage } as never },
    )
    expect(result.length).toBeLessThanOrEqual(4000)
    seen.push(...[...result.matchAll(/### (query-\d+)/g)].map((match) => match[1]!))
    const next = /nextOffset=(\d+)/.exec(result)
    if (!next) break
    expect(Number(next[1])).toBeGreaterThan(offset)
    offset = Number(next[1])
  }
  expect(seen).toEqual(items)
  const artifacts = await storage.listArtifacts()
  expect(artifacts).toHaveLength(25)
  expect((await storage.getArtifact(artifacts[0]!)).size).toBeGreaterThan(1000)
})

const options: RenderOptions = {
  colormap: 'gray',
  scale: 'linear',
  gamma: 1,
  display: 'max',
  normalize: 'shared',
  layout: 'separate',
  columns: 2,
  width: 384,
}
it('uses a shared scale and preserves matrix direction, zero and constant images', () => {
  const a = { matrix: new Float32Array([0, 10, 0, 0]), width: 2, height: 2, label: 'A' }
  const b = { ...a, matrix: new Float32Array([0, 5, 0, 0]) }
  const range = displayRange([a, b], 'max')
  expect(range).toEqual([0, 10])
  expect([...rasterize(a, range, options).slice(4, 8)]).toEqual([255, 255, 255, 255])
  expect([...rasterize(b, range, options).slice(4, 8)]).toEqual([128, 128, 128, 255])
  expect(rasterize({ ...a, matrix: new Float32Array(4) }, [0, 0], options)[0]).toBe(0)
  expect(rasterize({ ...a, matrix: new Float32Array(4).fill(5) }, [5, 5], options)[0]).toBe(255)
})

it('lays out overlay legends three per row, wrapping and truncating beyond twelve items', () => {
  const item = (id: number) => ({ color: [id, id, id] as const, label: `#${id} (${id} px)` })
  // 3 项单行：x 均分三列，y 同一基线
  const three = legendLayout([item(0), item(1), item(2)], 600)
  expect(three.cells.map((cell) => cell.y)).toEqual([4, 4, 4])
  expect(three.cells.map((cell) => cell.x)).toEqual([8, 208, 408])
  expect(three.cells.every((cell) => cell.swatch)).toBe(true)
  expect(three.height).toBe(26) // 1 行 × 18 + 8 padding
  expect(three.truncated).toBe(0)
  // 第 4 项换行
  const four = legendLayout([item(0), item(1), item(2), item(3)], 600)
  expect(four.cells[3]!.y).toBe(22)
  expect(four.height).toBe(44)
  // >12 项：只保留 12 项 + 无色块的 "+N more"
  const many = legendLayout(Array.from({ length: 15 }, (_, i) => item(i)), 600)
  expect(many.cells).toHaveLength(13)
  expect(many.cells[12]).toMatchObject({ swatch: null, label: '+3 more' })
  expect(many.truncated).toBe(3)
  // 12 项恰好整行时 "+N more" 落到新行首列
  const twelve = legendLayout(Array.from({ length: 13 }, (_, i) => item(i)), 600)
  expect(twelve.cells[12]!.x).toBe(8)
  expect(twelve.cells[12]!.y).toBe(4 + 4 * 18)
})

it('matches spectrum highlights within ±1e-4 and keeps them when trimming plots to 2000 peaks', () => {
  expect(isSpectrumHighlight(100.00005, [100])).toBe(true)
  expect(isSpectrumHighlight(99.99995, [100])).toBe(true)
  expect(isSpectrumHighlight(100.0002, [100])).toBe(false)
  expect(isSpectrumHighlight(100, undefined)).toBe(false)
  // 强度单调递减的 2005 峰，mz 间距 1e-3（>容差，只有精确目标命中）
  const target = 100 + 2004 * 0.001
  const peaks = Array.from({ length: 2005 }, (_, i) => ({
    mz: 100 + i * 0.001,
    intensity: 2005 - i,
  }))
  const selected = selectPlotPeaks(peaks, [target])
  expect(selected).toHaveLength(2000)
  // 最弱但被高亮的峰必须保留；其余按强度取前 1999
  expect(selected.some((peak) => peak.mz === target)).toBe(true)
  expect(selected.filter((peak) => peak.mz !== target)).toHaveLength(1999)
  // ≤2000 时原样返回（浅拷贝，不改入参顺序）
  const small = [{ mz: 1, intensity: 1 }]
  expect(selectPlotPeaks(small, [])).toEqual(small)
})

it('reads the same tolerance window as the workbench and rejects out-of-window targets', async () => {
  dataModeRef.value = 'continuous'
  mzAxisRef.value = new Float64Array([100, 100.005, 101])
  ionDims.value = { width: 2, height: 2 }
  const sum = vi.fn(async () => new Float32Array([0, 10, 0, 0]))
  setZarrStore({ getSummedIonImageByMzIndices: sum } as unknown as ZarrOssStore)
  const ion = await readIon(100, 0.01, new AbortController().signal)
  expect(sum).toHaveBeenCalledWith([0, 1])
  expect(ion.label).toContain('window 99.99–100.01')
  await expect(readIon(150, 0.01, new AbortController().signal)).rejects.toThrow('No m/z')
  polarityRef.value = 'negative'
  expect(resolveMassPolarity()).toBe('negative')
  polarityRef.value = ''
  expect(() => resolveMassPolarity()).toThrow('Specify polarity')
})

it('lets explicit mz queries through when the selection changed mid-turn', async () => {
  // 选中离子在轮次开始后才变：无参调用会被闸门拦下（behaviorLock binding-ion 已锁定），
  // 显式 mzs 的查询目标与选中无关，应放行并返回统计
  const h = await setup(
    [
      async function* () {
        registerContextProviders({
          selectedIon: () => ({
            mz: 800.5,
            tolerance: 0.01,
            matrix: new Float32Array([1, 2, 3, 4]),
            width: 2,
            height: 2,
          }),
        })
        yield* toolCall('get_ion_image', { mzs: [100, 300] }, 'c1')
      },
      text('done'),
    ],
    { fullTools: true, noScriptTools: true },
  )
  dataModeRef.value = 'continuous'
  ionDims.value = { width: 2, height: 2 }
  mzAxisRef.value = new Float64Array([100, 200, 300])
  setZarrStore({
    getSummedIonImageByMzIndices: async () => new Float32Array([0, 10, 0, 0]),
  } as unknown as ZarrOssStore)
  const accepted = await h.agent.send('compare these ions')
  await h.agent.whenIdle()
  expect(accepted).toBe(true)
  expect(h.agent.snapshot().error).toBeNull()
  const echoed = JSON.stringify(h.calls[1]!.messages)
  expect(echoed).toContain('axis 100')
  expect(echoed).toContain('axis 300')
})

it('uses TIC for processed get_ion_image when the captured tolerance is zero', async () => {
  const h = await setup()
  const pageTools = await import('../plugins/tool-page-context')
  const ionImage = await import('../plugins/tool-ion-image')
  h.ctx.plugin(ionImage)
  h.ctx.plugin(pageTools)
  await new Promise((resolve) => setTimeout(resolve, 0))

  dataModeRef.value = 'processed'
  ionDims.value = { width: 2, height: 2 }
  ticMatrix.value = new Float32Array([1, 2, 3, 4])
  const result = await h.ctx.tools.execute({
    name: 'get_ion_image',
    callId: 'processed-tic',
    arguments: {},
    signal: new AbortController().signal,
    session: {
      events: [{ type: 'turn/start', binding: { page: { selectedIon: { mz: 0, tolerance: 0 } } } }],
    } as never,
  })

  expect(result.isError).toBe(false)
  expect(result.content).toContain('TIC')
})

it('reads explicit pixels without changing the page and filters the raw mean spectrum', async () => {
  const { buildMeanSpectrumTopPeaks } = await import('../bridge/analysisContext')
  const { meanSpectrumRef, pixelSpectrum } = await import('@/services/zarr/zarrSharedState')
  const pageTools = await import('../plugins/tool-page-context')
  const h = await setup()
  h.ctx.plugin(pageTools)
  await new Promise((resolve) => setTimeout(resolve, 0))
  dataModeRef.value = 'continuous'
  mzAxisRef.value = new Float64Array([100, 200, 300])
  meanSpectrumRef.value = new Float32Array([5, 20, 10])
  expect(buildMeanSpectrumTopPeaks(2, 150, 300)).toEqual([
    { mz: 200, intensity: 20 },
    { mz: 300, intensity: 10 },
  ])
  const read = vi.fn(async (index: number) => ({
    pixelIndex: index,
    x: index + 1,
    y: 1,
    mz: mzAxisRef.value!,
    intensity: new Float32Array([1, 2, 3]),
  }))
  setZarrStore({
    getPixelSpectrum: read,
    loadCoordinates: async () => new Uint32Array([1, 1, 1, 2, 1, 1]),
  } as unknown as ZarrOssStore)
  const result = await h.ctx.tools.execute({
    name: 'get_pixel_spectrum',
    callId: 'p',
    arguments: { x: 2, y: 1 },
    signal: new AbortController().signal,
  })
  expect(result.isError).toBe(false)
  expect(result.content).toContain('pixel #1 (x=2, y=1)')
  expect(result.content).toContain('"window"')
  expect(pixelSpectrum.value).toBeNull()
  expect(read).toHaveBeenCalledWith(1)
  const batch = await h.ctx.tools.execute({
    name: 'get_pixel_spectrum',
    callId: 'p',
    arguments: { pixelIndices: [1, 0] },
    signal: new AbortController().signal,
  })
  expect(batch.content.indexOf('pixel #1')).toBeLessThan(batch.content.indexOf('pixel #0'))
})

it('rejects concurrent selectors in get_ion_image', async () => {
  const h = await setup()
  const pageTools = await import('../plugins/tool-page-context')
  const ionImage = await import('../plugins/tool-ion-image')
  h.ctx.plugin(ionImage)
  h.ctx.plugin(pageTools)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const result = await h.ctx.tools.execute({
    name: 'get_ion_image',
    callId: 's',
    arguments: { mz: 100, mzs: [200] },
    signal: new AbortController().signal,
  })
  expect(result.isError).toBe(true)
  expect(result.content).toMatch(/mutually exclusive/i)
})

it('removes new image artifacts when result middleware fails before commit', async () => {
  const h = await setup([toolCall('picture')])
  h.ctx.tools.register(
    defineTool({
      name: 'picture',
      description: 'Image',
      parameters: {},
      async execute() {
        return 'stats'
      },
      output: { render: (_args, value) => value, images: () => [image] },
    }),
  )
  h.ctx.on('agent/tool-result', async (_event, next) => {
    await next()
    throw new Error('middleware failed')
  })
  await h.agent.send('show')
  await h.agent.whenIdle()
  expect(h.agent.snapshot().error).toContain('middleware failed')
  const storage = h.storages[0]!.storage
  for (const id of await storage.listArtifacts())
    expect((await storage.getArtifact(id)).type).not.toMatch(/^image/)
})

it('stops reading further batch queries after cancellation', async () => {
  const controller = new AbortController()
  const queries: number[] = []
  await expect(
    renderBatch(
      [1, 2, 3],
      String,
      async (item) => {
        queries.push(item)
        controller.abort()
        return String(item)
      },
      { signal: controller.signal },
    ),
  ).rejects.toThrow()
  expect(queries).toEqual([1])
})

it('rejects invalid ion requests before reading the store', async () => {
  const signal = new AbortController().signal
  await expect(readIon(-1, 0.01, signal)).rejects.toThrow('m/z must be positive')
  await expect(readIon(100, -0.1, signal)).rejects.toThrow('tolerance must be positive')
})

it('keeps ion statistics finite and rejects empty or inconsistent rasters', () => {
  const ion = {
    mz: 100,
    tolerance: 0.01,
    width: 2,
    height: 2,
    matrix: new Float32Array([0, 2, NaN, Infinity]),
  }
  const stats = buildIonImageStats(ion)!
  expect(stats.mean).toBe(2)
  expect(stats.nonzeroRatio).toBe(0.25)
  expect(stats.max).toBe(2)
  expect(stats.hotspots[0]).toEqual({ x: 1, y: 0, intensity: 2 })
  expect(
    Object.values(stats)
      .filter((value) => typeof value === 'number')
      .every(Number.isFinite),
  ).toBe(true)
  expect(
    buildIonImageStats({ ...ion, width: 0, height: 0, matrix: new Float32Array() }),
  ).toBeUndefined()
  expect(buildIonImageStats({ ...ion, matrix: new Float32Array([1]) })).toBeUndefined()
})

it('renders a tool with no return value as a successful null result', async () => {
  const h = await setup()
  h.ctx.tools.register(
    defineTool({ name: 'no-value', description: '', parameters: {}, async execute() {} }),
  )
  const result = await h.ctx.tools.execute({
    name: 'no-value',
    callId: 'x',
    arguments: {},
    signal: new AbortController().signal,
  })
  expect(result).toMatchObject({ isError: false, content: 'null' })
})
