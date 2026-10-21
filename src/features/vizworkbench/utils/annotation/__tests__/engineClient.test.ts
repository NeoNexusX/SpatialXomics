import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import dbCsv from '../__fixtures__/annotation-db.csv?raw'
import positiveCsv from '../__fixtures__/peaks.positive.csv?raw'
import { buildTestDb } from '../__fixtures__/testDb'
import { testPeaks } from '../__fixtures__/testPeaks'
import { AnnotationDbCsvError } from '../annotationDb'
import { createEngineClient, type EngineHandlers, type RunRequest } from '../engineClient'
import { DEFAULT_ENGINE_CONFIG } from '../score'
import { installFakeAnnotationWorker, type FakeWorkerHarness } from './fakeAnnotationWorker'

let harness: FakeWorkerHarness

beforeEach(async () => {
  harness = await installFakeAnnotationWorker()
})

afterEach(() => vi.unstubAllGlobals())

function setup() {
  const handlers = {
    onResult: vi.fn<EngineHandlers['onResult']>(),
    onPatch: vi.fn<EngineHandlers['onPatch']>(),
    onError: vi.fn<EngineHandlers['onError']>(),
  }
  return { engine: createEngineClient(handlers, harness.spawn), handlers }
}

function request(runKey: number): RunRequest {
  return {
    runKey,
    peaks: testPeaks(positiveCsv),
    adducts: [{ id: 'M+H', fit: 1 }],
    tolerance: { value: 5, unit: 'ppm', origin: 'user' },
    config: { ...DEFAULT_ENGINE_CONFIG, seed: 7 },
  }
}

const info = { label: 'lib.csv', count: buildTestDb().formula.length }

describe('annotation engine client (worker)', () => {
  it('parses the database CSV in the worker and runs against it', async () => {
    const { engine, handlers } = setup()
    let loaded = false
    const loading = engine.loadDb('lib.csv', dbCsv).then((r) => ((loaded = true), r))
    await flushPromises()
    // 主线程没有解析，等 worker 的回复
    expect(loaded).toBe(false)
    expect(harness.worker!.inbox).toEqual([{ type: 'db', id: 1, fileName: 'lib.csv', text: dbCsv }])

    harness.deliver()
    await expect(loading).resolves.toEqual(info)

    engine.run(request(1))
    harness.deliver()
    await flushPromises()
    expect(handlers.onError).not.toHaveBeenCalled()
    expect(handlers.onResult).toHaveBeenCalledWith(1, expect.anything())
    expect(handlers.onResult.mock.calls[0]![1].ions.length).toBeGreaterThan(0)
  })

  it('rejects an unusable CSV with its error code and keeps the current database', async () => {
    const { engine, handlers } = setup()
    const first = engine.loadDb('lib.csv', dbCsv)
    harness.deliver()
    await first

    const bad = engine.loadDb('bad.csv', 'Name,Mass\nfoo,1')
    harness.deliver()
    const err = await bad.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AnnotationDbCsvError)
    expect((err as AnnotationDbCsvError).code).toBe('noFormulaColumn')

    engine.run(request(1))
    harness.deliver()
    await flushPromises()
    expect(handlers.onResult.mock.calls[0]![1].ions.length).toBeGreaterThan(0)
  })

  it('parses a pending database on the main thread when the worker crashes', async () => {
    const { engine, handlers } = setup()
    const loading = engine.loadDb('lib.csv', dbCsv)
    harness.worker!.onerror!()
    await expect(loading).resolves.toEqual(info)
    expect(harness.worker!.terminated).toBe(true)

    // 之后都在主线程同步跑
    engine.run(request(2))
    expect(handlers.onResult).toHaveBeenCalledWith(2, expect.anything())
  })

  it('sends one ion image per message and resolves once the worker has scored it', async () => {
    const { engine, handlers } = setup()
    const loading = engine.loadDb('lib.csv', dbCsv)
    harness.deliver()
    await loading
    engine.run(request(1))
    harness.deliver()
    await flushPromises()
    // 只启用 [M+H]+：每个分子组一个峰，送到就算完
    const job = handlers.onResult.mock.calls[0]![1].jobs[0]!
    const axis = job.axisIndices[0]!
    const pixels = Array.from({ length: 16 }, (_, i) => i % 3)
    const done = engine.spatial(1, axis, Float32Array.from(pixels), 4, 4)
    const sent = harness.worker!.inbox as { image: Float32Array }[]
    expect(sent).toHaveLength(1)
    expect({ ...sent[0], image: Array.from(sent[0]!.image) }).toEqual({
      type: 'spatial',
      id: 1,
      runKey: 1,
      axis,
      image: pixels,
      width: 4,
      height: 4,
    })
    harness.deliver()
    await expect(done).resolves.toEqual([])
    expect(handlers.onPatch).toHaveBeenCalledTimes(1)
    const patch = handlers.onPatch.mock.calls[0]![1]
    expect(patch.summary.spatial.done).toBeGreaterThan(0)

    // 过期运行的图只回复、不处理
    const stale = engine.spatial(0, axis, new Float32Array(16), 4, 4)
    harness.deliver()
    await expect(stale).resolves.toEqual([])
    expect(handlers.onPatch).toHaveBeenCalledTimes(1)
  })

  it('settles images still in the worker when it crashes', async () => {
    const { engine } = setup()
    const loading = engine.loadDb('lib.csv', dbCsv)
    harness.deliver()
    await loading
    const pending = engine.spatial(1, 0, new Float32Array(16), 4, 4)
    harness.worker!.onerror!()
    await expect(pending).resolves.toEqual([])
  })

  it('re-runs the request in progress on the main thread with the worker’s database', async () => {
    const { engine, handlers } = setup()
    const loading = engine.loadDb('lib.csv', dbCsv)
    harness.deliver()
    await loading

    engine.run(request(3))
    harness.worker!.onerror!()
    expect(handlers.onError).not.toHaveBeenCalled()
    expect(handlers.onResult).toHaveBeenCalledWith(3, expect.anything())
    expect(handlers.onResult.mock.calls[0]![1].ions.length).toBeGreaterThan(0)
  })
})
