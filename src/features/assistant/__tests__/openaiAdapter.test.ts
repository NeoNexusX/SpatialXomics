import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  foldToolMessagesToUser,
  inlineToolCalls,
  openaiAdapter,
  rejectsImages,
  rejectsToolRole,
  resetStrictCompatForTests,
  setOnImagesRejected,
  stripImages,
  strictToolCallsError,
} from '../agentservices/openaiAdapter'
import { clearUserLlmConfig, saveUserLlmConfig } from '../agentconfig/userLlmConfig'
import type { ChatMessage, StreamChunk, ToolSchema } from '../agenttypes/assistant'

/**
 * openaiAdapter 单元测试：
 * - rejectsToolRole / strictToolCallsError / foldToolMessagesToUser / inlineToolCalls
 *   纯函数（严格端点 400 自动兼容）
 * - stream() 对严格端点 400 的全量折叠重试、会话级记忆与普通 400 的透传
 */

/** 带 role:"tool" 回喂消息的最小会话（工具循环第二轮的典型形态） */
function toolTurnMessages(): ChatMessage[] {
  return [
    { role: 'system', content: 'sys' },
    { role: 'user', content: '分析一下' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', name: 'get_annotation_top', arguments: '{}' }],
    },
    { role: 'tool', content: '[]', tool_call_id: 'call_1', name: 'get_annotation_top' },
  ]
}

/** 收集流式产出的全部分块 */
async function collect(iter: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of iter) out.push(chunk)
  return out
}

/** 从 fetch mock 的某次调用里解出已上行的请求体 */
function sentBody(mock: ReturnType<typeof vi.fn>, call: number): {
  messages: ChatMessage[]
  tools?: unknown[]
  tool_choice?: unknown
} {
  const init = mock.mock.calls[call]![1] as RequestInit
  return JSON.parse(init.body as string)
}

/** 上行消息里是否还有结构化工具信息（role:"tool" 或 assistant.tool_calls） */
function hasStructuredTraffic(messages: ChatMessage[]): boolean {
  return messages.some((m) => m.role === 'tool' || Array.isArray(m.tool_calls))
}

describe('rejectsToolRole', () => {
  it('matches pydantic-style enum errors', () => {
    expect(
      rejectsToolRole(
        `[{"type":"enum","loc":["body","messages",3,"role"],"msg":"Input should be 'system', 'user' or 'assistant'"}]`,
      ),
    ).toBe(true)
  })

  it('matches the no-quote / supported-roles / must-be-one-of phrasings', () => {
    expect(
      rejectsToolRole('invalid request body: Input should be user assistant or system'),
    ).toBe(true)
    expect(rejectsToolRole('role must be one of: system, user, assistant')).toBe(true)
    expect(rejectsToolRole('Supported roles: system, user, assistant')).toBe(true)
  })

  it('does not match bodies that list tool as valid, or unrelated 400s', () => {
    expect(rejectsToolRole("Input should be 'system', 'user', 'assistant' or 'tool'")).toBe(false)
    expect(
      rejectsToolRole(
        JSON.stringify({ error: { message: "Invalid value for 'tool_choice': 'sometimes'" } }),
      ),
    ).toBe(false)
    expect(rejectsToolRole('{"error":{"message":"model not found"}}')).toBe(false)
  })
})

describe('strictToolCallsError', () => {
  it('matches the missing-name errors emitted by converting endpoints', () => {
    // 用户实测的报错原文（OpenAI→Claude/Gemini 转换层把 tool_calls 翻成 content 块丢 name）
    expect(
      strictToolCallsError(
        '400 the request failed because it is missing ***.content[i].name parameter',
      ),
    ).toBe(true)
    // pydantic v2 的 Field required 措辞
    expect(
      strictToolCallsError(
        JSON.stringify({ error: { message: 'messages[2].content[0].name: Field required' } }),
      ),
    ).toBe(true)
    expect(strictToolCallsError('missing required parameter: content.1.name')).toBe(true)
  })

  it('matches error paths that land on tool_calls directly', () => {
    // 用户实测的第四种 400：错误路径落在 tool_calls 上而非 content 上
    expect(
      strictToolCallsError(
        'Invalid request body: messages.2.tool_calls.0.function.name: Field required',
      ),
    ).toBe(true)
    expect(
      strictToolCallsError(
        'Invalid request body: messages.2.tool_calls.0.name: Extra inputs are not permitted',
      ),
    ).toBe(true)
  })

  it('does not match role-enum or unrelated errors', () => {
    expect(strictToolCallsError("Input should be 'system', 'user' or 'assistant'")).toBe(false)
    expect(strictToolCallsError('Invalid value for tool_choice')).toBe(false)
    // content 缺失但没有 name——不是 tool_calls 转换问题
    expect(strictToolCallsError('messages[1].content: Field required')).toBe(false)
    // tools 数组的 name 报错：是工具定义问题，折叠历史解决不了
    expect(strictToolCallsError('Invalid request body: tools.3.function.name: Field required')).toBe(false)
  })
})

