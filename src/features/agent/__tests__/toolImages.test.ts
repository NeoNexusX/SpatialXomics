import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createLockedAgent, text, toolCall, type LockedAgent } from './lockedAgent'
import { defineTool, renderBatch } from '../plugins/tools'
import { createMemoryStorage } from '../plugins/session-persistence'
import { estimateMessage } from '../plugins/token-meter/estimate'
import { setAgentDataset } from '../bridge/datasetBinding'
import { rasterize, displayRange, type RenderOptions } from '../plugins/tool-ion-image/render'
import { readIon } from '../plugins/tool-ion-image'
import {
  dataModeRef,
  ionDims,
  mzAxisRef,
  setZarrStore,
  resetZarrSharedState,
  polarityRef,
} from '@/services/zarr/zarrSharedState'
import type { ZarrOssStore } from '@/services/zarr/zarrOssStore'
import { resolveMassPolarity, buildIonImageStats } from '../bridge/analysisContext'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='
const image = { dataUrl: PNG, mime: 'image/png' as const, width: 1, height: 1, label: 'ion A' }
const opened: LockedAgent[] = []
async function setup(script: Parameters<typeof createLockedAgent>[0] = []) {
  const h = await createLockedAgent(script)
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
