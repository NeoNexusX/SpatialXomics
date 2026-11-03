import { describe, expect, it } from 'vitest'
import {
  adapterFailureChunk,
  assertUsableApiKey,
  errorChain,
  isContextWindowExceededError,
  isQuotaExceededError,
  LlmCode,
  LlmError,
  normalizeApiKey,
  normalizeLlmFailure,
} from '../error'

describe('LlmError', () => {
  it('carries a frozen snapshot of its facts beside the live error', () => {
    const cause = new Error('socket')
    const error = new LlmError('too many', LlmCode.RATE_LIMIT, {
      status: 429,
      providerRetryAfterMs: 1500,
      requestId: 'req_1',
      cause,
    })

    expect(error.name).toBe('LlmError')
    expect(error.cause).toBe(cause)
    expect(error.failure).toEqual({
      message: 'too many',
      code: 'RATE_LIMIT',
      status: 429,
      providerRetryAfterMs: 1500,
      requestId: 'req_1',
    })
    expect(Object.isFrozen(error.failure)).toBe(true)
  })

  it('leaves absent facts out of the snapshot', () => {
    expect(Object.keys(new LlmError('x', 'UNKNOWN').failure).sort()).toEqual(['code', 'message'])
  })

  it.each([
    ['', 'X', undefined],
    ['x', '', undefined],
    ['x', 'X', { status: 99 }],
    ['x', 'X', { status: 600 }],
    ['x', 'X', { status: 200.5 }],
    ['x', 'X', { providerRetryAfterMs: 0 }],
    ['x', 'X', { providerRetryAfterMs: Number.POSITIVE_INFINITY }],
    ['x', 'X', { requestId: '' }],
  ])('rejects invalid facts: %j %j %j', (message, code, options) => {
    expect(() => new LlmError(message, code, options)).toThrow()
  })
})

describe('isContextWindowExceededError', () => {
  it.each([
    "This model's maximum context length is 65536 tokens. However, you requested 70000 tokens",
    'context_length_exceeded',
    'context window exceeded',
    'request is too large for this model context',
    'input is too long for this model',
    'Input is too long for requested model.',
    'prompt is too long: 209000 tokens > 200000 maximum',
    'the input exceeds the model context window',
  ])('recognizes %s', (detail) => {
    expect(isContextWindowExceededError(detail)).toBe(true)
  })

  it.each([
    'messages: field required',
    'max_tokens: 64000 > 8192, which is the maximum allowed',
    'context is required',
    'rate limit exceeded',
  ])('does not mistake %s', (detail) => {
    expect(isContextWindowExceededError(detail)).toBe(false)
  })
})

describe('isQuotaExceededError', () => {
  it.each([
    'Insufficient Balance',
    'insufficient_quota',
    'You exceeded your current quota, please check your plan',
    'quota exhausted',
    'usage limit reached',
    'credits exhausted',
    'Your credit balance is too low to access the Claude API',
    'out of credits',
  ])('recognizes %s', (detail) => {
    expect(isQuotaExceededError(detail)).toBe(true)
  })

  it.each(['rate limit exceeded', 'too many requests', 'invalid request'])(
    'does not mistake %s for an exhausted balance',
    (detail) => {
      expect(isQuotaExceededError(detail)).toBe(false)
    },
  )
})

describe('errorChain', () => {
  const chained = (message: string, cause: unknown) => Object.assign(new Error(message), { cause })

  it('walks causes so a transport wrapper does not mask the reason', () => {
    const wrapper = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('connect ECONNREFUSED'),
    })
    expect(errorChain(wrapper)).toBe('fetch failed: connect ECONNREFUSED')
  })

  it('does not repeat a cause its wrapper already quotes', () => {
    expect(errorChain(chained('boom', new Error('boom')))).toBe('boom')
  })

  it('renders aggregate members', () => {
    const aggregate = Object.assign(new Error('all failed'), {
      errors: [new Error('a'), new Error('b')],
    })
    expect(errorChain(aggregate)).toBe('all failed [a; b]')
  })

  it('marks true cycles but renders a shared cause in full', () => {
    const cyclic = chained('outer', null)
    cyclic.cause = cyclic
    expect(errorChain(cyclic)).toBe('outer: <circular cause>')

    const shared = new Error('shared')
    const diamond = Object.assign(new Error('both'), {
      errors: [chained('a', shared), chained('b', shared)],
    })
    expect(errorChain(diamond)).toBe('both [a: shared; b: shared]')
  })

  it('survives hostile values', () => {
    const hostile = {
      toString() {
        throw new Error('nope')
      },
    }
    expect(errorChain(hostile)).toBe('<unrenderable value>')
    expect(errorChain({ message: 'plain failure' })).toBe('plain failure')
    expect(errorChain('text')).toBe('text')
  })
})

