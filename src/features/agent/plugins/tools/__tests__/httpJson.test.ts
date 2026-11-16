import { afterEach, expect, it, vi } from 'vitest'
import { getJson } from '../httpJson'

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