describe('foldToolMessagesToUser', () => {
  it('wraps tool results in a user message with tool_call_id and name', () => {
    const source = toolTurnMessages()
    const folded = foldToolMessagesToUser(source)
    expect(folded).toHaveLength(4)
    // 前三条原样保留（assistant.tool_calls 不动，模型仍能对应回自己的调用）
    expect(folded[0]).toEqual(source[0])
    expect(folded[2]!.tool_calls).toEqual(source[2]!.tool_calls)
    // tool → user，内容带包装标签
    expect(folded[3]!.role).toBe('user')
    expect(folded[3]!.content).toContain(
      '<tool_response tool_call_id="call_1" name="get_annotation_top">',
    )
    expect(folded[3]!.content).toContain('[]')
    expect(folded[3]!.content).toContain('</tool_response>')
  })

  it('omits the name attribute when absent', () => {
    const folded = foldToolMessagesToUser([{ role: 'tool', content: 'x', tool_call_id: 'call_9' }])
    expect(folded[0]!.content).toContain('<tool_response tool_call_id="call_9">')
  })
})

describe('inlineToolCalls', () => {
  it('folds assistant tool_calls into inline <tool_call> text and drops the field', () => {
    const folded = inlineToolCalls(toolTurnMessages())
    const assistant = folded[2]!
    expect(assistant.role).toBe('assistant')
    expect(assistant.tool_calls).toBeUndefined()
    expect(assistant.content).toBe(
      '<tool_call id="call_1" name="get_annotation_top">{}</tool_call>',
    )
  })

  it('appends after existing text content and leaves plain messages untouched', () => {
    const folded = inlineToolCalls([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'thinking',
        tool_calls: [{ id: 'c2', name: 't', arguments: '{"a":1}' }],
      },
    ])
    expect(folded[0]).toEqual({ role: 'user', content: 'hi' })
    expect(folded[1]!.content).toBe('thinking\n<tool_call id="c2" name="t">{"a":1}</tool_call>')
  })
})

