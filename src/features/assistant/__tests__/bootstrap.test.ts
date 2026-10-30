import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { llmProvider } from '../providers/llm'
import { toolsProvider } from '../providers/tools'
import { skillsProvider } from '../providers/skills'
import { frontendContextTools } from '../tools/frontendContextTools'
import { backendApiTools } from '../tools/backendApiTools'
import { knowledgeTools } from '../tools/knowledgeTools'
import { bioTools } from '../tools/bioTools'
import { literatureTools } from '../tools/literatureTools'
import { archiveTools } from '../tools/archiveTools'

/**
 * 生产接线回归测试：完整复刻 plugins/index.ts 的加载方式（不 await，
 * 与浏览器里的真实调用一致）。
 *
 * 背景：cordis 4 的属性解析要求 fiber 内声明过 inject 才能访问兄弟服务，
 * 否则插件 fiber **静默失败**（不抛错、无日志）——工具一个都注册不上。
 * agentLoop.test.ts 只从根 context 注册测试工具（根上下文不受 inject 限制），
 * 检测不到这条路径；工具插件曾因此全员失效而测试全绿。
 */
describe('assistant bootstrap (production wiring)', () => {
  it('registers all tools when plugins load the way the browser loads them', async () => {
    const ctx = new Context()
    ctx.plugin(llmProvider)
    ctx.plugin(toolsProvider)
    ctx.plugin(skillsProvider)
    ctx.plugin(frontendContextTools)
    ctx.plugin(backendApiTools)
    ctx.plugin(knowledgeTools)
    ctx.plugin(bioTools)
    ctx.plugin(literatureTools)
    ctx.plugin(archiveTools)
    // 注意：全部不 await——静默失败的 fiber 只有这条路径能暴露

    // 等待 fiber 激活链（微任务级联 + 一个宏任务兜底）完成
    await new Promise((r) => setTimeout(r, 10))

    const names = ctx.tools.schemas().map((s) => s.name)
    // 七个工具插件各自的代表性成员（9+1 + 5 + 5 + 2 + 1 + 3 + 1 = 26 个，已移除
    // 碎片证据 spectral_library_search）。read_archived_result 必须在列：agentLoop
    // 持续往历史里写"call read_archived_result(id)"存根，该工具一旦静默失效，被
    // 截断的结果就永远取不回（且无其他测试加载 archiveTools）
    expect(names).toContain('get_page_state')
    expect(names).toContain('get_annotation_detail')
    expect(names).toContain('skill')
    expect(names).toContain('list_files')
    expect(names).toContain('get_user_quota')
    expect(names).toContain('pubmed_search')
    expect(names).toContain('europepmc_search')
    expect(names).toContain('library_mass_search')
    expect(names).toContain('hmdb_lookup')
    expect(names).toContain('kegg_pathway_lookup')
    expect(names).toContain('pathway_enrichment')
    expect(names).toContain('read_archived_result')
    expect(names).not.toContain('spectral_library_search')
    expect(names.length).toBeGreaterThanOrEqual(19)
  })

  it('exposes the bundled skills catalog without waiting for a first skill load', async () => {
    const ctx = new Context()
    ctx.plugin(skillsProvider)
    await new Promise((r) => setTimeout(r, 10))

    // 目录必须在无任何前置 load() 的情况下就绪：系统提示的
    // "Available Skills" 段依赖 catalog()，懒加载 + 无启动初始化 = 永远为空
    const catalog = ctx.skills.catalog()
    expect(catalog.map((s) => s.name)).toEqual(
      expect.arrayContaining(['msi-analysis', 'ion-image-interpretation']),
    )
  })

  it('skill tool returns the FULL SKILL.md body, not truncated to TOOL_RESULT_CHARS', async () => {
    // 回归：skill 正文曾被 ToolRuntime 全局截断到 2000 字符——SKILL.md 是
    // 3k-10k 字符的工作流文档，模型反复加载拿到的永远是同一份半截文本，
    // 按模板执行的分析流程（如 annotation-review）必然烂尾
    const ctx = new Context()
    ctx.plugin(toolsProvider)
    ctx.plugin(skillsProvider)
    ctx.plugin(frontendContextTools)
    await new Promise((r) => setTimeout(r, 10))

    const result = await ctx.tools.execute({
      callId: 'c1',
      name: 'skill',
      arguments: { name: 'msi-analysis' },
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    const full = await ctx.skills.load('msi-analysis')
    expect(full.length).toBeGreaterThan(2000) // 前置：该技能确实超截断线
    expect(result.content).toBe(full)
    // 未被管线截断 → 不产生 fullContent（无重复存档）
    expect(result.fullContent).toBeUndefined()
  })

  it('read_archived_result pages long archives via offset continuation', async () => {
    // 回归：旧实现每次都只回前 TOOL_RESULT_CHARS 字符且无续读路径，模型
    // 被截断存根指到存档后仍然读不全（反复调用拿到同一份被砍的文本）
    const longText = 'A'.repeat(20000)
    // 最小 OPFS 假根：只需 readArchive 的路径（getFileHandle → getFile().text()）
    const file = { text: () => Promise.resolve(longText), lastModified: 0 }
    const archiveDir = { getFileHandle: async (n: string) => {
      if (n !== 'call_long.txt') throw new Error('NotFoundError')
      return { getFile: () => Promise.resolve(file) }
    } }
    const root = {
      getDirectoryHandle: async (name: string) => {
        if (name !== 'assistant-archive') throw new Error('NotFoundError')
        return archiveDir
      },
    }
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } })

    const ctx = new Context()
    ctx.plugin(toolsProvider)
    ctx.plugin(archiveTools)
    await new Promise((r) => setTimeout(r, 10))

    // 第一窗口：8000 字符 + 续读指针
    const first = await ctx.tools.execute({
      callId: 'c1',
      name: 'read_archived_result',
      arguments: { archiveId: 'call_long' },
      signal: new AbortController().signal,
    })
    expect(first.isError).toBe(false)
    expect(first.content).toContain('A'.repeat(100))
    expect(first.content).toContain('offset=8000')
    expect(first.content).not.toContain('end of archived result')

    // 续读第二窗口直到结尾标记
    const second = await ctx.tools.execute({
      callId: 'c2',
      name: 'read_archived_result',
      arguments: { archiveId: 'call_long', offset: 16000 },
      signal: new AbortController().signal,
    })
    expect(second.isError).toBe(false)
    expect(second.content).toContain('end of archived result')

    vi.unstubAllGlobals()
  })
})
