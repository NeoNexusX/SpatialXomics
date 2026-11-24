import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterNavItems, getConfig, isNavVisible, loadConfig, type NavItem } from '../runtimeConfig'

function mockConfig(config: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => config,
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('zarr tuning config', () => {
  it('falls back to built-in defaults when the block is missing', async () => {
    mockConfig({ appName: 'Test' })

    await loadConfig()

    expect(getConfig().zarr).toEqual({
      spectraChunkCacheSize: 20,
      spectraConcurrency: 16,
    })
  })

  it('preserves valid explicit values', async () => {
    mockConfig({
      appName: 'Test',
      zarr: { spectraChunkCacheSize: 40, spectraConcurrency: 32 },
    })

    await loadConfig()

    expect(getConfig().zarr).toEqual({
      spectraChunkCacheSize: 40,
      spectraConcurrency: 32,
    })
  })

  it('rejects out-of-range or non-integer values', async () => {
    mockConfig({
      appName: 'Test',
      zarr: { spectraChunkCacheSize: 0, spectraConcurrency: 1.5 },
    })

    await loadConfig()

    expect(getConfig().zarr).toEqual({
      spectraChunkCacheSize: 20,
      spectraConcurrency: 16,
    })
  })
})

describe('preloaded config request', () => {
  it('consumes the response index.html already started', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {
      __configPromise: Promise.resolve({ ok: true, json: async () => ({ appName: 'Preloaded' }) }),
    } as unknown as Window)

    await loadConfig()

    expect(getConfig().appName).toBe('Preloaded')
    expect(fetchMock).not.toHaveBeenCalled()
    // Response 的 body 只能消费一次，用过即清，第二次调用必须重新走 fetch
    expect(window.__configPromise).toBeUndefined()
  })

  it('falls back to fetch once the preloaded response is used up', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ appName: 'Fetched' }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { __configPromise: undefined } as unknown as Window)

    await loadConfig()

    expect(getConfig().appName).toBe('Fetched')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws when config.json cannot be served', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' }),
    )

    await expect(loadConfig()).rejects.toThrow(/404 Not Found/)
  })
})

describe('optional config blocks', () => {
  it('defaults nav and fab to empty shells when absent', async () => {
    mockConfig({ appName: 'Test' })

    await loadConfig()

    expect(getConfig().nav).toEqual({ items: [], userMenu: [], guestLinks: [] })
    expect(getConfig().fab).toEqual({ main: { iconClosed: 'home', iconOpen: 'close' }, items: [] })
  })

  it('passes pagination through untouched (the UI builds its select from it)', async () => {
    mockConfig({ appName: 'Test', pagination: { defaultPageSize: 10, pageSizeOptions: [6, 10, 20] } })

    await loadConfig()

    expect(getConfig().pagination.pageSizeOptions).toEqual([6, 10, 20])
  })
})

describe('nav visibility', () => {
  const guest = { isAuthenticated: false }
  const user = { isAuthenticated: true }
  const admin = { isAuthenticated: true, isAdmin: true }

  it('treats a missing active flag as visible', () => {
    expect(isNavVisible({}, guest)).toBe(true)
  })

  it('lets active: false win over every dynamic condition', () => {
    expect(isNavVisible({ active: false, requireAuth: true }, admin)).toBe(false)
  })

  it('applies the auth/guest/admin conditions', () => {
    expect(isNavVisible({ requireAuth: true }, guest)).toBe(false)
    expect(isNavVisible({ requireAuth: true }, user)).toBe(true)
    expect(isNavVisible({ requireGuest: true }, user)).toBe(false)
    expect(isNavVisible({ requireAdmin: true }, user)).toBe(false)
    expect(isNavVisible({ requireAdmin: true }, admin)).toBe(true)
  })

  it('combines conditions with AND', () => {
    expect(isNavVisible({ requireAuth: true, requireAdmin: true }, user)).toBe(false)
    expect(isNavVisible({ requireAuth: true, requireAdmin: true }, admin)).toBe(true)
  })
})

describe('filterNavItems', () => {
  const items: NavItem[] = [
    { kind: 'link', to: '/datasets', icon: 'db', label: 'Datasets' },
    { kind: 'link', to: '/login', icon: 'in', label: 'Login', requireGuest: true },
    {
      kind: 'group',
      icon: 'cog',
      label: 'Admin',
      children: [
        { to: '/users', icon: 'u', label: 'Users', requireAdmin: true },
        { to: '/me', icon: 'm', label: 'Profile', requireAuth: true },
      ],
    },
  ]

  it('keeps only what the guest may see', () => {
    const visible = filterNavItems(items, { isAuthenticated: false })

    expect(visible.map((i) => i.label)).toEqual(['Datasets', 'Login'])
  })

  it('drops a group once all of its children are filtered out', () => {
    const visible = filterNavItems(items, { isAuthenticated: true })

    expect(visible.map((i) => i.label)).toEqual(['Datasets', 'Admin'])
    const group = visible.find((i) => i.kind === 'group')!
    expect(group.kind === 'group' && group.children.map((c) => c.label)).toEqual(['Profile'])
  })

  it('leaves the source array untouched', () => {
    const before = JSON.stringify(items)

    filterNavItems(items, { isAuthenticated: true, isAdmin: true })

    expect(JSON.stringify(items)).toBe(before)
  })
})
