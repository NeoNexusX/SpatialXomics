import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { connectionProvider } from '../providers/connection'
import { llmProvider } from '../providers/llm'
import {
  adjustBehavior,
  AnthropicAdapter,
  anthropicAdapterPlugin,
  toModelMessages,
  type EndpointBehavior,
} from '../plugins/anthropicAdapter'
import { t } from '@/i18n'
import type {
  AssistantPart,
  ChatMessage,
  GenerateOptions,
  ResolvedConnection,
  StreamChunk,
} from '../agenttypes/assistant'

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

const USE_TOOL: AssistantPart = { type: 'tool-call', id: 'call_1', name: 'x', input: { a: 1 } }
const THINKING: AssistantPart = {
  type: 'reasoning',
  text: 'plan',
  replay: { signature: 'sig-1' },
}

/** 第二个回合的历史：第一回合调用过工具 */
const TWO_TURNS: ChatMessage[] = [
  { role: 'user', content: 'first' },
  { role: 'assistant', parts: [THINKING, USE_TOOL] },
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
              { type: 'tool-call', id: 'a', name: 'x', input: {} },
              { type: 'tool-call', id: 'b', name: 'x', input: {} },
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

      expect(chunks[0]).toEqual({ type: 'reasoning-delta', text: 'need the page' })
      const finish = finishOf(chunks)
      expect(finish.reason).toBe('tool-calls')
      expect(finish.parts).toEqual([
        { type: 'reasoning', text: 'need the page', replay: { signature: 'sig-abc' } },
        { type: 'tool-call', id: 'call_1', name: 'get_page_state', input: { topN: 3 } },
      ])
    })

    it('keeps an empty thinking block that carries only a signature', async () => {
      stubFetch(sseResponse(thinkingToolStream('', 'msg-id')))
      const chunks = await run(adapter)

      // 不产生界面增量，但块必须留着，下一步要原样回传
      expect(chunks.some((c) => c.type === 'reasoning-delta')).toBe(false)
      expect(finishOf(chunks).parts[0]).toEqual({
        type: 'reasoning',
        text: '',
        replay: { signature: 'msg-id' },
      })
    })

    it('maps refusal and length stop reasons', async () => {
      stubFetch(
        sseResponse(textStream('no', 'refusal')),
        sseResponse(textStream('long', 'max_tokens')),
      )
      expect(finishOf(await run(adapter)).reason).toBe('refusal')
      expect(finishOf(await run(adapter)).reason).toBe('length')
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
      expect(finishOf(chunks).reason).toBe('aborted')
    })
  })

  describe('errors', () => {
    it.each([
      [401, () => t('common.assistant.errors.auth', { status: 401 })],
      [404, () => t('common.assistant.errors.notFound')],
    ])('translates HTTP %i and keeps the upstream message', async (status, expected) => {
      stubFetch(errorResponse(status, 'upstream says no'))
      const finish = finishOf(await run(adapter))
      expect(finish.reason).toBe('error')
      expect(finish.error).toContain(expected())
      expect(finish.error).toContain('upstream says no')
    })

    it('does not retry a 400 it cannot correct', async () => {
      const requests = stubFetch(errorResponse(400, 'messages: field required'))
      const finish = finishOf(await run(adapter))
      expect(requests).toHaveLength(1)
      expect(finish.reason).toBe('error')
      expect(finish.error).toContain('messages: field required')
    })

    it('reports an address that answers with a web page', async () => {
      stubFetch(
        new Response('<!doctype html><title>Home</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )
      const finish = finishOf(await run(adapter))
      expect(finish.reason).toBe('error')
    })

    it('reports a network failure with the host name', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      )
      const finish = finishOf(await run(adapter))
      expect(finish.reason).toBe('error')
      expect(finish.error).toBe(t('common.assistant.errors.network', { host: 'llm.test' }))
    })
  })

  describe('learning endpoint behavior', () => {
    const PASSED_BACK =
      'The `content[].thinking` in the thinking mode must be passed back to the API.'
    const BOUND =
      'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.'

    const assistantBlocks = (request: CapturedRequest, index: number) =>
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

      const finish = finishOf(await run(adapter, { messages: history }))
      expect(finish.reason).toBe('stop')
      expect(finish.parts).toEqual([{ type: 'text', text: 'recovered' }])

      expect(assistantBlocks(requests[0]!, 1)).toEqual(['tool_use'])
      expect(assistantBlocks(requests[1]!, 1)).toEqual(['thinking', 'tool_use'])
      expect(requests[1]!.body.messages[1].content[0].thinking).toBe('')

      // 记住了：同一地址和模型不再先撞一次 400
      await run(adapter, { messages: history })
      expect(requests).toHaveLength(3)
      expect(assistantBlocks(requests[2]!, 1)).toEqual(['thinking', 'tool_use'])
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
      expect(assistantBlocks(requests[2]!, 1)).toEqual(['tool_use'])
    })

    it('narrows replay to the current turn when old signatures stop being valid', async () => {
      const requests = stubFetch(errorResponse(400, BOUND), sseResponse(textStream('ok')))
      const finish = finishOf(await run(adapter, { messages: TWO_TURNS }))

      expect(finish.reason).toBe('stop')
      expect(assistantBlocks(requests[0]!, 1)).toEqual(['thinking', 'tool_use'])
      expect(assistantBlocks(requests[1]!, 1)).toEqual(['tool_use'])
    })

    it('omits all thinking when even the current turn is rejected', async () => {
      const inTurn: ChatMessage[] = [
        { role: 'user', content: 'go' },
        { role: 'assistant', parts: [THINKING, USE_TOOL] },
        { role: 'tool', toolCallId: 'call_1', name: 'x', content: 'r' },
      ]
      const requests = stubFetch(
        errorResponse(400, BOUND),
        errorResponse(400, BOUND),
        sseResponse(textStream('ok')),
      )
      const finish = finishOf(await run(adapter, { messages: inTurn }))

      expect(finish.reason).toBe('stop')
      expect(assistantBlocks(requests[1]!, 1)).toEqual(['thinking', 'tool_use'])
      expect(assistantBlocks(requests[2]!, 1)).toEqual(['tool_use'])
    })

    it('falls back to a thinking budget when the endpoint rejects adaptive', async () => {
      const requests = stubFetch(
        errorResponse(400, "thinking.type: Input should be 'enabled' or 'disabled'"),
        sseResponse(textStream('ok')),
      )
      const finish = finishOf(await run(adapter))
      expect(finish.reason).toBe('stop')
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
      const finish = finishOf(await run(adapter))
      expect(requests).toHaveLength(2)
      expect(finish.reason).toBe('error')
      expect(finish.error).toContain('must be passed back')
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
      const finish = finishOf(await run(adapter))
      expect(requests).toHaveLength(1)
      expect(finish.reason).toBe('error')
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
      await expect(adapter.listModels(CONNECTION)).resolves.toEqual(['k3', 'deepseek-flash-latest'])
      expect(requests[0]!.url).toBe('/llm-relay/v1/models?limit=1000')
      expect(requests[0]!.headers.get('x-api-key')).toBe('sk-test')
    })

    it('throws a readable error', async () => {
      stubFetch(errorResponse(401, 'bad key'))
      await expect(adapter.listModels(CONNECTION)).rejects.toThrow('bad key')
    })
  })

  describe('probeVision', () => {
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
  const assistantContent = (messages: ChatMessage[], replay?: EndpointBehavior['replay']) =>
    (toModelMessages(messages, replay)[1] as { content: { type: string }[] }).content

  it('replays thinking in order, with its signature', () => {
    const content = assistantContent(TWO_TURNS) as any[]
    expect(content.map((c) => c.type)).toEqual(['reasoning', 'tool-call'])
    expect(content[0].providerOptions.anthropic.signature).toBe('sig-1')
  })

  it('keeps thinking text from endpoints that send no signature', () => {
    const content = assistantContent([
      { role: 'user', content: 'q' },
      { role: 'assistant', parts: [{ type: 'reasoning', text: 'unsigned plan' }, USE_TOOL] },
    ]) as any[]
    expect(content[0].text).toBe('unsigned plan')
    expect(content[0].providerOptions.anthropic.signature).toBeTruthy()
  })

  it('replays redacted thinking data', () => {
    const content = assistantContent([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        parts: [{ type: 'reasoning', text: '', replay: { redactedData: 'abc' } }, USE_TOOL],
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
      { role: 'assistant', parts: [THINKING, USE_TOOL] },
      { role: 'tool', toolCallId: 'call_1', name: 'x', content: 'r' },
    ]
    const messages = toModelMessages(history, 'current-turn') as any[]
    expect(messages[1].content.map((c: any) => c.type)).toEqual(['tool-call'])
    expect(messages[5].content.map((c: any) => c.type)).toEqual(['reasoning', 'tool-call'])
  })

  it('omit drops all thinking', () => {
    expect(assistantContent(TWO_TURNS, 'omit').map((c) => c.type)).toEqual(['tool-call'])
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

describe('anthropicAdapterPlugin', () => {
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
    const requests = stubFetch(sseResponse(textStream('hello')))

    const ctx = new Context()
    await ctx.plugin(connectionProvider)
    await ctx.plugin(llmProvider)
    await ctx.plugin(anthropicAdapterPlugin)

    const chunks = await collect(
      ctx.llm.stream({ messages: [{ role: 'user', content: 'hi' }] }, new AbortController().signal),
    )

    expect(finishOf(chunks).parts).toEqual([{ type: 'text', text: 'hello' }])
    expect(requests[0]!.headers.get('x-api-key')).toBe('sk-x')
    expect(requests[0]!.body.model).toBe('m')

    vi.unstubAllGlobals()
    localStorage.removeItem('assistant_connection')
  })
})
