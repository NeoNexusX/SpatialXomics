import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, type EffectScope } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useVisitsHistory } from '../useVisitsHistory'
import type { VisitsHistoryStats } from '../../types/stats'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/shared/api/httpClient', () => ({ api: { get } }))
const scopes: EffectScope[] = []

function start() {
  const scope = effectScope()
  scopes.push(scope)
  return { state: scope.run(useVisitsHistory)!, scope }
}

function response(days = 90): VisitsHistoryStats {
  const items = Array.from({ length: days }, (_, index) => ({
    date: new Date(Date.UTC(2026, 10, 18 - days + index)).toISOString().slice(0, 10),
    count: index === days - 1 ? 60 : 0,
    missing: index < days - 2,
    is_partial: index === days - 1,
  }))
  return {
    timezone: 'UTC',
    start_date: items[0]!.date,
    end_date: '2026-11-17',
    days,
    range_total: 60,
    missing_days: days - 2,
    items,
  }
}

function deferred() {
  let resolve!: (value: { data: VisitsHistoryStats }) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<{ data: VisitsHistoryStats }>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => get.mockReset())
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()))

describe('public visit history', () => {
  it('requests 90 days without a browser-derived end date and preserves UTC/missing metadata', async () => {
    const data = response()
    get.mockResolvedValueOnce({ data })
    const { state } = start()
    expect(state.loading.value).toBe(true)
    await flushPromises()

    expect(get).toHaveBeenCalledWith('/stats/visits/history', {
      params: { days: 90 },
      signal: expect.any(AbortSignal),
    })
    expect(state.history.value).toEqual(data)
    expect(state.error.value).toBeNull()
    expect(state.loading.value).toBe(false)
  })

  it('cancels superseded requests and ignores late successes and failures', async () => {
    const old = deferred()
    const middle = deferred()
    const latest = deferred()
    get
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(middle.promise)
      .mockReturnValueOnce(latest.promise)
    const { state } = start()
    const firstSignal = get.mock.calls[0]![1]!.signal
    state.reload()
    await nextTick()
    const middleSignal = get.mock.calls[1]![1]!.signal
    state.reload()
    await nextTick()
    expect(firstSignal?.aborted).toBe(true)
    expect(middleSignal?.aborted).toBe(true)

    middle.resolve({ data: { ...response(), range_total: 20 } })
    await flushPromises()
    expect(state.history.value).toBeNull()
    expect(state.loading.value).toBe(true)
    latest.resolve({ data: response() })
    await flushPromises()
    old.reject({ isAxiosError: true, response: { status: 503 } })
    await flushPromises()
    expect(state.history.value?.range_total).toBe(60)
    expect(state.error.value).toBeNull()
    expect(state.loading.value).toBe(false)
  })

  it('clears stale data on 503 and retries 90 days without inventing zero counts', async () => {
    get.mockResolvedValueOnce({ data: response() })
    const { state } = start()
    await flushPromises()
    get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
    state.reload()
    await flushPromises()
    expect(state.history.value).toBeNull()
    expect(state.error.value).toBe('unavailable')
    expect(state.loading.value).toBe(false)

    get.mockResolvedValueOnce({ data: response() })
    state.reload()
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/stats/visits/history', {
      params: { days: 90 },
      signal: expect.any(AbortSignal),
    })
    expect(state.error.value).toBeNull()
    expect(state.history.value?.range_total).toBe(60)
  })

  it('reports damaged counters as a failure, not an empty successful result', async () => {
    get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 } })
    const { state } = start()
    await flushPromises()
    expect(state.error.value).toBe('loadFailed')
    expect(state.history.value).toBeNull()
  })

  it('aborts the active request when its owner is disposed', async () => {
    const pending = deferred()
    get.mockReturnValueOnce(pending.promise)
    const { state, scope } = start()
    const signal = get.mock.calls[0]![1]!.signal
    scope.stop()
    pending.resolve({ data: response() })
    await flushPromises()
    expect(signal?.aborted).toBe(true)
    expect(state.history.value).toBeNull()
  })
})
