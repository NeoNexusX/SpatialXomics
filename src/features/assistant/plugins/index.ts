/**
 * assistant bootstrap：创建 cordis 根 context，按序加载全部插件。
 *
 * 等价于 dsh 的 cordis.yml 组合文件（浏览器端用代码式组合）。
 * 模块级单例：首次调用 getAssistantContext() 时创建并缓存；
 * FloatingAIAssistant 首次打开时经动态 import 触发（独立 chunk）。
 *
 * 加载顺序（后者依赖前者注册的服务）：
 *   llm → tools → skills
 *   → frontendContextTools / backendApiTools
 *   → knowledgeTools（化学）/ bioTools（生物）/ literatureTools（文献）
 *   → agentLoop
 */

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
import { agentLoopProvider } from './agentLoop'

let rootCtx: Context | null = null

/** 获取（懒创建）assistant 的 cordis 根 context 单例 */
export function getAssistantContext(): Context {
  if (rootCtx) return rootCtx

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
  ctx.plugin(agentLoopProvider)

  return (rootCtx = ctx)
}

/** 彻底销毁 context（如登出时调用；下次 getAssistantContext 会重建） */
export function disposeAssistantContext(): void {
  if (!rootCtx) return
  // cordis 根 context dispose 会级联卸载所有插件与服务
  ;(rootCtx as any).fiber?.dispose?.()
  rootCtx = null
}