describe('openaiAdapter.stream strict-endpoint 400 retry', () => {
  beforeEach(() => {
    // 会话级严格端点开关跨用例泄漏会让「不重试」用例误重试——每个用例前归零
    resetStrictCompatForTests()
    // seed 用户自配 model：resolveModel 在用户 model 非空时短路返回，
    // 不触发 getConfig()（测试环境没有 bootstrap 过的 config，调用会抛错）
    saveUserLlmConfig({
      baseUrl: 'http://localhost:4567/v1',
      apiKey: 'test-key',
      model: 'test-model',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearUserLlmConfig()
  })

  /** 严格端点 mock：上行还有结构化工具信息就 400（errBody），折叠后回 200 SSE */
  function strictEndpointMock(errBody: string) {
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
    return vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string) as { messages: ChatMessage[] }
      if (hasStructuredTraffic(body.messages)) {
        return new Response(errBody, {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
  }

  /** 第五种 400：网关把校验失败的路径整体打码，看不出是 tools 定义还是历史 tool_calls */
  const MASKED_NAME_400 = JSON.stringify({
    error: { message: 'Invalid request body:***.***.***.name' },
  })

  /** 弃用 tools 的梯子二级需要真实 tools 数组上行 */
  const testTools: ToolSchema[] = [
    {
      name: 'get_annotation_top',
      description: 'top annotations',
      parameters: { type: 'object', properties: {} },
    },
  ]

  it('fully folds tool traffic and retries once on a strict-role 400', async () => {
    // 按上行消息里是否还有结构化工具信息区分首发/重试：首发 400，重试 200 SSE
    const fetchMock = strictEndpointMock(
      JSON.stringify({
        error: {
          message: "【400】【】invalid request body: Input should be 'system', 'user' or 'assistant'",
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const chunks = await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages() },
        new AbortController().signal,
      ),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // 第一次携带 role:"tool" 与结构化 tool_calls；assistant content null → 空串
    // （严格端点要求 content 必须是字符串）
    expect(sentBody(fetchMock, 0).messages[3]!.role).toBe('tool')
    expect(sentBody(fetchMock, 0).messages[2]!.content).toBe('')
    // 重试：tool → user 包装标签 + assistant.tool_calls → 内联文本（结构全拆掉）
    const retried = sentBody(fetchMock, 1).messages
    expect(retried[3]!.role).toBe('user')
    expect(retried[3]!.content).toContain('<tool_response')
    expect(retried[2]!.tool_calls).toBeUndefined()
    expect(retried[2]!.content).toContain('<tool_call id="call_1" name="get_annotation_top">')
    // 重试的流式内容正常送达
    expect(chunks.some((c) => c.type === 'text-delta' && c.text === 'ok')).toBe(true)
    expect(chunks[chunks.length - 1]).toMatchObject({ type: 'finish', reason: 'stop' })
  })

  it('fully folds and retries once on a missing-name (tool_calls conversion) 400', async () => {
    // 用户实测的第三种 400：端点把 assistant.tool_calls 翻成 content 块时丢 name
    const fetchMock = strictEndpointMock(
      '400 the request failed because it is missing ***.content[i].name parameter',
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const chunks = await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages() },
        new AbortController().signal,
      ),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retried = sentBody(fetchMock, 1).messages
    expect(hasStructuredTraffic(retried)).toBe(false)
    expect(chunks.some((c) => c.type === 'text-delta' && c.text === 'ok')).toBe(true)
  })

  it('serializes history tool_calls into the OpenAI nested wire form', async () => {
    // 历史里是扁平 ToolCall；wire 必须是 {id, type:"function", function:{…}}——
    // 扁平直发会被 pydantic 严格端点按 messages[i].tool_calls[j](*.function).name 400
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
    const fetchMock = vi.fn(async () =>
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages() },
        new AbortController().signal,
      ),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = sentBody(fetchMock, 0).messages[2] as {
      tool_calls?: Array<Record<string, unknown>>
    }
    expect(sent.tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_annotation_top', arguments: '{}' },
      },
    ])
  })

  it('fully folds and retries once on a tool_calls-path name 400', async () => {
    // 用户实测的第四种 400：错误路径落在 tool_calls 上——wire 已规范嵌套仍被拒的
    // 端点，只能靠全量折叠内联文本兜底
    const fetchMock = strictEndpointMock(
      JSON.stringify({
        error: {
          message: 'Invalid request body: messages.2.tool_calls.0.function.name: Field required',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const chunks = await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages() },
        new AbortController().signal,
      ),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retried = sentBody(fetchMock, 1).messages
    expect(hasStructuredTraffic(retried)).toBe(false)
    expect(chunks.some((c) => c.type === 'text-delta' && c.text === 'ok')).toBe(true)
  })

  it('remembers the strict endpoint for the whole page session (single pre-folded fetch)', async () => {
    const fetchMock = strictEndpointMock(
      JSON.stringify({
        error: { message: "Input should be 'system', 'user' or 'assistant'" },
      }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    // 第一次：400 → 全量折叠重试成功（2 次请求，置位会话级开关）
    await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages() },
        new AbortController().signal,
      ),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // 第二次：同页面会话，直接以折叠形态首发——不再 400 探测，仅 1 次请求
    await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages() },
        new AbortController().signal,
      ),
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const third = sentBody(fetchMock, 2).messages
    expect(hasStructuredTraffic(third)).toBe(false)
    expect(third[3]!.role).toBe('user')
    expect(third[3]!.content).toContain('<tool_response')
    expect(third[2]!.content).toContain('<tool_call id="call_1"')
  })

  it('does not retry an unrelated 400 and surfaces the upstream message', async () => {
    // 无关 400 现在也经 surface400 透传——顺手静音并验证诊断日志
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: 'Invalid value for tool_choice' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const chunks = await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages() },
        new AbortController().signal,
      ),
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const finish = chunks[chunks.length - 1] as { type: string; reason?: string; error?: string }
    expect(finish.type).toBe('finish')
    expect(finish.reason).toBe('error')
    expect(finish.error).toContain('HTTP 400')
    expect(finish.error).toContain('tool_choice')
    expect(errorSpy).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })

  it('escalates to a tools-less retry when folding does not clear a masked name 400', async () => {
    // 第五种形态（路径被打码）折叠后仍 400：拒的多半是 tools 数组本身——弃用
    // tools/tool_choice 再试一次，函数调用降级为纯对话
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string) as { tools?: unknown[] }
      if ((body.tools?.length ?? 0) > 0) {
        return new Response(MASKED_NAME_400, {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const chunks = await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages(), tools: testTools },
        new AbortController().signal,
      ),
    )

    // 首发（结构化历史）→ 折叠重试（无结构化、仍带 tools）→ 弃 tools 重试
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sentBody(fetchMock, 1).tools).toBeDefined()
    expect(sentBody(fetchMock, 2).tools).toBeUndefined()
    expect(sentBody(fetchMock, 2).tool_choice).toBeUndefined()
    expect(chunks.some((c) => c.type === 'text-delta' && c.text === 'ok')).toBe(true)
    expect(warnSpy).toHaveBeenCalledOnce()
    warnSpy.mockRestore()
  })

  it('strips tools without folding when a masked 400 arrives on text-only history', async () => {
    // 首轮（历史无结构化工具信息）就打码 400：无处折叠，直接进梯子二级弃 tools
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string) as { tools?: unknown[] }
      if ((body.tools?.length ?? 0) > 0) {
        return new Response(MASKED_NAME_400, {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const chunks = await collect(
      openaiAdapter.stream(
        {
          model: 'test-model',
          messages: [{ role: 'user', content: 'hi' }],
          tools: testTools,
        },
        new AbortController().signal,
      ),
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sentBody(fetchMock, 0).tools).toBeDefined()
    expect(sentBody(fetchMock, 1).tools).toBeUndefined()
    expect(chunks.some((c) => c.type === 'text-delta' && c.text === 'ok')).toBe(true)
    warnSpy.mockRestore()
  })

  it('remembers tools-blocked for the whole page session (folded and tools-less first shot)', async () => {
    // 第一次：结构化历史 + tools → 折叠仍 400 → 弃 tools 成功（3 次请求，置位
    // 两个会话开关）；第二次：直接以「折叠 + 无 tools」首发——1 次请求即 200
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string) as { tools?: unknown[] }
      if ((body.tools?.length ?? 0) > 0) {
        return new Response(MASKED_NAME_400, {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages(), tools: testTools },
        new AbortController().signal,
      ),
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages(), tools: testTools },
        new AbortController().signal,
      ),
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const last = sentBody(fetchMock, 3)
    expect(last.tools).toBeUndefined()
    expect(hasStructuredTraffic(last.messages)).toBe(false)
    warnSpy.mockRestore()
  })

  it('surfaces the 400 with a diagnostic console log when both ladder levels are exhausted', async () => {
    // 连弃 tools 后仍打码 400：错误透传给用户，同时把上游错误与被拒请求体
    // 打进 console，供下次定位真凶字段
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () =>
      new Response(MASKED_NAME_400, {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const chunks = await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: toolTurnMessages(), tools: testTools },
        new AbortController().signal,
      ),
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const finish = chunks[chunks.length - 1] as { type: string; reason?: string; error?: string }
    expect(finish.type).toBe('finish')
    expect(finish.reason).toBe('error')
    expect(finish.error).toContain('HTTP 400')
    expect(errorSpy).toHaveBeenCalledOnce()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

// ---- 多模态图片：拒图 400 的识别与剥图重试 ----

describe('rejectsImages', () => {
  it('matches common non-vision-model image rejection phrasings', () => {
    expect(
      rejectsImages(
        JSON.stringify({ error: { message: 'Invalid content type: image_url is not supported by this model' } }),
      ),
    ).toBe(true)
    expect(rejectsImages('this model does not support image input')).toBe(true)
    expect(rejectsImages('multimodal input is not supported for model deepseek-chat')).toBe(true)
    expect(rejectsImages('image content is only supported by vision models')).toBe(true)
  })

  it('does not match unrelated 400s that merely contain common words', () => {
    expect(rejectsImages('{"error":{"message":"model not found"}}')).toBe(false)
    expect(rejectsImages('Invalid value for temperature')).toBe(false)
    // "image" 出现但不带不支持/非法语义（如字段名拼写错误的普通报错）不误伤
    expect(rejectsImages('messages.1.content.2.text: Field required')).toBe(false)
  })
})

describe('stripImages', () => {
  it('replaces images with an omission note and keeps the text', () => {
    const stripped = stripImages([
      { role: 'user', content: 'what is this', images: ['data:image/png;base64,AAA'] },
      { role: 'assistant', content: 'a chart' },
      { role: 'user', content: 'plain', images: ['data:image/png;base64,BBB', 'data:image/png;base64,CCC'] },
    ])
    expect(stripped[0]!.images).toBeUndefined()
    expect(stripped[0]!.content).toBe('what is this\n[image omitted]')
    expect(stripped[1]).toEqual({ role: 'assistant', content: 'a chart' })
    expect(stripped[2]!.content).toBe('plain\n[2 images omitted]')
  })

  it('handles image-only messages (empty content becomes the note)', () => {
    const stripped = stripImages([{ role: 'user', content: '', images: ['data:image/png;base64,AAA'] }])
    expect(stripped[0]!.images).toBeUndefined()
    expect(stripped[0]!.content).toBe('[image omitted]')
  })
})

describe('openaiAdapter.stream image-rejection retry', () => {
  beforeEach(() => {
    resetStrictCompatForTests()
    saveUserLlmConfig({
      baseUrl: 'http://localhost:4567/v1',
      apiKey: 'test-key',
      model: 'test-model',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearUserLlmConfig()
    setOnImagesRejected(null)
  })

  const IMAGE_400 = JSON.stringify({
    error: { message: 'Invalid content type: image_url is not supported by this model' },
  })

  /** 带图 user 消息 */
  function imageMessages(): ChatMessage[] {
    return [
      { role: 'user', content: 'describe', images: ['data:image/png;base64,AAAA'] },
    ]
  }

  it('strips images and retries once when the model rejects image parts', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rejectedCb = vi.fn()
    setOnImagesRejected(rejectedCb)
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        messages: Array<{ content?: unknown }>
      }
      const hasImagePart = body.messages.some(
        (m) => Array.isArray(m.content) && (m.content as Array<{ type?: string }>).some((p) => p.type === 'image_url'),
      )
      if (hasImagePart) {
        return new Response(IMAGE_400, { status: 400, headers: { 'content-type': 'application/json' } })
      }
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const chunks = await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: imageMessages() },
        new AbortController().signal,
      ),
    )

    // 首发（带图 400）→ 剥图重试（200）
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retried = sentBody(fetchMock, 1).messages[0] as { content: string }
    expect(retried.content).toContain('describe')
    expect(retried.content).toContain('[image omitted]')
    expect(chunks.some((c) => c.type === 'text-delta' && c.text === 'ok')).toBe(true)
    // 拒图回调已通知（agentLoop 借此清理持久历史）
    expect(rejectedCb).toHaveBeenCalledOnce()
    warnSpy.mockRestore()
  })

  it('remembers the rejection for the page session and notifies the callback once', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rejectedCb = vi.fn()
    setOnImagesRejected(rejectedCb)
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string) as {
        messages: Array<{ content?: unknown }>
      }
      const hasImagePart = body.messages.some(
        (m) => Array.isArray(m.content) && (m.content as Array<{ type?: string }>).some((p) => p.type === 'image_url'),
      )
      if (hasImagePart) {
        return new Response(IMAGE_400, { status: 400, headers: { 'content-type': 'application/json' } })
      }
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    // 第一次：400 → 剥图重试成功（回调一次）
    await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: imageMessages() },
        new AbortController().signal,
      ),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(rejectedCb).toHaveBeenCalledTimes(1)

    // 第二次：会话开关已置位，直接剥图首发——1 次请求即 200，回调不再重复
    await collect(
      openaiAdapter.stream(
        { model: 'test-model', messages: imageMessages() },
        new AbortController().signal,
      ),
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(rejectedCb).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })
})
