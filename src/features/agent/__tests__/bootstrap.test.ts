import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, TOOL_RESULT_CHARS_DEFAULT } from '../plugins/tools'
import { SystemPrompt } from '../plugins/system-prompt'
import { SkillsRegistry } from '../plugins/skill'
import * as skillBundled from '../plugins/skill-bundled'
import * as toolSkill from '../plugins/tool-skill'
import * as toolArchive from '../plugins/tool-archive'
import { whenAgentReady } from '../bootstrap'

describe('agent bootstrap (production wiring)', () => {
  it('wires the connection, the adapter plugin and the agent loop through the real entry point', async () => {
    localStorage.setItem(
      'assistant_connection',
      JSON.stringify({
        endpoint: 'anthropic',
        baseUrl: 'https://llm.test',
        apiKey: 'k',
        model: 'm',
      }),
    )
    const ctx = await whenAgentReady()

    expect(ctx.connection.current()?.model).toBe('m')
    expect(typeof ctx.agent.send).toBe('function')
    expect(ctx.models.snapshot().models).toEqual([])
    // 适配器插件真的注册上了：请求能路由到它（这里只让它撞上桩掉的 fetch）
    const fetchStub = vi.fn(async () => new Response('{"data":[{"id":"k3"}]}', { status: 200 }))
    vi.stubGlobal('fetch', fetchStub)
    await expect(ctx.llm.listModels(ctx.connection.current()!)).resolves.toEqual([{ id: 'k3' }])
    expect(fetchStub).toHaveBeenCalledOnce()

    vi.unstubAllGlobals()
    localStorage.removeItem('assistant_connection')
  })

  it('skill tool returns the FULL SKILL.md body, not truncated to TOOL_RESULT_CHARS', async () => {
    // SKILL.md 是完整的工作流文档，被截断后模型读不到后半段的流程和输出模板
    const ctx = new Context()
    ctx.plugin(SystemPrompt)
    ctx.plugin(ToolRuntime)
    ctx.plugin(SkillsRegistry)
    ctx.plugin(skillBundled)
    ctx.plugin(toolSkill)
    await new Promise((r) => setTimeout(r, 10))

    const result = await ctx.tools.execute({
      callId: 'c1',
      name: 'skill',
      arguments: { name: 'msi-analysis' },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    const full = await ctx.skills.load('msi-analysis')
    expect(full.length).toBeGreaterThan(TOOL_RESULT_CHARS_DEFAULT) // 前置：该技能确实超过默认截断线
    expect(result.content).toBe(full)
    // 未被管线截断 → 不产生 fullContent（无重复存档）
    expect(result.fullContent).toBeUndefined()
  })

  it('read_archived_result pages long archives via offset continuation', async () => {
    const longText = 'A'.repeat(20000)
    const archiveSession = { storage: { getArtifact: async () => new Blob([longText]) } } as never
    const ctx = new Context()
    ctx.plugin(SystemPrompt)
    ctx.plugin(ToolRuntime)
    ctx.plugin(toolArchive)
    await new Promise((r) => setTimeout(r, 10))

    // 第一窗口：内容 + 续读指针
    const first = await ctx.tools.execute({
      callId: 'c1',
      name: 'read_archived_result',
      arguments: { archiveId: 'call_long' },
      session: archiveSession,
      signal: new AbortController().signal,
    })
    expect(first.isError).toBe(false)
    expect(first.content).toContain('A'.repeat(100))
    const nextOffset = Number(/nextOffset=(\d+)/.exec(first.content)![1])
    expect(nextOffset).toBeGreaterThan(11000)
    expect(first.content.length).toBeLessThanOrEqual(12000)
    expect(first.content).not.toContain('end of archived result')

    // 续读第二窗口直到结尾标记
    const second = await ctx.tools.execute({
      callId: 'c2',
      name: 'read_archived_result',
      arguments: { archiveId: 'call_long', offset: nextOffset },
      session: archiveSession,
      signal: new AbortController().signal,
    })
    expect(second.isError).toBe(false)
    expect(second.content).toContain('end of archived result')
    const firstBody = first.content.split('\n[')[0]!
    const secondBody = second.content.split(']\n')[1]!.split('\n[')[0]!
    expect(firstBody + secondBody).toBe(longText)

    vi.unstubAllGlobals()
  })
})
