import { afterEach, describe, expect, it, vi } from 'vitest'
import { createZarrHttpClient, ZarrFetchError } from '../zarrHttpClient'

const ROOT = 'https://cdn.test/processed/run_abc_1.zarr/'

/** 依次返回给定的状态码；'network' 模拟 fetch 抛 TypeError（断网 / CORS 被拒）。最后一项一直重复 */
function mockFetch(...steps: Array<number | 'network'>) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const step = steps.length > 1 ? steps.shift()! : steps[0]!
    if (step === 'network') throw new TypeError('Failed to fetch')
    return new Response(step === 200 ? new Uint8Array([1, 2, 3]) : 'error', { status: step })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('createZarrHttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('joins the root URL with the relative path and sends no credentials', async () => {
    const fetchMock = mockFetch(200)
    // 根 URL 缺尾斜杠、相对路径带前导斜杠，都应被规整
    const client = createZarrHttpClient(ROOT.slice(0, -1))
    const ab = await client.getObjectArrayBuffer('/ion_image/intensity/c/0')

    expect(Array.from(new Uint8Array(ab))).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledWith(`${ROOT}ion_image/intensity/c/0`, {
      credentials: 'omit',
      cache: 'default',
    })
  })

  it('revalidates zarr.json metadata instead of trusting the HTTP cache', async () => {
    const fetchMock = mockFetch(200)
    await createZarrHttpClient(ROOT).getObjectArrayBuffer('analysis/umap/zarr.json')

    expect(fetchMock).toHaveBeenCalledWith(`${ROOT}analysis/umap/zarr.json`, {
      credentials: 'omit',
      cache: 'no-cache',
    })
  })

  it.each([
    [404, 'not_found'],
    [403, 'forbidden'],
    [400, 'http'],
  ] as const)('maps HTTP %i to %s without retrying', async (status, code) => {
    const fetchMock = mockFetch(status)
    const error = await createZarrHttpClient(ROOT)
      .getObjectArrayBuffer('stats/tic/zarr.json')
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ZarrFetchError)
    expect(error).toMatchObject({ code, status, url: `${ROOT}stats/tic/zarr.json` })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries transient failures (5xx, network) before succeeding', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetch(503, 'network', 200)
    const pending = createZarrHttpClient(ROOT).getObjectArrayBuffer('spectra/intensity/c/7')
    await vi.runAllTimersAsync()

    expect((await pending).byteLength).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives up after two retries and reports the last failure', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetch('network')
    const pending = createZarrHttpClient(ROOT)
      .getObjectArrayBuffer('zarr.json')
      .catch((e: unknown) => e)
    await vi.runAllTimersAsync()

    expect(await pending).toMatchObject({ code: 'network' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