describe('normalizeApiKey', () => {
  it('trims silently and judges the rest', () => {
    expect(normalizeApiKey('  sk-1\n')).toEqual({ ok: true, value: 'sk-1' })
    expect(normalizeApiKey('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeApiKey('sk 1')).toEqual({ ok: false, reason: 'illegalCharacters' })
    expect(normalizeApiKey('sk-密钥')).toEqual({ ok: false, reason: 'illegalCharacters' })
  })

  it('names where to fix the key and never echoes it', () => {
    const secret = 'sk-SECRET-密钥'
    let error: LlmError | undefined
    try {
      assertUsableApiKey(secret, 'the connection settings')
    } catch (err) {
      error = err as LlmError
    }
    expect(error?.code).toBe(LlmCode.INVALID_CREDENTIAL)
    expect(error?.message).toContain('the connection settings')
    expect(error?.message).not.toContain('SECRET')
    expect(error?.message).not.toContain('密钥')
    expect(assertUsableApiKey(' sk-ok ', 'x')).toBe('sk-ok')
  })
})

describe('normalizeLlmFailure', () => {
  it('keeps the snapshot of an LlmError', () => {
    const error = new LlmError('down', LlmCode.SERVER, { status: 503 })
    const failure = normalizeLlmFailure(error)
    expect(failure).toEqual({ message: 'down', code: 'SERVER', status: 503 })
    expect(Object.isFrozen(failure)).toBe(true)
  })

  it('does not trust third-party codes', () => {
    const error = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
    expect(normalizeLlmFailure(error)).toEqual({ message: 'refused', code: 'UNKNOWN' })
  })

  it('accepts a copied error when its own failure and code agree', () => {
    const copy = Object.assign(new Error('late'), {
      code: 'RATE_LIMIT',
      failure: { message: 'late', code: 'RATE_LIMIT', status: 429 },
    })
    expect(normalizeLlmFailure(copy)).toEqual({ message: 'late', code: 'RATE_LIMIT', status: 429 })
  })

  it.each([
    [{ code: 'A', failure: { message: 'x', code: 'B' } }],
    [{ code: 'A', failure: { message: '', code: 'A' } }],
    [{ code: 'A', failure: { message: 'x', code: 'A', status: 700 } }],
    [{ code: 'A', failure: 'not an object' }],
  ])('rejects carried facts that do not hold: %j', (props) => {
    expect(normalizeLlmFailure(Object.assign(new Error('e'), props)).code).toBe('UNKNOWN')
  })

  it('does not run accessors on foreign errors', () => {
    const error = new Error('real')
    Object.defineProperty(error, 'failure', {
      get() {
        throw new Error('trap')
      },
    })
    Object.defineProperty(error, 'message', {
      get() {
        throw new Error('trap')
      },
    })
    expect(normalizeLlmFailure(error)).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
  })

  it('normalizes values that are not errors', () => {
    expect(normalizeLlmFailure('plain')).toEqual({ message: 'plain', code: 'UNKNOWN' })
    expect(normalizeLlmFailure('')).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
    const hostile = {
      toString() {
        throw new Error('nope')
      },
    }
    expect(normalizeLlmFailure(hostile)).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
  })
})

describe('adapterFailureChunk', () => {
  const failure = (chunk: ReturnType<typeof adapterFailureChunk>) =>
    chunk.type === 'finish' ? chunk.reason : undefined

  it('reports an error by default', () => {
    expect(failure(adapterFailureChunk(new LlmError('x', LlmCode.SERVER)))).toMatchObject({
      kind: 'error',
      failure: { code: 'SERVER' },
    })
  })

  it('reports aborted when the caller cancelled, whatever the error says', () => {
    const controller = new AbortController()
    controller.abort()
    expect(
      failure(adapterFailureChunk(new LlmError('x', LlmCode.SERVER), controller.signal)),
    ).toMatchObject({ kind: 'aborted' })
    expect(failure(adapterFailureChunk(new LlmError('x', LlmCode.ABORTED)))).toMatchObject({
      kind: 'aborted',
    })
  })
})
