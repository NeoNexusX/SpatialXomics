/**
 * 生产组合表：助手由哪些插件组成。
 *
 * 行序没有加载语义，插件在 inject 的服务就绪后才启动。支持新协议、增减工具都只改这张表。
 */

import type { Plugin } from '@deepseek-ai/cordis'
import { ConnectionManager } from '../plugins/connection'
import { LlmRuntime } from '../plugins/llm'
import * as llmAnthropic from '../plugins/llm-anthropic'
import * as llmRetry from '../plugins/llm-retry'
import { ModelCatalog } from '../plugins/model-catalog'
import { Sessions } from '../plugins/session'
import { SessionArchiveService } from '../plugins/session-archive'
import { OpfsSessionPersistence } from '../plugins/session-persistence-opfs'
import { SessionProjections } from '../plugins/session-projection'
import * as sessionTranscript from '../plugins/session-transcript'
import { Attachments } from '../plugins/attachments'
import { TokenMeter } from '../plugins/token-meter'
import { Compaction } from '../plugins/compaction'
import { SystemPrompt } from '../plugins/system-prompt'
import * as persona from '../plugins/persona'
import * as agentInstructions from '../plugins/agent-instructions'
import { AnalysisBindingService } from '../plugins/analysis-binding'
import { ToolRuntime } from '../plugins/tools'
import * as toolArchive from '../plugins/tool-archive'
import * as toolBackendApi from '../plugins/tool-backend-api'
import * as toolKegg from '../plugins/tool-kegg'
import * as toolKnowledge from '../plugins/tool-knowledge'
import * as toolLiterature from '../plugins/tool-literature'
import * as toolWebSearch from '../plugins/tool-web-search'
import * as toolIonImage from '../plugins/tool-ion-image'
import * as toolPageContext from '../plugins/tool-page-context'
import { SkillsRegistry } from '../plugins/skill'
import * as skillBundled from '../plugins/skill-bundled'
import * as toolSkill from '../plugins/tool-skill'
import { AgentRuntime } from '../plugins/agent'
import { AgentLoop } from '../plugins/agent-loop'

export interface BundleRow {
  id: string
  plugin: Plugin
  config?: unknown
}

export const baseBundle: BundleRow[] = [
  // 模型连接
  { id: 'connection', plugin: ConnectionManager },
  { id: 'llm', plugin: LlmRuntime },
  { id: 'llm-anthropic', plugin: llmAnthropic },
  { id: 'llm-retry', plugin: llmRetry },
  { id: 'model-catalog', plugin: ModelCatalog },

  // 会话
  { id: 'session', plugin: Sessions },
  { id: 'session-archive', plugin: SessionArchiveService },
  { id: 'session-persistence-opfs', plugin: OpfsSessionPersistence },
  { id: 'session-projection', plugin: SessionProjections },
  { id: 'session-transcript', plugin: sessionTranscript },
  { id: 'attachments', plugin: Attachments },

  // 上下文预算
  { id: 'token-meter', plugin: TokenMeter },
  { id: 'compaction', plugin: Compaction },

  // 系统提示词
  { id: 'system-prompt', plugin: SystemPrompt },
  { id: 'persona', plugin: persona },
  { id: 'agent-instructions', plugin: agentInstructions },
  { id: 'analysis-binding', plugin: AnalysisBindingService },

  // 工具和技能
  { id: 'tools', plugin: ToolRuntime },
  { id: 'tool-archive', plugin: toolArchive },
  { id: 'tool-backend-api', plugin: toolBackendApi },
  { id: 'tool-kegg', plugin: toolKegg },
  { id: 'tool-knowledge', plugin: toolKnowledge },
  { id: 'tool-literature', plugin: toolLiterature },
  { id: 'tool-web-search', plugin: toolWebSearch },
  { id: 'tool-page-context', plugin: toolPageContext },
  { id: 'tool-ion-image', plugin: toolIonImage },
  { id: 'skill', plugin: SkillsRegistry },
  { id: 'skill-bundled', plugin: skillBundled },
  { id: 'tool-skill', plugin: toolSkill },

  // 循环
  { id: 'agent', plugin: AgentRuntime },
  { id: 'agent-loop', plugin: AgentLoop },
]
