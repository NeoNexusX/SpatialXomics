import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { searchExa } from '../exa'
import * as plugin from '../index'
import { ToolRuntime } from '../../tools'
import { SystemPrompt } from '../../system-prompt'

const signal = () => new AbortController().signal
const contexts: Context[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function mockReply(result: unknown, sse = false) {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const { id } = JSON.parse(init!.body as string)
    const reply = { jsonrpc: '2.0', id, result }
    return sse
      ? new Response(`event: message\ndata: ${JSON.stringify(reply)}\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      : Response.json(reply)
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

it('makes one Exa search request without a key and preserves citation text', async () => {
  const fetcher = mockReply({
    content: [
      {
        type: 'text',
        text: 'Title: MSI guide\nURL: https://example.org/msi\nHighlights: Guidance',
      },
    ],
  })
  const controller = new AbortController()
  const text = await searchExa('  official MSI guide  ', undefined, controller.signal)
  expect(text).toContain('https://example.org/msi')
  expect(text).toContain('Guidance')
  expect(fetcher).toHaveBeenCalledTimes(1)
  const [url, init] = fetcher.mock.calls[0]!
  expect(url).toBe('https://mcp.exa.ai/mcp')
  expect(init).toMatchObject({ method: 'POST', signal: controller.signal, credentials: 'omit' })
  expect((init!.headers as Headers).get('x-api-key')).toBeNull()
  expect(JSON.parse(init!.body as string)).toMatchObject({
    method: 'tools/call',
    params: { name: 'web_search_exa', arguments: { query: 'official MSI guide', numResults: 5 } },
  })
})

it('supports optional Exa credentials without putting them in the URL or arguments', async () => {
  const fetcher = mockReply({ content: [{ type: 'text', text: 'results' }] })
  await searchExa('q', 99, signal(), ' exa-user-key ')
  const [url, init] = fetcher.mock.calls[0]!
  expect((init!.headers as Headers).get('x-api-key')).toBe('exa-user-key')
  expect(url).not.toContain('exa-user-key')
  expect(init!.body).not.toContain('exa-user-key')
  expect(JSON.parse(init!.body as string).params.arguments.numResults).toBe(10)
})

it('reads SSE split over arbitrary chunks and closes the stream immediately after the reply', async () => {
  const cancel = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { id } = JSON.parse(init!.body as string)
      const text = `: keepalive\r\n\r\nevent: message\r\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '中文 sources' }] } })}\r\n\r\n`
      const bytes = new TextEncoder().encode(text)
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }),
  )
  expect(await searchExa('q', 3, signal())).toContain('中文 sources')
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('prefers structured results, deduplicates sources and rejects non-web URLs', async () => {
  mockReply({
    content: [{ type: 'text', text: 'fallback' }],
    structuredContent: {
      results: [
        {
          title: 'Official guide',
          url: 'https://example.org/guide',
          publishedDate: '2026-01-01',
          highlights: ['Source excerpt'],
        },
        { title: 'duplicate', url: 'https://example.org/guide' },
        { title: 'unsafe', url: 'javascript:alert(1)' },
      ],
    },
  })
  const text = await searchExa('q', 3, signal())
  expect(text).toContain('Published: 2026-01-01')
  expect(text).toContain('Source excerpt')
  expect(text).not.toContain('fallback')
  expect(text).not.toContain('javascript:')
  expect(text.match(/URL: https:\/\/example.org\/guide/g)).toHaveLength(1)
})

it.each([429, 401, 403, 502])(
  'reports HTTP %s as a failure rather than empty results',
  async (status) => {
    const fetcher = vi.fn(async () => new Response('upstream error', { status }))
    vi.stubGlobal('fetch', fetcher)
    await expect(searchExa('q', 3, signal())).rejects.toThrow(`HTTP ${status}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)

it('propagates MCP tool errors', async () => {
  mockReply({ isError: true, content: [{ type: 'text', text: 'Quota exhausted' }] }, true)
  await expect(searchExa('q', 3, signal())).rejects.toThrow('Quota exhausted')
})

