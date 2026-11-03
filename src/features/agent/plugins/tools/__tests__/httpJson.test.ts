import { afterEach, expect, it, vi } from 'vitest'
import { createLazyJsonLoader, getJson } from '../httpJson'

afterEach(() => vi.unstubAllGlobals())

it('merges request headers and preserves cancellation reasons', async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetcher)
  await getJson('https://example.test', { headers: { 'X-Request': 'one' } })
  const headers = fetcher.mock.calls[0]![1]!.headers as Headers
  expect(headers.get('Accept')).toBe('application/json')
  expect(headers.get('X-Request')).toBe('one')
  const controller = new AbortController()
  const reason = new Error('cancelled by user')
  controller.abort(reason)
  await expect(getJson('https://example.test', { signal: controller.signal })).rejects.toBe(reason)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('turns a network failure into a readable CORS/network message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }),
  )
  await expect(getJson('https://x.test')).rejects.toThrow('Cannot reach the external database')
})

it('truncates a non-JSON error body into the message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('x'.repeat(500), { status: 503 })),
  )
  await expect(getJson('https://x.test')).rejects.toThrow(`HTTP 503: ${'x'.repeat(200)}`)
})

it('shares an index fetch while allowing one caller to cancel independently', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi.fn(
    (_url: string, _init?: RequestInit) =>
      new Promise<Response>((r) => {
        resolve = r
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const load = createLazyJsonLoader<number[]>('test.json', String)
  const controller = new AbortController()
  const first = load(controller.signal)
  const second = load()
  const cancelled = first.catch((error: unknown) => error)
  controller.abort()
  expect(await cancelled).toMatchObject({ name: 'AbortError' })
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false)
  resolve(Response.json([1, 2]))
  expect(await second).toEqual([1, 2])
  expect(await load()).toEqual([1, 2])
  expect(fetcher).toHaveBeenCalledTimes(1)
  await expect(load(controller.signal)).rejects.toThrow()
})

it('cancels an unused download and can retry without an old request evicting the new cache', async () => {
  const resolvers: ((response: Response) => void)[] = []
  const fetcher = vi.fn(
    (_url: string, _init?: RequestInit) => new Promise<Response>((r) => resolvers.push(r)),
  )
  vi.stubGlobal('fetch', fetcher)
  const load = createLazyJsonLoader<number[]>('test.json', String)
  const controller = new AbortController()
  const first = load(controller.signal)
  const cancelled = first.catch((error: unknown) => error)
  controller.abort()
  expect(await cancelled).toMatchObject({ name: 'AbortError' })
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  const retry = load()
  resolvers[1]!(Response.json([2]))
  expect(await retry).toEqual([2])
  resolvers[0]!(Response.json([1]))
  await Promise.resolve()
  expect(await load()).toEqual([2])
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('retries failed index downloads', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 404 }))
    .mockResolvedValueOnce(Response.json([3]))
  vi.stubGlobal('fetch', fetcher)
  const load = createLazyJsonLoader<number[]>('test.json', (status) => `missing ${status}`)
  await expect(load()).rejects.toThrow('missing 404')
  expect(await load()).toEqual([3])
})

it('identifies a missing static index hidden by an HTML fallback', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200 })),
  )
  const load = createLazyJsonLoader<number[]>('missing.json', String)
  await expect(load()).rejects.toThrow('Invalid JSON index data/missing.json')
})
