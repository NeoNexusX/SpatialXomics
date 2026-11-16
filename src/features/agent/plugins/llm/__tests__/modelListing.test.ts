import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelListingCache, parseModelListing } from '../modelListing'
import type { DiscoveredModel } from '../types'

describe('parseModelListing', () => {
  it('reads the official listing', () => {
    expect(
      parseModelListing({
        data: [
          {
            id: 'claude-opus-5-5',
            display_name: 'Claude Opus 5.5',
            max_input_tokens: 1_000_000,
            max_tokens: 128_000,
            capabilities: { image_input: { supported: true } },
          },
          {
            id: 'embed-only',
            capabilities: { image_input: { supported: false } },
          },
        ],
      }),
    ).toEqual([
      {
        id: 'claude-opus-5-5',
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        inputModalities: ['text', 'image'],
      },
      { id: 'embed-only', inputModalities: ['text'] },
    ])
  })

  it('reads the fields other endpoints use', () => {
    expect(
      parseModelListing({
        data: [
          {
            id: 'deepseek-flash',
            context_window: 1_048_576,
            max_output_tokens: 256_000,
            input_modalities: ['text', 'image'],
          },
          {
            id: 'routed',
            context_length: 8_000,
            top_provider: { max_completion_tokens: 2_000 },
            architecture: { input_modalities: ['text'] },
          },
          { id: 'limited', limit: { context: 32_000, output: 4_000 } },
        ],
      }),
    ).toEqual([
      {
        id: 'deepseek-flash',
        contextWindow: 1_048_576,
        maxTokens: 256_000,
        inputModalities: ['text', 'image'],
      },
      { id: 'routed', contextWindow: 8_000, maxTokens: 2_000, inputModalities: ['text'] },
      { id: 'limited', contextWindow: 32_000, maxTokens: 4_000 },
    ])
  })

  it('reads a models object keyed by id', () => {
    expect(
      parseModelListing({ models: { a: { context_window: 10 }, b: {}, skip: 'not an object' } }),
    ).toEqual([{ id: 'a', contextWindow: 10 }, { id: 'b' }])
  })

  it('takes the first usable capacity and ignores nonsense', () => {
    expect(
      parseModelListing({
        data: [
          { id: 'a', context_window: -1, max_input_tokens: 500, max_tokens: 1.5 },
          { id: 'b', context_window: '1000', max_output_tokens: 0 },
        ],
      }),
    ).toEqual([{ id: 'a', contextWindow: 500 }, { id: 'b' }])
  })

  it('keeps only the modalities it knows, and treats none as unknown', () => {
    expect(
      parseModelListing({
        data: [
          { id: 'a', input_modalities: ['audio', 'image', 'text'] },
          { id: 'b', input_modalities: ['audio'] },
          { id: 'c', input_modalities: 'image' },
        ],
      }),
    ).toEqual([{ id: 'a', inputModalities: ['text', 'image'] }, { id: 'b' }, { id: 'c' }])
  })

  it('skips bad rows without losing the rest', () => {
    expect(
      parseModelListing({
        data: [null, 'x', { id: '' }, { id: 5 }, { name: 'no id' }, { id: 'ok' }, { id: 'ok' }],
      }),
    ).toEqual([{ id: 'ok' }])
  })

  it('accepts an empty listing', () => {
    expect(parseModelListing({ data: [] })).toEqual([])
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['an array', []],
    ['an object with neither field', { ok: true }],
    ['data that is not a list', { data: {} }],
  ])('rejects %s as not a listing', (_name, body) => {
    expect(() => parseModelListing(body)).toThrow(
      expect.objectContaining({ code: 'MALFORMED_RESPONSE' }),
    )
  })
})

