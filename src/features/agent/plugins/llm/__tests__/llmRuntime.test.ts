import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ConnectionManager, endpointKey } from '../../connection'
import { LlmRuntime } from '../runtime'
import { ModelCatalog } from '../../model-catalog'
import { MAX_OUTPUT_TOKENS } from '../modelLimits'
import { LlmError } from '../error'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import type {
  GenerateOptions,
  LlmAdapter,
  LlmResolvedModelInfo,
  StreamChunk,
  UserMessage,
} from '../types'
import type { ResolvedEndpoint } from '../../connection'

const OPTIONS: GenerateOptions = { messages: [{ role: 'user', content: 'hi' }] }
const STOP: StreamChunk = { type: 'finish', reason: { kind: 'stop' } }

function fakeAdapter(overrides: Partial<LlmAdapter> = {}): LlmAdapter {
  return {
    endpoint: 'anthropic',
    async *stream() {
      yield STOP
    },
    listModels: async () => [],
    probeVision: async () => 'vision',
    ...overrides,
  }
}

async function setup(adapter?: LlmAdapter) {
  const ctx = new Context()
  await ctx.plugin(ConnectionManager)
  await ctx.plugin(LlmRuntime)
  if (adapter) ctx.llm.registerAdapter(adapter)
  return ctx
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const signal = () => new AbortController().signal

async function* dispatch(
  ctx: Context,
  { maxTokens, ...options }: GenerateOptions,
  abort: AbortSignal,
): AsyncIterable<StreamChunk> {
  const call = await ctx.llm.prepareCall(abort, { maxTokens })
  yield* call.stream(options, abort)
}

function failureCode(chunks: StreamChunk[]): string | undefined {
  const last = chunks[chunks.length - 1]
  return last?.type === 'finish' && (last.reason.kind === 'error' || last.reason.kind === 'aborted')
    ? last.reason.failure.code
    : undefined
}

describe('ctx.llm', () => {
  beforeEach(() => {
    localStorage.setItem(
      STORAGE_KEYS.agentConnection,
      JSON.stringify({
        endpoint: 'anthropic',
        baseUrl: 'https://llm.test',
        apiKey: 'k',
        model: 'm',
      }),
    )
  })

  describe('registration', () => {
    it('rejects a second adapter for the same protocol with a stable code', async () => {
      const ctx = await setup(fakeAdapter())
      expect(() => ctx.llm.registerAdapter(fakeAdapter())).toThrow(
        expect.objectContaining({ code: 'DUPLICATE_ADAPTER' }),
      )
    })

    it('frees the protocol when the adapter is removed', async () => {
      const ctx = await setup()
      const dispose = ctx.llm.registerAdapter(fakeAdapter())
      dispose()
      expect(() => ctx.llm.registerAdapter(fakeAdapter())).not.toThrow()
    })
  })

  describe('stream boundary', () => {
    it('rejects with NO_ADAPTER when no adapter serves the protocol', async () => {
      const ctx = await setup()
      await expect(ctx.llm.prepareCall(signal())).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    })

    it('turns a synchronous adapter throw into a terminal failure', async () => {
      const ctx = await setup(
        fakeAdapter({
          stream: () => {
            throw new LlmError('nope', 'INVALID_REQUEST', { status: 400 })
          },
        }),
      )
      expect(await collect(dispatch(ctx, OPTIONS, signal()))).toEqual([
        {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { message: 'nope', code: 'INVALID_REQUEST', status: 400 },
          },
        },
      ])
    })

    it('turns a throw while reading into a terminal failure, after what already arrived', async () => {
      const ctx = await setup(
        fakeAdapter({
          async *stream() {
            yield { type: 'text-delta', index: 0, text: 'partial' }
            throw new LlmError('down', 'SERVER')
          },
        }),
      )
      const chunks = await collect(dispatch(ctx, OPTIONS, signal()))
      expect(chunks[0]).toEqual({ type: 'text-delta', index: 0, text: 'partial' })
      expect(failureCode(chunks)).toBe('SERVER')
      expect(chunks).toHaveLength(2)
    })

    it('does not trust the code of a foreign error', async () => {
      const ctx = await setup(
        fakeAdapter({
          async *stream() {
            yield* []
            throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
          },
        }),
      )
      expect(failureCode(await collect(dispatch(ctx, OPTIONS, signal())))).toBe('UNKNOWN')
    })

    it('reports aborted when the caller has cancelled, whatever the adapter threw', async () => {
      const controller = new AbortController()
      const ctx = await setup(
        fakeAdapter({
          async *stream() {
            yield { type: 'text-delta', index: 0, text: 'x' }
            controller.abort()
            throw new Error('socket closed')
          },
        }),
      )
      const chunks = await collect(dispatch(ctx, OPTIONS, controller.signal))
      expect(chunks[chunks.length - 1]).toMatchObject({
        type: 'finish',
        reason: { kind: 'aborted' },
      })
    })

    it('adds the missing terminal when an adapter just stops', async () => {
      const ctx = await setup(
        fakeAdapter({
          async *stream() {
            yield { type: 'text-delta', index: 0, text: 'partial' }
          },
        }),
      )
      expect(failureCode(await collect(dispatch(ctx, OPTIONS, signal())))).toBe('STREAM_CLOSED')
    })

    it('delivers nothing after the terminal and closes the adapter', async () => {
      const closed = vi.fn()
      const ctx = await setup(
        fakeAdapter({
          async *stream() {
            try {
              yield STOP
              yield { type: 'text-delta', index: 0, text: 'too late' }
            } finally {
              closed()
            }
          },
        }),
      )
      expect(await collect(dispatch(ctx, OPTIONS, signal()))).toEqual([STOP])
      expect(closed).toHaveBeenCalledOnce()
    })

    it('closes the adapter when the consumer walks away', async () => {
      const closed = vi.fn()
      const ctx = await setup(
        fakeAdapter({
          async *stream() {
            try {
              yield { type: 'text-delta', index: 0, text: 'x' }
              yield STOP
            } finally {
              closed()
            }
          },
        }),
      )
      for await (const _chunk of dispatch(ctx, OPTIONS, signal())) break
      expect(closed).toHaveBeenCalledOnce()
    })

    it('leaves a consumer failure as a thrown error', async () => {
      const ctx = await setup(
        fakeAdapter({
          async *stream() {
            yield { type: 'text-delta', index: 0, text: 'x' }
            yield STOP
          },
        }),
      )
      await expect(
        (async () => {
          for await (const _chunk of dispatch(ctx, OPTIONS, signal())) {
            throw new Error('consumer bug')
          }
        })(),
      ).rejects.toThrow('consumer bug')
    })
  })

  describe('prepareCall', () => {
    it('captures the connection, so later settings do not reach this call', async () => {
      const seen: string[] = []
      const ctx = await setup(
        fakeAdapter({
          async *stream(_options, connection) {
            seen.push(connection.model)
            yield STOP
          },
        }),
      )
      const call = await ctx.llm.prepareCall(signal())
      ctx.connection.save({ ...ctx.connection.settings(), model: 'other' })

      await collect(call.stream(OPTIONS, signal()))

      expect(seen).toEqual(['m'])
      expect(call.connection.model).toBe('m')
      expect(Object.isFrozen(call)).toBe(true)
      expect(Object.isFrozen(call.connection)).toBe(true)
    })

    it('can be dispatched only once', async () => {
      const ctx = await setup(fakeAdapter())
      const call = await ctx.llm.prepareCall(signal())
      await collect(call.stream(OPTIONS, signal()))
      expect(() => call.stream(OPTIONS, signal())).toThrow(
        expect.objectContaining({ code: 'INVALID_PREPARED_CALL' }),
      )
    })

    it('refuses a dispatch whose controls changed', async () => {
      const ctx = await setup(fakeAdapter())
      const call = await ctx.llm.prepareCall(signal(), { maxTokens: 100 })
      expect(() => call.stream({ ...OPTIONS, maxTokens: 200 }, signal())).toThrow(
        expect.objectContaining({ code: 'INVALID_PREPARED_CALL' }),
      )
    })

    it('rejects before any work when already cancelled', async () => {
      const controller = new AbortController()
      controller.abort()
      const ctx = await setup(fakeAdapter())
      await expect(ctx.llm.prepareCall(controller.signal)).rejects.toBeDefined()
    })

    it('rejects with a stable code when nothing is configured', async () => {
      localStorage.removeItem(STORAGE_KEYS.agentConnection)
      const ctx = await setup(fakeAdapter())
      await expect(ctx.llm.prepareCall(signal())).rejects.toMatchObject({ code: 'NO_CONNECTION' })
    })

    it('uses the retry policy the adapter declared when it registered', async () => {
      const retryPolicy = {
        maxRetries: 1,
        retryableCodes: ['SERVER'],
        initialDelayMs: 1,
        maxDelayMs: 1,
        jitterRatio: 0,
      }
      const ctx = await setup(fakeAdapter({ retryPolicy: () => retryPolicy }))
      expect((await ctx.llm.prepareCall(signal())).retryPolicy).toBe(retryPolicy)
    })

    it('falls back to the default retry policy', async () => {
      const ctx = await setup(fakeAdapter())
      expect((await ctx.llm.prepareCall(signal())).retryPolicy.maxRetries).toBe(5)
    })

    describe('output limit', () => {
      const limited = (defaultMaxTokens?: number) =>
        fakeAdapter({
          resolveModel: async () => ({
            endpoint: 'anthropic',
            id: 'm',
            ...(defaultMaxTokens === undefined ? {} : { defaultMaxTokens }),
          }),
        })

      it('uses the limit the model declares', async () => {
        const ctx = await setup(limited(8_192))
        expect((await ctx.llm.prepareCall(signal())).maxTokens).toBe(8_192)
      })

      it('falls back to the agent default for a model it knows nothing about', async () => {
        const ctx = await setup(limited())
        expect((await ctx.llm.prepareCall(signal())).maxTokens).toBe(MAX_OUTPUT_TOKENS)
      })

      it('keeps a caller limit but never above what the model allows', async () => {
        const ctx = await setup(limited(8_192))
        expect((await ctx.llm.prepareCall(signal(), { maxTokens: 100 })).maxTokens).toBe(100)
        expect((await ctx.llm.prepareCall(signal(), { maxTokens: 9_000 })).maxTokens).toBe(8_192)
      })

      it('sends the resolved limit to the adapter', async () => {
        const seen: (number | undefined)[] = []
        const ctx = await setup({
          ...limited(8_192),
          async *stream(options) {
            seen.push(options.maxTokens)
            yield STOP
          },
        })
        await collect(dispatch(ctx, OPTIONS, signal()))
        await collect(dispatch(ctx, { ...OPTIONS, maxTokens: 9_000 }, signal()))
        await collect(dispatch(ctx, { ...OPTIONS, maxTokens: 100 }, signal()))
        expect(seen).toEqual([8_192, 8_192, 100])
      })
    })
  })

  describe('resolveModelInfo', () => {
    const CONNECTION = {
      endpoint: 'anthropic',
      baseUrl: 'https://llm.test/v1',
      apiKey: 'k',
      model: 'm',
      source: 'user',
    } as const

    it('passes through valid facts as a detached copy', async () => {
      const modalities = ['text', 'image'] as const
      const ctx = await setup(
        fakeAdapter({
          resolveModel: async () => ({
            endpoint: 'anthropic',
            id: 'm',
            inputModalities: modalities,
            context: { contextWindow: 1000 },
            defaultMaxTokens: 100,
          }),
        }),
      )
      const info = await ctx.llm.resolveModelInfo(CONNECTION)
      expect(info).toEqual({
        endpoint: 'anthropic',
        id: 'm',
        inputModalities: ['text', 'image'],
        context: { contextWindow: 1000 },
        defaultMaxTokens: 100,
      })
      expect(info.inputModalities).not.toBe(modalities)
    })

    it('knows only the route when the adapter resolves nothing', async () => {
      const ctx = await setup(fakeAdapter())
      await expect(ctx.llm.resolveModelInfo(CONNECTION)).resolves.toEqual({
        endpoint: 'anthropic',
        id: 'm',
      })
    })

    it('rejects an unregistered protocol with a stable code', async () => {
      const ctx = await setup()
      await expect(ctx.llm.resolveModelInfo(CONNECTION)).rejects.toMatchObject({
        code: 'NO_ADAPTER',
      })
    })

    it.each<[string, Partial<LlmResolvedModelInfo>, string]>([
      ['another model', { id: 'other' }, 'INVALID_MODEL_INFO'],
      ['a zero context window', { context: { contextWindow: 0 } }, 'INVALID_MODEL_CONTEXT'],
      ['a fractional context window', { context: { contextWindow: 1.5 } }, 'INVALID_MODEL_CONTEXT'],
      ['a negative output limit', { defaultMaxTokens: -1 }, 'INVALID_MODEL_MAX_TOKENS'],
      ['an infinite output limit', { defaultMaxTokens: Infinity }, 'INVALID_MODEL_MAX_TOKENS'],
      [
        'an unknown modality',
        { inputModalities: ['audio'] as unknown as LlmResolvedModelInfo['inputModalities'] },
        'INVALID_MODEL_INFO',
      ],
      [
        'modalities that are not a list',
        { inputModalities: 'image' as unknown as LlmResolvedModelInfo['inputModalities'] },
        'INVALID_MODEL_INFO',
      ],
    ])('rejects %s', async (_name, facts, code) => {
      const ctx = await setup(
        fakeAdapter({
          resolveModel: async () => ({ endpoint: 'anthropic', id: 'm', ...facts }),
        }),
      )
      await expect(ctx.llm.resolveModelInfo(CONNECTION)).rejects.toMatchObject({ code })
      await expect(ctx.llm.prepareCall(signal())).rejects.toMatchObject({ code })
    })

    it('prefers what a probe found over what the endpoint declares', async () => {
      const ctx = await setup(
        fakeAdapter({
          resolveModel: async () => ({
            endpoint: 'anthropic',
            id: 'm',
            inputModalities: ['text'],
          }),
        }),
      )
      await ctx.plugin(ModelCatalog)
      const endpoint: ResolvedEndpoint = { ...CONNECTION }
      localStorage.setItem(
        STORAGE_KEYS.agentModelCatalog,
        JSON.stringify({
          [endpointKey(endpoint)]: { models: [{ id: 'm', status: 'vision' }], allowed: 10 },
        }),
      )
      const info = await ctx.llm.resolveModelInfo(CONNECTION)
      expect(info.inputModalities).toEqual(['text', 'image'])
      localStorage.removeItem(STORAGE_KEYS.agentModelCatalog)
    })

    it('keeps the declaration when the probe has no conclusion', async () => {
      const ctx = await setup(
        fakeAdapter({
          resolveModel: async () => ({
            endpoint: 'anthropic',
            id: 'm',
            inputModalities: ['text'],
          }),
        }),
      )
      await ctx.plugin(ModelCatalog)
      localStorage.setItem(
        STORAGE_KEYS.agentModelCatalog,
        JSON.stringify({
          [endpointKey(CONNECTION)]: { models: [{ id: 'm', status: 'unavailable' }], allowed: 10 },
        }),
      )
      expect((await ctx.llm.resolveModelInfo(CONNECTION)).inputModalities).toEqual(['text'])
      localStorage.removeItem(STORAGE_KEYS.agentModelCatalog)
    })
  })

  describe('images on a text-only model', () => {
    const WITH_IMAGE: GenerateOptions = {
      messages: [
        { role: 'user', content: 'look', images: ['data:image/png;base64,AAAA'] },
        { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
        { role: 'user', content: '', images: ['data:a', 'data:b'] },
      ],
    }

    async function sentMessages(modalities: LlmResolvedModelInfo['inputModalities']) {
      let sent: GenerateOptions | undefined
      const ctx = await setup(
        fakeAdapter({
          resolveModel: async () => ({
            endpoint: 'anthropic',
            id: 'm',
            ...(modalities ? { inputModalities: modalities } : {}),
          }),
          async *stream(options) {
            sent = options
            yield STOP
          },
        }),
      )
      await collect(dispatch(ctx, WITH_IMAGE, signal()))
      return sent!.messages
    }

    it('rejects a known text-only model before sending a request', async () => {
      const stream = vi.fn()
      const ctx = await setup(
        fakeAdapter({
          resolveModel: async () => ({ endpoint: 'anthropic', id: 'm', inputModalities: ['text'] }),
          stream,
        }),
      )
      await expect(ctx.llm.prepareCall()).rejects.toThrow('multimodal model')
      expect(stream).not.toHaveBeenCalled()
      expect((WITH_IMAGE.messages[0] as UserMessage).images).toHaveLength(1)
    })

    it('keeps images when the model accepts them', async () => {
      expect(await sentMessages(['text', 'image'])).toBe(WITH_IMAGE.messages)
    })

    it('keeps images when nothing is known about the model', async () => {
      expect(await sentMessages(undefined)).toBe(WITH_IMAGE.messages)
    })
  })

  describe('listModels', () => {
    it('drops rows with no usable id and repeated ids', async () => {
      const ctx = await setup(
        fakeAdapter({
          listModels: async () =>
            [{ id: 'a', maxTokens: 1 }, { id: '' }, { id: 'a', maxTokens: 2 }, {}, { id: 'b' }] as {
              id: string
            }[],
        }),
      )
      await expect(
        ctx.llm.listModels({
          endpoint: 'anthropic',
          baseUrl: 'https://llm.test/v1',
          apiKey: 'k',
          source: 'user',
        }),
      ).resolves.toEqual([{ id: 'a', maxTokens: 1 }, { id: 'b' }])
    })
  })
})
