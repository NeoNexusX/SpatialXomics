import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ConnectionManager } from '../../connection'
import { LlmRuntime, MAX_OUTPUT_TOKENS, BlockAssembler, describeFailure } from '../../llm'
import {
  adjustBehavior,
  AnthropicAdapter,
  retryPolicyFromConfig,
  toModelMessages,
  type EndpointBehavior,
} from '../index'
import * as llmAnthropic from '../index'
import { t } from '@/i18n'
import type {
  AssistantMessage,
  AssistantPart,
  ChatMessage,
  FinishReason,
  GenerateOptions,
  LlmFailure,
  StreamChunk,
} from '../../llm'
import type { ResolvedConnection } from '../../connection'

const CONNECTION: ResolvedConnection = {
  endpoint: 'anthropic',
  baseUrl: 'https://llm.test/v1',
  apiKey: 'sk-test',
  model: 'some-model',
  source: 'user',
}

// ---- 测试用的 SSE 响应 ----

type SseEvent = Record<string, unknown>

function sseResponse(events: SseEvent[]): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

const messageStart: SseEvent = {
  type: 'message_start',
  message: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'some-model',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 0 },
  },
}

const messageEnd = (stopReason: string): SseEvent[] => [
  {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
  },
  { type: 'message_stop' },
]

function textStream(text: string, stopReason = 'end_turn'): SseEvent[] {
  return [
    messageStart,
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    ...messageEnd(stopReason),
  ]
}

/** 真实网关返回的形态：思考块（文本可以为空）+ 签名 + 工具调用 */
function thinkingToolStream(thinking: string, signature: string): SseEvent[] {
  return [
    messageStart,
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    },
    ...(thinking
      ? [{ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } }]
      : []),
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'call_1', name: 'get_page_state', input: {} },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"topN":3}' },
    },
    { type: 'content_block_stop', index: 1 },
    ...messageEnd('tool_use'),
  ]
}

// ---- 请求捕获 ----

interface CapturedRequest {
  url: string
  headers: Headers
  body: Record<string, any>
}

function stubFetch(...responses: Response[]) {
  const requests: CapturedRequest[] = []
  const queue = [...responses]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : {},
      })
      const next = queue.shift()
      if (!next) throw new Error('unexpected request')
      return next
    }),
  )
  return requests
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const run = (
  adapter: AnthropicAdapter,
  options: Partial<GenerateOptions> = {},
  connection: ResolvedConnection = CONNECTION,
  signal: AbortSignal = new AbortController().signal,
) =>
  collect(
    adapter.stream({ messages: [{ role: 'user', content: 'hi' }], ...options }, connection, signal),
  )

function finishOf(chunks: StreamChunk[]) {
  return chunks[chunks.length - 1] as Extract<StreamChunk, { type: 'finish' }>
}

function assemble(chunks: StreamChunk[]): BlockAssembler {
  const assembler = new BlockAssembler()
  for (const chunk of chunks) assembler.push(chunk)
  return assembler
}

/** 失败结束时的失败快照 */
function failureOf(chunks: StreamChunk[]): LlmFailure {
  const reason: FinishReason = finishOf(chunks).reason
  if (reason.kind !== 'error') throw new Error(`expected an error, got ${reason.kind}`)
  return reason.failure
}

const USE_TOOL: AssistantPart = { type: 'tool-call', id: 'call_1', name: 'x', arguments: '{"a":1}' }
const THINKING: AssistantPart = { type: 'reasoning', text: 'plan' }

/** [THINKING, USE_TOOL] 这条消息，由 some-model 生成并带着思考块的签名 */
const SIGNED_REPLY: AssistantMessage = {
  role: 'assistant',
  parts: [THINKING, USE_TOOL],
  source: {
    endpoint: 'anthropic',
    model: 'some-model',
    replayState: {
      response: { kind: 'anthropic-messages', version: 1, model: 'some-model' },
      blocks: [{ type: 'reasoning', signature: 'sig-1' }, { type: 'tool-call' }],
    },
  },
}

