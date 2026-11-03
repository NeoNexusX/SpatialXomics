/**
 * assistant bootstrap：创建 cordis 根 context，按序加载全部插件。
 *
 * 模块级单例：首次调用 getAssistantContext() 时创建并缓存；
 * 聊天界面首次打开时经动态 import 触发（独立 chunk）。
 *
 * 加载顺序（后者依赖前者注册的服务）：
 *   connection → llm → anthropicAdapter（支持新协议时在这里加适配器插件）→ models
 *   → tools → skills
 *   → frontendContextTools / backendApiTools
 *   → knowledgeTools（化学）/ bioTools（生物）/ literatureTools（文献）
 *   → agentLoop
 */

import { Context } from '@deepseek-ai/cordis'
import { connectionProvider } from '../providers/connection'
import { llmProvider } from '../providers/llm'
import { modelCatalogProvider } from '../providers/modelCatalog'
import { toolsProvider } from '../providers/tools'
import { skillsProvider } from '../providers/skills'
import { frontendContextTools } from '../tools/frontendContextTools'
import { backendApiTools } from '../tools/backendApiTools'
import { knowledgeTools } from '../tools/knowledgeTools'
import { bioTools } from '../tools/bioTools'
import { literatureTools } from '../tools/literatureTools'
import { archiveTools } from '../tools/archiveTools'
import { anthropicAdapterPlugin } from './anthropicAdapter'
import { agentLoopProvider } from './agentLoop'

let rootCtx: Context | null = null
let ready: Promise<Context> | null = null

/** 获取（懒创建）assistant 的 cordis 根 context 单例 */
export function getAssistantContext(): Context {
  if (rootCtx) return rootCtx

  const ctx = new Context()
  ctx.plugin(connectionProvider)
  ctx.plugin(llmProvider)
  ctx.plugin(anthropicAdapterPlugin)
  ctx.plugin(modelCatalogProvider)
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

/** 服务由异步 fiber 注册，刚创建时还不能访问。需要调用服务时先等它 */
export function whenAssistantReady(): Promise<Context> {
  ready ??= new Promise((resolve) => {
    getAssistantContext().inject(['connection', 'llm', 'models', 'agent'], (ctx) => resolve(ctx))
  })
  return ready
}