describe('ModelListingCache', () => {
  const MODELS: DiscoveredModel[] = [{ id: 'm', maxTokens: 10 }]

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads once and serves later reads from memory', async () => {
    const load = vi.fn(async () => MODELS)
    const cache = new ModelListingCache()
    await expect(cache.view('s', load)).resolves.toBe(MODELS)
    await expect(cache.view('s', load)).resolves.toBe(MODELS)
    expect(load).toHaveBeenCalledOnce()
  })

  it('shares one request between concurrent readers', async () => {
    let release!: (models: DiscoveredModel[]) => void
    const load = vi.fn(() => new Promise<DiscoveredModel[]>((resolve) => (release = resolve)))
    const cache = new ModelListingCache()
    const first = cache.view('s', load)
    const second = cache.view('s', load)
    release(MODELS)
    await expect(first).resolves.toBe(MODELS)
    await expect(second).resolves.toBe(MODELS)
    expect(load).toHaveBeenCalledOnce()
  })

  it('keeps a separate listing for each scope', async () => {
    const cache = new ModelListingCache()
    await cache.view('key-a', async () => MODELS)
    const other: DiscoveredModel[] = [{ id: 'other' }]
    await expect(cache.view('key-b', async () => other)).resolves.toBe(other)
    await expect(cache.view('key-a', async () => other)).resolves.toBe(MODELS)
  })

  it('answers at once when stale and refreshes in the background', async () => {
    let now = 0
    const cache = new ModelListingCache({ maxAgeMs: 100, now: () => now })
    await cache.view('s', async () => MODELS)

    now = 100
    const fresher: DiscoveredModel[] = [{ id: 'fresh' }]
    const load = vi.fn(async () => fresher)
    await expect(cache.view('s', load)).resolves.toBe(MODELS)
    expect(load).toHaveBeenCalledOnce()
    await vi.waitFor(async () => {
      await expect(cache.view('s', load)).resolves.toBe(fresher)
    })
  })

  it('keeps the last good listing when a refresh fails, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let now = 0
    const cache = new ModelListingCache({ maxAgeMs: 100, now: () => now })
    await cache.view('s', async () => MODELS)

    const failing = vi.fn(async (): Promise<DiscoveredModel[]> => {
      throw new Error('down')
    })
    for (now = 100; now <= 300; now += 100) {
      await expect(cache.view('s', failing)).resolves.toBe(MODELS)
      await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(now / 100))
      await Promise.resolve()
    }
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce())
  })

  it('does not hammer an endpoint with no listing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = vi.fn(async (): Promise<DiscoveredModel[]> => {
      throw new Error('404')
    })
    const cache = new ModelListingCache()
    await expect(cache.view('s', failing)).resolves.toBeUndefined()
    await expect(cache.view('s', failing)).resolves.toBeUndefined()
    expect(failing).toHaveBeenCalledOnce()
  })

  it('gives up on a listing that hangs, so the request can still go out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen: AbortSignal[] = []
    const cache = new ModelListingCache({ timeoutMs: 5 })
    const listing = await cache.view('s', (signal) => {
      seen.push(signal)
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('timed out')))
      })
    })
    expect(listing).toBeUndefined()
    expect(seen[0]!.aborted).toBe(true)
  })

  it('lets a caller stop waiting without cancelling the shared load', async () => {
    let release!: (models: DiscoveredModel[]) => void
    const load = vi.fn(() => new Promise<DiscoveredModel[]>((resolve) => (release = resolve)))
    const cache = new ModelListingCache()
    const controller = new AbortController()
    const waiting = cache.view('s', load, controller.signal)
    controller.abort(new Error('user stopped'))
    await expect(waiting).rejects.toThrow('user stopped')

    const another = cache.view('s', load)
    release(MODELS)
    await expect(another).resolves.toBe(MODELS)
    expect(load).toHaveBeenCalledOnce()
  })

  it('rejects at once when the caller has already cancelled', async () => {
    const load = vi.fn(async () => MODELS)
    const controller = new AbortController()
    controller.abort(new Error('gone'))
    await expect(new ModelListingCache().view('s', load, controller.signal)).rejects.toThrow('gone')
  })

  it('counts a listing someone else fetched as fresh', async () => {
    const load = vi.fn(async () => MODELS)
    const cache = new ModelListingCache()
    cache.store('s', MODELS)
    await expect(cache.view('s', load)).resolves.toBe(MODELS)
    expect(load).not.toHaveBeenCalled()
  })
})
