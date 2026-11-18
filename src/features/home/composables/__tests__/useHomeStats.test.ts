import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, type EffectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'
import {
  useAnalyzerStats,
  useDatasetCategoryStats,
  useDatasetIonSourceStats,
  useOrganismStats,
  usePlatformOverview,
  useVisitsStats,
} from '../useHomeStats'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ api: { get } }))
const scopes: EffectScope[] = []

function start<T>(setup: () => T) {
  const scope = effectScope()
  scopes.push(scope)
  return { state: scope.run(setup)!, scope }
}

beforeEach(() => get.mockReset())
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()))

describe('home statistics', () => {
  it.each([
    ['organism', useOrganismStats],
    ['organism_part', useDatasetCategoryStats],
    ['ionisation_source', useDatasetIonSourceStats],
    ['analyzer', useAnalyzerStats],
  ] as const)(
    'loads and sorts the %s distribution through the public API',
    async (field, setup) => {
      get.mockResolvedValueOnce({ data: { smaller: 2, empty: 0, larger: 7 } })
      const { state } = start(setup)
      expect(state.loading.value).toBe(true)
      expect(state.isEmpty.value).toBe(false)
      await flushPromises()

      expect(get).toHaveBeenCalledWith('/stats/files/classification', {
        params: { field },
        signal: expect.any(AbortSignal),
      })
      expect(state.items.value).toEqual([
        { category: 'larger', count: 7 },
        { category: 'smaller', count: 2 },
      ])
      expect(state.total.value).toBe(9)
      expect(state.loading.value).toBe(false)
      expect(state.error.value).toBeNull()
    },
  )

  it('keeps independent overview and visits requests isolated during a retry', async () => {
    const overview = { total_users: 2, total_files: 9, total_downloads: 10 }
    get.mockResolvedValueOnce({ data: overview }).mockRejectedValueOnce(new Error('Offline'))
    const { state } = start(() => ({ overview: usePlatformOverview(), visits: useVisitsStats() }))
    await flushPromises()
    expect(state.overview.stats.value).toEqual(overview)
    expect(state.overview.error.value).toBeNull()
    expect(state.visits.error.value).toBe('Offline')
    expect(state.visits.stats.value).toBeNull()

    get.mockResolvedValueOnce({ data: { today: 1, month: 5, total: 50 } })
    state.visits.reload()
    await flushPromises()
    expect(state.visits.stats.value?.total).toBe(50)
    expect(state.visits.error.value).toBeNull()
    expect(state.overview.stats.value).toEqual(overview)
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/stats/overview',
      '/stats/visits',
      '/stats/visits',
    ])
  })

  it('keeps a newer empty distribution when an aborted request finishes late', async () => {
    let resolveOld!: (value: { data: Record<string, number> }) => void
    get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    const { state } = start(useOrganismStats)
    const oldSignal = get.mock.calls[0]![1].signal as AbortSignal
    get.mockResolvedValueOnce({ data: {} })
    state.reload()
    await flushPromises()
    expect(oldSignal.aborted).toBe(true)
    expect(state.isEmpty.value).toBe(true)

    resolveOld({ data: { stale: 99 } })
    await flushPromises()
    expect(state.total.value).toBe(0)
    expect(state.items.value).toEqual([])
    expect(state.isEmpty.value).toBe(true)
    expect(state.loading.value).toBe(false)
  })

  it('cancels a distribution when its scope closes, without surfacing an error', async () => {
    let reject!: (reason: unknown) => void
    get.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail
        }),
    )
    const { state, scope } = start(useAnalyzerStats)
    const signal = get.mock.calls[0]![1].signal as AbortSignal
    scope.stop()
    reject(new Error('Canceled'))
    await nextTick()
    await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(state.error.value).toBeNull()
    expect(state.items.value).toEqual([])
  })
})
