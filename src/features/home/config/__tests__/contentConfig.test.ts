import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HomeContent } from '../contentConfig'

/** content.json 的模块状态是单例，每个用例都从干净的模块副本开始 */
async function freshModule() {
  vi.resetModules()
  return import('../contentConfig')
}

function mockContent(raw: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => raw })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getContent', () => {
  it('throws before loadContent has run', async () => {
    const { getContent } = await freshModule()

    expect(() => getContent()).toThrow(/not loaded yet/)
  })

  it('returns the loaded content afterwards', async () => {
    mockContent({ team: [{ name: 'Ada', role: 'PI' }] })
    const { loadContent, getContent } = await freshModule()

    await loadContent()

    expect(getContent().team).toHaveLength(1)
  })
})

describe('loadContent', () => {
  it('fills in every optional section so consumers never see undefined', async () => {
    mockContent({})
    const { loadContent } = await freshModule()

    expect(await loadContent()).toEqual({
      hero: { taglines: [], gallery: [] },
      team: [],
      contact: {},
      githubHeatmap: undefined,
    })
  })

  it('keeps the authored sections as-is', async () => {
    const raw: HomeContent = {
      hero: { taglines: ['FREE'], gallery: ['a.png'] },
      team: [{ name: 'Ada', role: 'PI' }],
      contact: { email: 'a@b.c' },
      githubHeatmap: { owner: 'BioNet-XMU', repo: 'MassVision' },
    }
    mockContent(raw)
    const { loadContent } = await freshModule()

    expect(await loadContent()).toEqual(raw)
  })

  it('falls back to empty content instead of throwing on an HTTP error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }),
    )
    const { loadContent, getContent } = await freshModule()

    const content = await loadContent()

    expect(content.team).toEqual([])
    expect(content.contact).toEqual({})
    expect(getContent()).toBe(content)
  })

  it('falls back to empty content when the request itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { loadContent } = await freshModule()

    await expect(loadContent()).resolves.toMatchObject({ team: [] })
  })

  it('shares one request between concurrent callers', async () => {
    const fetchMock = mockContent({})
    const { loadContent } = await freshModule()

    const [a, b] = await Promise.all([loadContent(), loadContent()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('serves the cached content without fetching again', async () => {
    const fetchMock = mockContent({})
    const { loadContent } = await freshModule()

    await loadContent()
    await loadContent()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