/** 第二个回合的历史：第一回合调用过工具 */
const TWO_TURNS: ChatMessage[] = [
  { role: 'user', content: 'first' },
  SIGNED_REPLY,
  { role: 'tool', toolCallId: 'call_1', name: 'x', content: 'result' },
  { role: 'assistant', parts: [{ type: 'text', text: 'answer' }] },
  { role: 'user', content: 'second' },
]

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter

  beforeEach(() => {
    adapter = new AnthropicAdapter()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('request', () => {
    it('sends a tool_result image to the HTTP endpoint and retains the tool call id', async () => {
      const png =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='
      const requests = stubFetch(sseResponse(textStream('seen')))
      await run(adapter, {
        messages: [
          { role: 'user', content: 'show image' },
          {
            role: 'assistant',
            parts: [{ type: 'tool-call', id: 'img-call', name: 'get_ion_image', arguments: '{}' }],
          },
          {
            role: 'tool',
            toolCallId: 'img-call',
            name: 'get_ion_image',
            content: 'heatmap',
            images: [`data:image/png;base64,${png}`],
          },
        ],
      })
      const result = requests[0]!.body.messages.at(-1).content[0]
      expect(result).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'img-call',
        content: [
          { type: 'text', text: 'heatmap' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
        ],
      })
      expect(requests).toHaveLength(1)
    })

    it('keeps the endpoint image rejection and does not retry without the image', async () => {
      const requests = stubFetch(errorResponse(400, 'images in tool_result are unsupported'))
      const chunks = await run(adapter, {
        messages: [
          {
            role: 'assistant',
            parts: [{ type: 'tool-call', id: 'a', name: 'picture', arguments: '{}' }],
          },
          {
            role: 'tool',
            toolCallId: 'a',
            name: 'picture',
            content: 'image',
            images: ['data:image/png;base64,iVBORw0KGgo='],
          },
        ],
      })
      expect(failureOf(chunks).message).toContain('unsupported')
      expect(requests).toHaveLength(1)
    })

    it('sends standard Messages requests through the dev relay', async () => {
      const requests = stubFetch(sseResponse(textStream('ok')))
      await run(adapter, { system: 'be brief' })

      const [request] = requests
      // 测试环境是 dev：经 vite 转发，真实 origin 放在请求头
      expect(request!.url).toBe('/llm-relay/v1/messages')
      expect(request!.headers.get('x-llm-target')).toBe('https://llm.test')
      expect(request!.headers.get('x-api-key')).toBe('sk-test')
      expect(request!.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true')
      expect(request!.body.model).toBe('some-model')
      expect(request!.body.system).toEqual([{ type: 'text', text: 'be brief' }])
    })

    it('turns thinking on for every model, with no effort setting', async () => {
      const requests = stubFetch(sseResponse(textStream('ok')))
      await run(adapter)
      expect(requests[0]!.body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
      expect(requests[0]!.body.output_config?.effort).toBeUndefined()
    })

    it('adds caching for Claude models and refusal fallback only on the official endpoint', async () => {
      const requests = stubFetch(
        sseResponse(textStream('a')),
        sseResponse(textStream('b')),
        sseResponse(textStream('c')),
      )
      await run(adapter)
      await run(adapter, {}, { ...CONNECTION, model: 'claude-opus-5-5' })
      await run(
        adapter,
        {},
        { ...CONNECTION, baseUrl: 'https://api.anthropic.com/v1', model: 'claude-opus-5-5' },
      )

      expect(requests[0]!.body.cache_control).toBeUndefined()
      expect(requests[0]!.body.fallbacks).toBeUndefined()
      expect(requests[1]!.body.cache_control).toEqual({ type: 'ephemeral' })
      expect(requests[1]!.body.fallbacks).toBeUndefined()
      expect(requests[2]!.body.fallbacks).toBe('default')
    })

    it('sends a usable output limit for unknown models', async () => {
      const requests = stubFetch(sseResponse(textStream('ok')))
      await run(adapter)
      expect(requests[0]!.body.max_tokens).toBeGreaterThan(4096)
    })

    it('maps tools and does not ask for eager input streaming', async () => {
      const requests = stubFetch(sseResponse(textStream('ok')))
      await run(adapter, {
        tools: [
          {
            name: 'get_page_state',
            description: 'read the page',
            parameters: { type: 'object', properties: { topN: { type: 'number' } } },
          },
        ],
      })
      const [tool] = requests[0]!.body.tools
      expect(tool.name).toBe('get_page_state')
      expect(tool.input_schema.properties.topN.type).toBe('number')
      expect(tool.eager_input_streaming).toBeUndefined()
    })

    it('sends images as base64 sources and omits the empty text block', async () => {
      const requests = stubFetch(sseResponse(textStream('ok')))
      await run(adapter, {
        messages: [{ role: 'user', content: '', images: ['data:image/jpeg;base64,QUJD'] }],
      })
      const { content } = requests[0]!.body.messages[0]
      expect(content).toHaveLength(1)
      expect(content[0].type).toBe('image')
      expect(content[0].source).toMatchObject({
        type: 'base64',
        media_type: 'image/jpeg',
        data: 'QUJD',
      })
    })

    it('groups parallel tool results into one user message and flags errors', async () => {
      const requests = stubFetch(sseResponse(textStream('ok')))
      await run(adapter, {
        messages: [
          { role: 'user', content: 'go' },
          {
            role: 'assistant',
            parts: [
              { type: 'tool-call', id: 'a', name: 'x', arguments: '{}' },
              { type: 'tool-call', id: 'b', name: 'x', arguments: '{}' },
            ],
          },
          { role: 'tool', toolCallId: 'a', name: 'x', content: 'fine' },
          { role: 'tool', toolCallId: 'b', name: 'x', content: 'boom', isError: true },
        ],
      })
      const { messages } = requests[0]!.body
      expect(messages).toHaveLength(3)
      expect(messages[2].role).toBe('user')
      expect(messages[2].content.map((c: any) => [c.tool_use_id, !!c.is_error])).toEqual([
        ['a', false],
        ['b', true],
      ])
    })
  })

  describe('response', () => {
    it('streams text and reasoning and returns complete parts with the signature', async () => {
      stubFetch(sseResponse(thinkingToolStream('need the page', 'sig-abc')))
      const chunks = await run(adapter)

      expect(chunks).toContainEqual({ type: 'reasoning-delta', index: 0, text: 'need the page' })
      const assembler = assemble(chunks)
      expect(assembler.finish).toEqual({ kind: 'tool-calls' })
      expect(assembler.blocks()).toEqual([
        { type: 'reasoning', text: 'need the page' },
        { type: 'tool-call', id: 'call_1', name: 'get_page_state', arguments: '{"topN":3}' },
      ])
      expect(assembler.replayState).toEqual({
        response: { kind: 'anthropic-messages', version: 1, model: 'some-model' },
        blocks: [{ type: 'reasoning', signature: 'sig-abc' }, { type: 'tool-call' }],
      })
    })

    it('keeps an empty thinking block that carries only a signature', async () => {
      stubFetch(sseResponse(thinkingToolStream('', 'msg-id')))
      const chunks = await run(adapter)

      // 不产生界面增量，但块必须留着，下一步要原样回传
      expect(chunks.some((c) => c.type === 'reasoning-delta')).toBe(false)
      const assembler = assemble(chunks)
      expect(assembler.blocks()[0]).toEqual({ type: 'reasoning', text: '' })
      expect(assembler.replayState?.blocks?.[0]).toEqual({
        type: 'reasoning',
        signature: 'msg-id',
      })
    })

    it('maps refusal and length stop reasons', async () => {
      stubFetch(
        sseResponse(textStream('no', 'refusal')),
        sseResponse(textStream('long', 'max_tokens')),
      )
      expect(finishOf(await run(adapter)).reason).toEqual({ kind: 'refusal' })
      expect(finishOf(await run(adapter)).reason).toEqual({ kind: 'max-tokens' })
    })

    it('numbers blocks in arrival order and closes each one', async () => {
      stubFetch(sseResponse(thinkingToolStream('plan', 'sig')))
      const chunks = await run(adapter)
      expect(chunks.map((c) => c.type)).toEqual([
        'block-start',
        'reasoning-delta',
        'block-end',
        'block-start',
        'tool-call-delta',
        'tool-call-delta',
        'block-end',
        'usage',
        'finish',
      ])
      expect(chunks.filter((c) => c.type === 'block-start')).toEqual([
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'block-start', index: 1, blockType: 'tool-call' },
      ])
      expect(chunks[4]).toEqual({
        type: 'tool-call-delta',
        index: 1,
        id: 'call_1',
        name: 'get_page_state',
        argumentsDelta: '',
      })
    })

    it('keeps tool arguments as the raw text the model wrote', async () => {
      stubFetch(
        sseResponse([
          messageStart,
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'call_1', name: 'lookup', input: {} },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"mz": 1.10' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: ', "n": 2}' },
          },
          { type: 'content_block_stop', index: 0 },
          ...messageEnd('tool_use'),
        ]),
      )
      expect(assemble(await run(adapter)).blocks()).toEqual([
        { type: 'tool-call', id: 'call_1', name: 'lookup', arguments: '{"mz": 1.10, "n": 2}' },
      ])
    })

    it('reports usage before finish, with cache reads apart from uncached input', async () => {
      stubFetch(
        sseResponse([
          {
            type: 'message_start',
            message: {
              ...(messageStart.message as object),
              usage: {
                input_tokens: 10,
                cache_read_input_tokens: 90,
                cache_creation_input_tokens: 5,
                output_tokens: 0,
              },
            },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 7 },
          },
          { type: 'message_stop' },
        ]),
      )
      const chunks = await run(adapter)
      expect(chunks[chunks.length - 2]).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 10,
          promptTokens: 105,
          outputTokens: 7,
          totalTokens: 112,
          cacheReadTokens: 90,
          cacheWriteTokens: 5,
        },
      })
      expect(chunks[chunks.length - 1]!.type).toBe('finish')
    })

    it('reads a stream cut off after output as closed, not as a finished reply', async () => {
      stubFetch(
        sseResponse([
          messageStart,
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hel' } },
        ]),
      )
      expect(failureOf(await run(adapter)).code).toBe('STREAM_CLOSED')
    })

    it('reads a stream that ends right after it starts as closed', async () => {
      stubFetch(sseResponse([messageStart]))
      expect(failureOf(await run(adapter)).code).toBe('STREAM_CLOSED')
    })

    it('reads a completed reply with no content as empty', async () => {
      stubFetch(sseResponse([messageStart, ...messageEnd('end_turn')]))
      expect(failureOf(await run(adapter)).code).toBe('EMPTY_RESPONSE')
    })

    it('reads a window-filling stop with no output as context overflow', async () => {
      stubFetch(sseResponse([messageStart, ...messageEnd('model_context_window_exceeded')]))
      expect(failureOf(await run(adapter)).code).toBe('CONTEXT_WINDOW_EXCEEDED')
    })

    it('still accepts a reply when a sloppy gateway sends no stop reason', async () => {
      stubFetch(
        sseResponse([
          messageStart,
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_stop' },
        ]),
      )
      const assembler = assemble(await run(adapter))
      expect(assembler.finish).toEqual({ kind: 'stop' })
      expect(assembler.blocks()).toEqual([{ type: 'text', text: 'hi' }])
    })

    it('reports abort', async () => {
      const controller = new AbortController()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          controller.abort()
          init?.signal?.throwIfAborted()
          return sseResponse(textStream('late'))
        }),
      )
      const chunks = await run(adapter, {}, CONNECTION, controller.signal)
      expect(finishOf(chunks).reason).toMatchObject({
        kind: 'aborted',
        failure: { code: 'ABORTED' },
      })
    })
  })

  describe('errors', () => {
    it.each([
      [401, () => t('common.agent.errors.auth', { status: 401 })],
      [404, () => t('common.agent.errors.notFound')],
    ])('translates HTTP %i and keeps the upstream message', async (status, expected) => {
      stubFetch(errorResponse(status, 'upstream says no'))
      const text = describeFailure(failureOf(await run(adapter)), CONNECTION)
      expect(text).toContain(expected())
      expect(text).toContain('upstream says no')
    })

    describe('classification', () => {
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        })
      const typed = (type: string, message: string) => ({ type: 'error', error: { type, message } })

      it.each<[string, number, string, string, string]>([
        ['bad key', 401, 'authentication_error', 'invalid x-api-key', 'AUTH'],
        ['no permission', 403, 'permission_error', 'not allowed', 'AUTH'],
        ['billing', 402, 'billing_error', 'payment required', 'QUOTA'],
        [
          'balance on a 400',
          400,
          'invalid_request_error',
          'Your credit balance is too low',
          'QUOTA',
        ],
        ['exhausted 429', 429, 'rate_limit_error', 'You exceeded your current quota', 'QUOTA'],
        ['rate limit', 429, 'rate_limit_error', 'slow down', 'RATE_LIMIT'],
        [
          'overflow',
          400,
          'invalid_request_error',
          'prompt is too long: 209000 tokens > 200000 maximum',
          'CONTEXT_WINDOW_EXCEEDED',
        ],
        [
          'bad request',
          400,
          'invalid_request_error',
          'messages: field required',
          'INVALID_REQUEST',
        ],
        ['too large', 413, 'request_too_large', 'body too large', 'INVALID_REQUEST'],
        ['server', 500, 'api_error', 'boom', 'SERVER'],
        ['overloaded', 529, 'overloaded_error', 'Overloaded', 'SERVER'],
        ['not found', 404, 'not_found_error', 'no such model', 'HTTP_404'],
        ['unprocessable', 422, 'unprocessable', 'nope', 'HTTP_422'],
      ])('%s', async (_name, status, type, message, code) => {
        stubFetch(json(status, typed(type, message)))
        const failure = failureOf(await run(adapter))
        expect(failure).toMatchObject({ code, status, message })
      })

      it('keeps Retry-After and the request id from the headers', async () => {
        stubFetch(
          json(429, typed('rate_limit_error', 'slow down'), {
            'retry-after': '2',
            'request-id': 'req_1',
          }),
        )
        expect(failureOf(await run(adapter))).toMatchObject({
          providerRetryAfterMs: 2000,
          requestId: 'req_1',
        })
      })

      it('prefers the millisecond Retry-After and falls back to the body request id', async () => {
        stubFetch(
          json(
            500,
            { ...typed('api_error', 'boom'), request_id: 'req_body' },
            { 'retry-after-ms': '750', 'retry-after': '9' },
          ),
        )
        expect(failureOf(await run(adapter))).toMatchObject({
          providerRetryAfterMs: 750,
          requestId: 'req_body',
        })
      })

      it('classifies an error event in the middle of the stream', async () => {
        stubFetch(
          sseResponse([
            messageStart,
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'p' } },
            typed('overloaded_error', 'Overloaded'),
          ]),
        )
        expect(failureOf(await run(adapter))).toMatchObject({ code: 'SERVER', status: 529 })
      })

      it('classifies an error event before any output', async () => {
        stubFetch(sseResponse([typed('rate_limit_error', 'slow down')]))
        expect(failureOf(await run(adapter))).toMatchObject({ code: 'RATE_LIMIT', status: 429 })
      })

      it('refuses an unusable key before any request, without echoing it', async () => {
        const requests = stubFetch()
        const secret = 'sk-密钥'
        const failure = failureOf(await run(adapter, {}, { ...CONNECTION, apiKey: secret }))
        expect(requests).toHaveLength(0)
        expect(failure.code).toBe('INVALID_CREDENTIAL')
        expect(failure.message).not.toContain('密钥')
        expect(describeFailure(failure, CONNECTION)).toBe(t('common.agent.errors.invalidKey'))
      })

      it('reports a read that dies mid-stream as transport', async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(messageStart)}\n\n`),
            )
          },
          pull(controller) {
            controller.error(new TypeError('Load failed'))
          },
        })
        stubFetch(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
        expect(failureOf(await run(adapter)).code).toBe('TRANSPORT')
      })
    })

    it('times out a stream that goes silent, without treating it as a user abort', async () => {
      const quick = new AnthropicAdapter({ idleTimeoutMs: 20 })
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(messageStart)}\n\n`))
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              })}\n\n`,
            ),
          )
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'partial' },
              })}\n\n`,
            ),
          )
          // 之后什么都不发，连接也不断
        },
      })
      stubFetch(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
      const failure = failureOf(await run(quick))
      expect(failure.code).toBe('TIMEOUT')
      expect(describeFailure(failure, CONNECTION)).toBe(
        t('common.agent.errors.timeout', { host: 'llm.test' }),
      )
    })

    it('counts heartbeats as activity, so a slow model is not timed out', async () => {
      const quick = new AnthropicAdapter({ idleTimeoutMs: 40 })
      const encoder = new TextEncoder()
      const event = (data: SseEvent) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(event(messageStart))
          // 总时长超过空闲上限，但一直有心跳
          for (let i = 0; i < 6; i++) {
            await sleep(15)
            controller.enqueue(event({ type: 'ping' }))
          }
          for (const part of textStream('slow but fine').slice(1)) {
            controller.enqueue(event(part))
          }
          controller.close()
        },
      })
      stubFetch(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
      const assembler = assemble(await run(quick))
      expect(assembler.finish).toEqual({ kind: 'stop' })
      expect(assembler.blocks()).toEqual([{ type: 'text', text: 'slow but fine' }])
    })

    it('times out when the model never starts answering', async () => {
      const quick = new AnthropicAdapter({ idleTimeoutMs: 20 })
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
            }),
        ),
      )
      expect(failureOf(await run(quick)).code).toBe('TIMEOUT')
    })

    it('reports a user abort as aborted even when a timeout is also configured', async () => {
      const quick = new AnthropicAdapter({ idleTimeoutMs: 60_000 })
      const controller = new AbortController()
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
              controller.abort()
            }),
        ),
      )
      const chunks = await run(quick, {}, CONNECTION, controller.signal)
      expect(finishOf(chunks).reason.kind).toBe('aborted')
    })

    it.each([429, 500, 503, 529])('makes one attempt per stream on HTTP %i', async (status) => {
      const requests = stubFetch(errorResponse(status, 'try again'))
      expect(failureOf(await run(adapter)).status).toBe(status)
      expect(requests).toHaveLength(1)
    })

    it('does not retry a 400 it cannot correct', async () => {
      const requests = stubFetch(errorResponse(400, 'messages: field required'))
      const failure = failureOf(await run(adapter))
      expect(requests).toHaveLength(1)
      expect(failure).toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
      expect(failure.message).toContain('messages: field required')
    })

    it('reports an address that answers with a web page', async () => {
      stubFetch(
        new Response('<!doctype html><title>Home</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )
      expect(failureOf(await run(adapter)).code).toBe('MALFORMED_RESPONSE')
    })

    it('reports a network failure with the host name', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      )
      const failure = failureOf(await run(adapter))
      expect(failure.code).toBe('TRANSPORT')
      expect(describeFailure(failure, CONNECTION)).toBe(
        t('common.agent.errors.network', { host: 'llm.test' }),
      )
    })
  })

  describe('learning endpoint behavior', () => {
    const PASSED_BACK =
      'The `content[].thinking` in the thinking mode must be passed back to the API.'
    const BOUND =
      'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.'

    const agentBlocks = (request: CapturedRequest, index: number) =>
      request.body.messages[index].content.map((c: any) => c.type)

    it('fills in a missing thinking block when the endpoint demands one, then remembers', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'go' },
        // 这一步模型没有返回思考块
        { role: 'assistant', parts: [USE_TOOL] },
        { role: 'tool', toolCallId: 'call_1', name: 'x', content: 'r' },
      ]
      const requests = stubFetch(
        errorResponse(400, PASSED_BACK),
        sseResponse(textStream('recovered')),
        sseResponse(textStream('next')),
      )

      const assembler = assemble(await run(adapter, { messages: history }))
      expect(assembler.finish).toEqual({ kind: 'stop' })
      expect(assembler.blocks()).toEqual([{ type: 'text', text: 'recovered' }])

      expect(agentBlocks(requests[0]!, 1)).toEqual(['tool_use'])
      expect(agentBlocks(requests[1]!, 1)).toEqual(['thinking', 'tool_use'])
      expect(requests[1]!.body.messages[1].content[0].thinking).toBe('')

      // 记住了：同一地址和模型不再先撞一次 400
      await run(adapter, { messages: history })
      expect(requests).toHaveLength(3)
      expect(agentBlocks(requests[2]!, 1)).toEqual(['thinking', 'tool_use'])
    })

    it('learns per address and model', async () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'go' },
        { role: 'assistant', parts: [USE_TOOL] },
        { role: 'tool', toolCallId: 'call_1', name: 'x', content: 'r' },
      ]
      const requests = stubFetch(
        errorResponse(400, PASSED_BACK),
        sseResponse(textStream('a')),
        sseResponse(textStream('b')),
      )
      await run(adapter, { messages: history })
      await run(adapter, { messages: history }, { ...CONNECTION, model: 'other-model' })
      expect(agentBlocks(requests[2]!, 1)).toEqual(['tool_use'])
    })

    it('narrows replay to the current turn when old signatures stop being valid', async () => {
      const requests = stubFetch(errorResponse(400, BOUND), sseResponse(textStream('ok')))
      const finish = finishOf(await run(adapter, { messages: TWO_TURNS }))

      expect(finish.reason).toEqual({ kind: 'stop' })
      expect(agentBlocks(requests[0]!, 1)).toEqual(['thinking', 'tool_use'])
      expect(agentBlocks(requests[1]!, 1)).toEqual(['tool_use'])
    })

    it('omits all thinking when even the current turn is rejected', async () => {
      const inTurn: ChatMessage[] = [
        { role: 'user', content: 'go' },
        SIGNED_REPLY,
        { role: 'tool', toolCallId: 'call_1', name: 'x', content: 'r' },
      ]
      const requests = stubFetch(
        errorResponse(400, BOUND),
        errorResponse(400, BOUND),
        sseResponse(textStream('ok')),
      )
      const finish = finishOf(await run(adapter, { messages: inTurn }))

      expect(finish.reason).toEqual({ kind: 'stop' })
      expect(agentBlocks(requests[1]!, 1)).toEqual(['thinking', 'tool_use'])
      expect(agentBlocks(requests[2]!, 1)).toEqual(['tool_use'])
    })

    it('falls back to a thinking budget when the endpoint rejects adaptive', async () => {
      const requests = stubFetch(
        errorResponse(400, "thinking.type: Input should be 'enabled' or 'disabled'"),
        sseResponse(textStream('ok')),
      )
      const finish = finishOf(await run(adapter))
      expect(finish.reason).toEqual({ kind: 'stop' })
      expect(requests[1]!.body.thinking.type).toBe('enabled')
      expect(requests[1]!.body.thinking.budget_tokens).toBeGreaterThan(0)
      expect(requests[1]!.body.thinking.budget_tokens).toBeLessThan(requests[1]!.body.max_tokens)
    })

    it('gives up after the corrections run out instead of looping', async () => {
      const requests = stubFetch(
        errorResponse(400, PASSED_BACK),
        errorResponse(400, PASSED_BACK),
        errorResponse(400, PASSED_BACK),
      )
      const failure = failureOf(await run(adapter))
      expect(requests).toHaveLength(2)
      expect(failure.message).toContain('must be passed back')
    })

    it('does not retry after output has already been streamed', async () => {
      const partial = sseResponse([
        messageStart,
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } },
        {
          type: 'error',
          error: { type: 'invalid_request_error', message: PASSED_BACK },
        },
      ])
      const requests = stubFetch(partial)
      const failure = failureOf(await run(adapter))
      expect(requests).toHaveLength(1)
      expect(failure.code).toBe('INVALID_REQUEST')
    })
  })

  describe('listModels', () => {
    it('reads model ids from the endpoint', async () => {
      const requests = stubFetch(
        new Response(JSON.stringify({ data: [{ id: 'k3' }, { id: 'deepseek-flash-latest' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      await expect(adapter.listModels(CONNECTION)).resolves.toEqual([
        { id: 'k3' },
        { id: 'deepseek-flash-latest' },
      ])
      expect(requests[0]!.url).toBe('/llm-relay/v1/models?limit=1000')
      expect(requests[0]!.headers.get('x-api-key')).toBe('sk-test')
    })

    it('throws a readable error', async () => {
      stubFetch(errorResponse(401, 'bad key'))
      await expect(adapter.listModels(CONNECTION)).rejects.toThrow('bad key')
    })

    it('throws classified failures', async () => {
      stubFetch(errorResponse(401, 'bad key'))
      await expect(adapter.listModels(CONNECTION)).rejects.toMatchObject({
        code: 'AUTH',
        failure: { status: 401 },
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      )
      await expect(adapter.listModels(CONNECTION)).rejects.toMatchObject({ code: 'TRANSPORT' })
    })

    it('says so when the address does not serve a model listing', async () => {
      stubFetch(new Response('<!doctype html>', { status: 200 }))
      await expect(adapter.listModels(CONNECTION)).rejects.toMatchObject({
        code: 'MALFORMED_RESPONSE',
      })
    })

    it('refuses an unusable key without sending it', async () => {
      const requests = stubFetch()
      await expect(adapter.listModels({ ...CONNECTION, apiKey: 'sk 密钥' })).rejects.toMatchObject({
        code: 'INVALID_CREDENTIAL',
      })
      expect(requests).toHaveLength(0)
    })
  })

  describe('resolveModel', () => {
    const listing = (models: unknown[]) =>
      new Response(JSON.stringify({ data: models }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    const LISTED = {
      id: 'some-model',
      max_input_tokens: 200_000,
      max_tokens: 8_192,
      capabilities: { image_input: { supported: false } },
    }

    it('reports what the endpoint lists for a known model', async () => {
      stubFetch(listing([LISTED]))
      await expect(adapter.resolveModel(CONNECTION)).resolves.toEqual({
        endpoint: 'anthropic',
        id: 'some-model',
        inputModalities: ['text'],
        context: { contextWindow: 200_000 },
        defaultMaxTokens: 8_192,
      })
    })

    it('never raises the output limit above what the assistant asks for', async () => {
      stubFetch(listing([{ id: 'some-model', max_tokens: 128_000 }]))
      const info = await adapter.resolveModel(CONNECTION)
      expect(info.defaultMaxTokens).toBe(MAX_OUTPUT_TOKENS)
    })

    it('knows nothing about a model the endpoint does not list', async () => {
      stubFetch(listing([{ ...LISTED, id: 'another-model' }]))
      await expect(adapter.resolveModel(CONNECTION)).resolves.toEqual({
        endpoint: 'anthropic',
        id: 'some-model',
        defaultMaxTokens: MAX_OUTPUT_TOKENS,
      })
    })

    it('ignores declared limits that do not make sense', async () => {
      stubFetch(listing([{ id: 'some-model', context_window: -1, max_tokens: 1.5 }]))
      await expect(adapter.resolveModel(CONNECTION)).resolves.toEqual({
        endpoint: 'anthropic',
        id: 'some-model',
        defaultMaxTokens: MAX_OUTPUT_TOKENS,
      })
    })

    it.each<[string, () => Response | never]>([
      ['a 404', () => errorResponse(404, 'no listing here')],
      ['a web page', () => new Response('<!doctype html>', { status: 200 })],
    ])('keeps chat working when the listing is %s', async (_name, response) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      stubFetch(response())
      await expect(adapter.resolveModel(CONNECTION)).resolves.toEqual({
        endpoint: 'anthropic',
        id: 'some-model',
        defaultMaxTokens: MAX_OUTPUT_TOKENS,
      })
      warn.mockRestore()
    })

    it('reuses a listing the user already fetched', async () => {
      const requests = stubFetch(listing([LISTED]))
      await adapter.listModels(CONNECTION)
      const info = await adapter.resolveModel(CONNECTION)
      expect(info.defaultMaxTokens).toBe(8_192)
      expect(requests).toHaveLength(1)
    })
  })

  describe('probeVision', () => {
    // 这里只看单次结果；重试有单独的用例，不让用例真的等退避
    beforeEach(() => {
      adapter = new AnthropicAdapter({ probeRetry: { maxRetries: 0 } })
    })

    const reply = (text: string, thinking = '') => {
      const blocks: SseEvent[] = []
      let index = 0
      if (thinking) {
        blocks.push(
          {
            type: 'content_block_start',
            index,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          },
          { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } },
          { type: 'content_block_stop', index },
        )
        index++
      }
      if (text) {
        blocks.push(
          { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
          { type: 'content_block_stop', index },
        )
      }
      return sseResponse([messageStart, ...blocks, ...messageEnd(text ? 'end_turn' : 'max_tokens')])
    }

    it('sends a small image and a question, and passes on the right answer', async () => {
      const requests = stubFetch(reply('Green'))
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('vision')

      const { body } = requests[0]!
      expect(body.max_tokens).toBeLessThanOrEqual(1024)
      expect(body.tools).toBeUndefined()
      const { content } = body.messages[0]
      const image = content.find((block: any) => block.type === 'image')
      const question = content.find((block: any) => block.type === 'text')
      expect(image.source.media_type).toBe('image/png')
      expect(image.source.data.length).toBeLessThan(500)
      expect(question.text).toContain('color')
    })

    it.each(['绿色', 'green.', 'The image is GREEN'])('accepts the answer %s', async (answer) => {
      stubFetch(reply(answer))
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('vision')
    })

    it('fails a model that answers without seeing the image', async () => {
      stubFetch(reply("I can't see any image. [Unsupported Image]"))
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('no-vision')
    })

    it('accepts the answer from thinking when the output limit cuts off the reply', async () => {
      stubFetch(reply('', 'The image is a solid green square.'))
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('vision')
    })

    // 这些错误文案都来自真实端点
    it.each([
      [400, 'Model only support text input'],
      [404, 'No endpoints found that support image input'],
      [400, 'messages: invalid request'],
    ])('reads HTTP %i "%s" as no image support', async (status, message) => {
      stubFetch(errorResponse(status, message))
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('no-vision')
    })

    it.each([
      [429, 'quota exhausted'],
      [404, 'The free launch period for this model ended'],
      [401, 'invalid token'],
      [500, 'upstream error'],
    ])('reads HTTP %i "%s" as inconclusive, not unsupported', async (status, message) => {
      stubFetch(errorResponse(status, message))
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('unavailable')
    })

    // 第二个是 WebKit 的文案：页面离开时，进行中的请求就是这样失败的
    it.each(['Failed to fetch', 'Load failed'])('reads "%s" as no response', async (message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError(message)
        }),
      )
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('no-response')
    })

    it('reads a reply cut off mid-stream as no response', async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(messageStart)}\n\n`))
        },
        pull(controller) {
          controller.error(new TypeError('Load failed'))
        },
      })
      stubFetch(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('no-response')
    })

    it('uses the same streaming path as chat, so unsigned thinking does not fail it', async () => {
      const requests = stubFetch(reply('green', 'no signature on this block'))
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('vision')
      expect(requests[0]!.body.stream).toBe(true)
    })

    it.each([
      [400, 'Your credit balance is too low'],
      [400, 'prompt is too long: 9 tokens > 1 maximum'],
    ])('does not blame image support for HTTP %i "%s"', async (status, message) => {
      stubFetch(errorResponse(status, message))
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('unavailable')
    })

    it('retries rate limits and server errors within its budget', async () => {
      const retrying = new AnthropicAdapter({
        probeRetry: { maxRetries: 2, backoff: { initialDelayMs: 1, maxDelayMs: 2 } },
      })
      const requests = stubFetch(
        errorResponse(429, 'slow down'),
        errorResponse(500, 'hiccup'),
        reply('Green'),
      )
      await expect(retrying.probeVision(CONNECTION)).resolves.toBe('vision')
      expect(requests).toHaveLength(3)
    })

    it('gives up when the budget runs out', async () => {
      const retrying = new AnthropicAdapter({
        probeRetry: { maxRetries: 1, backoff: { initialDelayMs: 1, maxDelayMs: 2 } },
      })
      const requests = stubFetch(errorResponse(500, 'hiccup'), errorResponse(500, 'hiccup'))
      await expect(retrying.probeVision(CONNECTION)).resolves.toBe('unavailable')
      expect(requests).toHaveLength(2)
    })

    it('does not spend retries on a page that is going away', async () => {
      const retrying = new AnthropicAdapter({
        probeRetry: {
          maxRetries: 2,
          retryableCodes: ['RATE_LIMIT', 'SERVER'],
          backoff: { initialDelayMs: 1, maxDelayMs: 2 },
        },
      })
      const fetchStub = vi.fn(async () => {
        throw new TypeError('Load failed')
      })
      vi.stubGlobal('fetch', fetchStub)
      await expect(retrying.probeVision(CONNECTION)).resolves.toBe('no-response')
      expect(fetchStub).toHaveBeenCalledOnce()
    })

    it('adjusts the thinking parameter when the endpoint rejects it', async () => {
      const requests = stubFetch(
        errorResponse(400, "thinking.type: Input should be 'enabled' or 'disabled'"),
        reply('Green'),
      )
      await expect(adapter.probeVision(CONNECTION)).resolves.toBe('vision')
      expect(requests[1]!.body.thinking.type).toBe('enabled')
      expect(requests[1]!.body.thinking.budget_tokens).toBeLessThan(requests[1]!.body.max_tokens)
    })

    it('stops when cancelled', async () => {
      const controller = new AbortController()
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          controller.abort()
          init?.signal?.throwIfAborted()
          return reply('Green')
        }),
      )
      await expect(adapter.probeVision(CONNECTION, controller.signal)).resolves.toBe('unavailable')
    })
  })
})

describe('toModelMessages', () => {
  const agentContent = (messages: ChatMessage[], replay?: EndpointBehavior['replay']) =>
    (toModelMessages(messages, replay)[1] as { content: { type: string }[] }).content

  it('replays thinking in order, with its signature', () => {
    const content = agentContent(TWO_TURNS) as any[]
    expect(content.map((c) => c.type)).toEqual(['reasoning', 'tool-call'])
    expect(content[0].providerOptions.anthropic.signature).toBe('sig-1')
  })

  it('keeps thinking text from endpoints that send no signature', () => {
    const content = agentContent([
      { role: 'user', content: 'q' },
      { role: 'assistant', parts: [{ type: 'reasoning', text: 'unsigned plan' }, USE_TOOL] },
    ]) as any[]
    expect(content[0].text).toBe('unsigned plan')
    expect(content[0].providerOptions.anthropic.signature).toBeTruthy()
  })

  it('replays redacted thinking data', () => {
    const content = agentContent([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        parts: [{ type: 'reasoning', text: '' }, USE_TOOL],
        source: {
          endpoint: 'anthropic',
          model: 'some-model',
          replayState: {
            response: { kind: 'anthropic-messages', version: 1, model: 'some-model' },
            blocks: [{ type: 'reasoning', redactedData: 'abc' }, { type: 'tool-call' }],
          },
        },
      },
    ]) as any[]
    expect(content[0].providerOptions.anthropic.redactedData).toBe('abc')
  })

  it('fill-missing adds a block only where one is missing', () => {
    const messages = toModelMessages(TWO_TURNS, 'fill-missing') as any[]
    expect(messages[1].content.map((c: any) => c.type)).toEqual(['reasoning', 'tool-call'])
    expect(messages[1].content[0].text).toBe('plan')
    expect(messages[3].content.map((c: any) => c.type)).toEqual(['reasoning', 'text'])
    expect(messages[3].content[0].text).toBe('')
  })

  it('current-turn drops only thinking from before the last user message', () => {
    const history: ChatMessage[] = [
      ...TWO_TURNS,
      SIGNED_REPLY,
      { role: 'tool', toolCallId: 'call_1', name: 'x', content: 'r' },
    ]
    const messages = toModelMessages(history, 'current-turn') as any[]
    expect(messages[1].content.map((c: any) => c.type)).toEqual(['tool-call'])
    expect(messages[5].content.map((c: any) => c.type)).toEqual(['reasoning', 'tool-call'])
  })

  it('omit drops all thinking', () => {
    expect(agentContent(TWO_TURNS, 'omit').map((c) => c.type)).toEqual(['tool-call'])
  })

  it('sends empty input for arguments the protocol cannot represent, keeping the call', () => {
    const content = (reply: string) =>
      (
        toModelMessages([
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            parts: [{ type: 'tool-call', id: 'c1', name: 'x', arguments: reply }],
          },
          { role: 'tool', toolCallId: 'c1', name: 'x', content: 'r' },
        ])[1] as any
      ).content[0]
    expect(content('{"a":1}')).toMatchObject({ toolCallId: 'c1', input: { a: 1 } })
    expect(content('{"a":')).toMatchObject({ toolCallId: 'c1', input: {} })
    expect(content('[1,2]')).toMatchObject({ toolCallId: 'c1', input: {} })
    expect(content('')).toMatchObject({ toolCallId: 'c1', input: {} })
  })

  describe('replay state', () => {
    const signature = (message: ChatMessage, target?: Parameters<typeof toModelMessages>[2]) =>
      (toModelMessages([{ role: 'user', content: 'q' }, message], 'verbatim', target)[1] as any)
        .content[0].providerOptions.anthropic.signature

    it('uses the signature on the model that wrote it', () => {
      expect(signature(SIGNED_REPLY, { model: 'some-model' })).toBe('sig-1')
    })

    it('keeps the thinking text but not the signature on another model', () => {
      const onDegrade = vi.fn()
      const messages = toModelMessages([{ role: 'user', content: 'q' }, SIGNED_REPLY], 'verbatim', {
        model: 'other-model',
        onDegrade,
      }) as any[]
      expect(messages[1].content[0].text).toBe('plan')
      expect(messages[1].content[0].providerOptions.anthropic.signature).toBe('unsigned')
      // 换模型是正常情况，不算元数据损坏
      expect(onDegrade).not.toHaveBeenCalled()
    })

    it.each<[string, Partial<NonNullable<AssistantMessage['source']>>]>([
      [
        'another protocol',
        {
          replayState: {
            response: { kind: 'other', version: 1, model: 'some-model' },
            blocks: [{ type: 'reasoning', signature: 'x' }, { type: 'tool-call' }],
          },
        },
      ],
      [
        'a newer version',
        {
          replayState: {
            response: { kind: 'anthropic-messages', version: 2, model: 'some-model' },
            blocks: [{ type: 'reasoning', signature: 'x' }, { type: 'tool-call' }],
          },
        },
      ],
      [
        'a model that does not match its source',
        {
          replayState: {
            response: { kind: 'anthropic-messages', version: 1, model: 'elsewhere' },
            blocks: [{ type: 'reasoning', signature: 'x' }, { type: 'tool-call' }],
          },
        },
      ],
      [
        'misaligned blocks',
        {
          replayState: {
            response: { kind: 'anthropic-messages', version: 1, model: 'some-model' },
            blocks: [{ type: 'reasoning', signature: 'x' }],
          },
        },
      ],
      [
        'a block of the wrong type',
        {
          replayState: {
            response: { kind: 'anthropic-messages', version: 1, model: 'some-model' },
            blocks: [{ type: 'text' }, { type: 'tool-call' }],
          },
        },
      ],
      [
        'a signature that is not text',
        {
          replayState: {
            response: { kind: 'anthropic-messages', version: 1, model: 'some-model' },
            blocks: [{ type: 'reasoning', signature: 5 }, { type: 'tool-call' }],
          },
        },
      ],
    ])('degrades to plain content for %s', (_name, source) => {
      const onDegrade = vi.fn()
      const message: AssistantMessage = {
        ...SIGNED_REPLY,
        source: { ...SIGNED_REPLY.source!, ...source },
      }
      expect(signature(message, { model: 'some-model', onDegrade })).toBe('unsigned')
      expect(onDegrade).toHaveBeenCalledOnce()
    })

    it('warns once per problem while sending the content anyway', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const adapter = new AnthropicAdapter()
      const broken: AssistantMessage = {
        ...SIGNED_REPLY,
        source: {
          ...SIGNED_REPLY.source!,
          replayState: { response: { kind: 'other' }, blocks: [] },
        },
      }
      const history: ChatMessage[] = [
        { role: 'user', content: 'q' },
        broken,
        { role: 'tool', toolCallId: 'call_1', name: 'x', content: 'r' },
      ]
      const requests = stubFetch(sseResponse(textStream('a')), sseResponse(textStream('b')))
      await run(adapter, { messages: history })
      await run(adapter, { messages: history })
      expect(warn).toHaveBeenCalledOnce()
      expect(requests[1]!.body.messages[1].content[0].thinking).toBe('plan')
      warn.mockRestore()
      vi.unstubAllGlobals()
    })
  })
})

describe('adjustBehavior', () => {
  const base: EndpointBehavior = { replay: 'verbatim', thinking: 'adaptive' }

  it.each([
    'The `content[].thinking` in the thinking mode must be passed back to the API.',
    'The `reasoning_content` in the thinking mode must be passed back to the API',
    'Missing `reasoning_content` field in the assistant message at message index 3',
    'thinking is enabled but reasoning_content is missing in assistant tool call message at index 2',
  ])('fills in missing thinking for: %s', (message) => {
    expect(adjustBehavior(base, message)?.replay).toBe('fill-missing')
  })

  it('steps down the replay scope on signature errors', () => {
    const message =
      'Invalid `signature` in `thinking` block. The block is bound to a different conversation.'
    expect(adjustBehavior(base, message)?.replay).toBe('current-turn')
    expect(adjustBehavior({ ...base, replay: 'fill-missing' }, message)?.replay).toBe(
      'current-turn',
    )
    expect(adjustBehavior({ ...base, replay: 'current-turn' }, message)?.replay).toBe('omit')
    expect(adjustBehavior({ ...base, replay: 'omit' }, message)).toBeNull()
  })

  it('switches the thinking parameter when adaptive is rejected', () => {
    const message = "thinking.type: Input should be 'enabled' or 'disabled'"
    expect(adjustBehavior(base, message)?.thinking).toBe('budget')
    expect(adjustBehavior({ ...base, thinking: 'budget' }, message)).toBeNull()
  })

  it('does not mistake a thinking parameter error for missing thinking blocks', () => {
    const message = 'thinking.budget_tokens: Field required'
    expect(adjustBehavior(base, message)).toEqual({ replay: 'verbatim', thinking: 'budget' })
  })

  it('reads the full signature error as a signature problem', () => {
    const message =
      'messages.5.content.0: Invalid `signature` in `thinking` block. The block is bound to a ' +
      'different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` ' +
      'to "drop_block". That setting requires the `thinking-binding-controls-2026-08-01` value.'
    expect(adjustBehavior(base, message)?.replay).toBe('current-turn')
  })

  it('leaves unrelated errors alone', () => {
    expect(adjustBehavior(base, 'messages: field required')).toBeNull()
    expect(adjustBehavior(base, 'max_tokens: must be less than 8192')).toBeNull()
  })
})

describe('retryPolicyFromConfig', () => {
  it('uses the defaults when nothing is configured', () => {
    expect(retryPolicyFromConfig(undefined).maxRetries).toBe(5)
  })

  it('honours a valid policy', () => {
    expect(retryPolicyFromConfig({ maxRetries: 0 }).maxRetries).toBe(0)
  })

  it.each<[string, unknown]>([
    ['an unknown mode', { mode: 'always' }],
    ['a bad budget', { maxRetries: -1 }],
    ['a value of the wrong shape', 'often'],
  ])('warns and falls back on %s', (_name, raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(retryPolicyFromConfig(raw).maxRetries).toBe(5)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0]).toContain('llm.retryPolicy')
    warn.mockRestore()
  })
})

describe('llmAnthropic', () => {
  it('registers with ctx.llm so requests route through the active connection', async () => {
    localStorage.setItem(
      'assistant_connection',
      JSON.stringify({
        endpoint: 'anthropic',
        baseUrl: 'https://llm.test',
        apiKey: 'sk-x',
        model: 'm',
      }),
    )
    // 第一个请求是取模型事实的 /models，这个端点没有
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const requests = stubFetch(errorResponse(404, 'no listing'), sseResponse(textStream('hello')))

    const ctx = new Context()
    await ctx.plugin(ConnectionManager)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(llmAnthropic)

    const signal = new AbortController().signal
    const call = await ctx.llm.prepareCall(signal)
    const chunks = await collect(call.stream({ messages: [{ role: 'user', content: 'hi' }] }, signal))

    expect(assemble(chunks).blocks()).toEqual([{ type: 'text', text: 'hello' }])
    expect(requests[1]!.headers.get('x-api-key')).toBe('sk-x')
    expect(requests[1]!.body.model).toBe('m')

    warn.mockRestore()
    vi.unstubAllGlobals()
    localStorage.removeItem('assistant_connection')
  })
})
