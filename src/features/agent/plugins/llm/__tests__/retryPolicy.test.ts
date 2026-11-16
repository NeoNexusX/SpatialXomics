import { describe, expect, it, vi } from 'vitest'
import {
  backoffDelayMs,
  MAX_TIMER_DELAY_MS,
  nextRetryDelayMs,
  resolveRetryPolicy,
  waitForRetry,
  type RetryPolicyConfig,
} from '../retryPolicy'
import type { LlmFailure } from '../types'

const PATH = 'config.json llm.retryPolicy'
const policy = (config?: RetryPolicyConfig) => resolveRetryPolicy(config, PATH)
const failure = (code: string, extra: Partial<LlmFailure> = {}): LlmFailure => ({
  message: 'x',
  code,
  ...extra,
})

describe('resolveRetryPolicy', () => {
  it('fills in the defaults', () => {
    expect(policy()).toEqual({
      maxRetries: 5,
      retryableCodes: [
        'EMPTY_RESPONSE',
        'RATE_LIMIT',
        'SERVER',
        'TIMEOUT',
        'TRANSPORT',
        'STREAM_CLOSED',
      ],
      initialDelayMs: 500,
      maxDelayMs: 10_000,
      jitterRatio: 0.1,
    })
  })

  it('detaches and freezes what it returns', () => {
    const codes = ['SERVER']
    const resolved = policy({ retryableCodes: codes })
    codes.push('AUTH')
    expect(resolved.retryableCodes).toEqual(['SERVER'])
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.retryableCodes)).toBe(true)
  })

  it('accepts a configured budget, including none at all', () => {
    expect(policy({ maxRetries: 0 }).maxRetries).toBe(0)
    expect(policy({ backoff: { initialDelayMs: 100, maxDelayMs: 200 } })).toMatchObject({
      initialDelayMs: 100,
      maxDelayMs: 200,
      jitterRatio: 0.1,
    })
  })

  it.each<[string, unknown]>([
    ['unknown key', { mode: 'always' }],
    ['unknown backoff key', { backoff: { base: 1 } }],
    ['not an object', 5],
    ['array', []],
    ['backoff not an object', { backoff: 'fast' }],
    ['negative retries', { maxRetries: -1 }],
    ['fractional retries', { maxRetries: 1.5 }],
    ['empty codes', { retryableCodes: [] }],
    ['codes not an array', { retryableCodes: 'SERVER' }],
    ['empty code', { retryableCodes: [''] }],
    ['duplicate codes', { retryableCodes: ['SERVER', 'SERVER'] }],
    ['zero delay', { backoff: { initialDelayMs: 0 } }],
    ['delay beyond the timer limit', { backoff: { maxDelayMs: MAX_TIMER_DELAY_MS + 1 } }],
    ['initial above max', { backoff: { initialDelayMs: 20_000 } }],
    ['jitter above one', { backoff: { jitterRatio: 1.5 } }],
    ['jitter not finite', { backoff: { jitterRatio: Number.NaN } }],
  ])('rejects %s and names the config', (_name, config) => {
    expect(() => policy(config as RetryPolicyConfig)).toThrow(PATH)
  })
})

describe('backoffDelayMs', () => {
  const noJitter = policy({ backoff: { jitterRatio: 0 } })

  it('grows exponentially up to the limit', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((retry) => backoffDelayMs(noJitter, retry))).toEqual([
      500, 1000, 2000, 4000, 8000, 10_000, 10_000,
    ])
    expect(backoffDelayMs(noJitter, 5000)).toBe(10_000)
  })

  it('applies symmetric jitter without passing the limit', () => {
    const jittered = policy()
    expect(backoffDelayMs(jittered, 1, () => 0)).toBeCloseTo(450)
    expect(backoffDelayMs(jittered, 1, () => 1)).toBeCloseTo(550)
    expect(backoffDelayMs(jittered, 6, () => 1)).toBe(10_000)
  })
})

describe('nextRetryDelayMs', () => {
  const noJitter = policy({ maxRetries: 2, backoff: { jitterRatio: 0 } })

  it('retries only the configured codes', () => {
    expect(nextRetryDelayMs(noJitter, 1, failure('SERVER'))).toBe(500)
    for (const code of ['AUTH', 'QUOTA', 'INVALID_REQUEST', 'CONTEXT_WINDOW_EXCEEDED', 'UNKNOWN']) {
      expect(nextRetryDelayMs(noJitter, 1, failure(code))).toBeUndefined()
    }
  })

  it('stops when the budget runs out', () => {
    expect(nextRetryDelayMs(noJitter, 2, failure('SERVER'))).toBe(1000)
    expect(nextRetryDelayMs(noJitter, 3, failure('SERVER'))).toBeUndefined()
  })

  it('prefers the Retry-After the endpoint asked for', () => {
    expect(
      nextRetryDelayMs(noJitter, 1, failure('RATE_LIMIT', { providerRetryAfterMs: 3000 })),
    ).toBe(3000)
  })

  it('gives up rather than waiting past the limit', () => {
    expect(
      nextRetryDelayMs(noJitter, 1, failure('RATE_LIMIT', { providerRetryAfterMs: 60_000 })),
    ).toBeUndefined()
  })
})

describe('waitForRetry', () => {
  it('resolves true after the delay', async () => {
    vi.useFakeTimers()
    try {
      const done = waitForRetry(1000, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(1000)
      await expect(done).resolves.toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves false as soon as it is cancelled', async () => {
    const controller = new AbortController()
    const done = waitForRetry(60_000, controller.signal)
    controller.abort()
    await expect(done).resolves.toBe(false)
  })

  it('does not wait at all when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(waitForRetry(60_000, controller.signal)).resolves.toBe(false)
  })
})