it('propagates JSON-RPC errors and rejects mismatched responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { id } = JSON.parse(init!.body as string)
      return Response.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: 'Not available' },
      })
    }),
  )
  await expect(searchExa('q', 3, signal())).rejects.toThrow('Not available')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ jsonrpc: '2.0', id: 'unrelated', result: {} })),
  )
  await expect(searchExa('q', 3, signal())).rejects.toThrow('no matching')
})

it('does not make requests for invalid queries or an already cancelled call', async () => {
  const fetcher = mockReply({})
  for (const query of ['', '   ', 'q'.repeat(1001)])
    await expect(searchExa(query, 3, signal())).rejects.toThrow('1–1000')
  const controller = new AbortController()
  controller.abort()
  await expect(searchExa('q', 3, controller.signal)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

it('preserves the abort reason for an in-flight network request', async () => {
  const controller = new AbortController()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {
            once: true,
          })
        }),
    ),
  )
  const pending = searchExa('q', 3, controller.signal)
  const reason = new Error('stopped by user')
  controller.abort(reason)
  await expect(pending).rejects.toBe(reason)
})

it('rejects malformed and oversized provider responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('<html>challenge</html>')),
  )
  await expect(searchExa('q', 3, signal())).rejects.toThrow('malformed JSON')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('x'.repeat(1_000_001))),
  )
  await expect(searchExa('q', 3, signal())).rejects.toThrow('size limit')
})

it('registers a callable tool with only query and result-count parameters and unloads it', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = ctx.plugin(plugin)
  await fiber
  const tool = () => ctx.tools.list().find((item) => item.name === 'web_search')
  expect(Object.keys(tool()!.parameters)).toEqual(['query', 'maxResults'])
  mockReply({ content: [{ type: 'text', text: 'URL: https://example.org' }] })
  const result = await ctx.tools.execute({
    name: 'web_search',
    callId: 'a',
    arguments: { query: 'official MSI methods' },
    signal: signal(),
  })
  expect(result).toMatchObject({
    isError: false,
    content: expect.stringContaining('https://example.org'),
  })
  await fiber.dispose()
  expect(tool()).toBeUndefined()
})

it('cancels an open SSE body when the tool is stopped', async () => {
  const controller = new AbortController()
  const cancel = vi.fn()
  const fetcher = vi.fn(
    async () =>
      new Response(new ReadableStream({ cancel }), {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const pending = searchExa('q', 3, controller.signal)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(cancel).toHaveBeenCalledOnce()
})

it('preserves provider notices when rendering structured source evidence', async () => {
  mockReply({
    structuredContent: {
      notices: [{ message: 'Query restriction was relaxed' }],
      results: [{ url: 'https://example.org', title: 'Source', highlights: ['text'] }],
    },
  })
  expect(await searchExa('q', 3, signal())).toContain('Note: Query restriction was relaxed')
})

it('feeds Exa results back to the model through the production agent tool loop', async () => {
  const { createLockedAgent, text, toolCall } = await import('../../../__tests__/lockedAgent')
  const { setAgentDataset } = await import('../../../bridge/datasetBinding')
  localStorage.setItem(
    'assistant_connection',
    JSON.stringify({
      endpoint: 'anthropic',
      baseUrl: 'https://llm.test',
      apiKey: 'test-key',
      model: 'm',
    }),
  )
  setAgentDataset('web-search-round-trip', true)
  const harness = await createLockedAgent(
    [
      toolCall('web_search', { query: 'official MALDI imaging methods', maxResults: 3 }),
      text('Answer based on source'),
    ],
    { fullTools: true, noScriptTools: true },
  )
  try {
    const fetcher = mockReply({
      content: [
        {
          type: 'text',
          text: 'Title: Methods\nURL: https://example.org/methods\nHighlights: Imaging method evidence.',
        },
      ],
    })
    await harness.agent.send('Find official MALDI methods')
    await harness.agent.whenIdle()
    expect(harness.calls).toHaveLength(2)
    expect(harness.calls[0]!.tools?.some((tool) => tool.name === 'web_search')).toBe(true)
    expect(harness.calls[1]!.messages.find((message) => message.role === 'tool')).toMatchObject({
      name: 'web_search',
      content: expect.stringContaining('https://example.org/methods'),
    })
    expect(fetcher).toHaveBeenCalledOnce()
  } finally {
    await harness.dispose()
    localStorage.clear()
  }
})
