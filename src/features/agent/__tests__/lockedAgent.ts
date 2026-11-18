/**
 * 行为锁定测试的接线：组装一个完整的 agent，脚本化模型响应，把运行结果归一化成可比较的文本。
 *
 * 场景和快照都只经过 Agent 公开接口和存储读取。重构内部结构时只改这个文件里的接线部分，
 * 快照一个字节都不应该变。
 */

import { Context } from '@deepseek-ai/cordis'
import { fnv1a } from '@/shared/utils/fnv1a'
import { baseBundle } from '../bundles/base'
import { resolveRetryPolicy, type RetryPolicyConfig } from '../plugins/llm'
import { defineTool } from '../plugins/tools'
import type { Agent, AgentSnapshot } from '../plugins/agent'
import {
  createMemoryStorage,
  firstQuestion,
  makeBatch,
  MAX_SESSIONS,
  SessionBusyError,
  SessionLimitError,
  SessionPersistence,
  type SessionArchive,
  type SessionStorage,
  type SessionTarget,
  type StoredSessionInfo,
} from '../plugins/session-persistence'
import type { GenerateOptions, LlmAdapter, StreamChunk } from '../plugins/llm'
import type { ResolvedConnection } from '../plugins/connection'

export const text = (value: string): StreamChunk[] => [
  { type: 'text-delta', index: 0, text: value },
  { type: 'finish', reason: { kind: 'stop' } },
]
export const toolCall = (name: string, args: unknown = {}, id = 'c1'): StreamChunk[] => [
  { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
export const fail = (code: string, message = code): StreamChunk[] => [
  { type: 'finish', reason: { kind: 'error', failure: { code, message } } },
]

export type ScriptStep =
  | StreamChunk[]
  | ((
      options: GenerateOptions,
      connection: ResolvedConnection,
      signal: AbortSignal,
    ) => AsyncIterable<StreamChunk>)

export interface LockedAgentOptions {
  /** 挂上全部真实工具插件；默认只挂存档、技能和脚本工具，提示词短，上下文预算好算 */
  fullTools?: boolean
  /** 不注册脚本工具，提示词和工具 schema 只含真实工具 */
  noScriptTools?: boolean
  /** 从生产组合表里去掉这些行 */
  without?: string[]
  /** 默认不挂的领域工具里，挂上这些行 */
  with?: string[]
  /** 按行 id 替换组合表里的配置 */
  config?: Record<string, unknown>
  retryPolicy?: RetryPolicyConfig
  adapter?: Partial<LlmAdapter>
  /** 替换某个数据集打开的存储 */
  openStorage?: (datasetId: string, fresh: boolean) => Promise<SessionStorage>
  /** 这些对话正在别的标签页里写入，不能删除 */
  busySessions?: Set<string>
}

interface OpenedStorage {
  datasetId: string
  storage: SessionStorage
}

export interface LockedAgent {
  ctx: Context
  agent: Agent
  /** 按打开顺序记录的全部存储 */
  storages: OpenedStorage[]
  /** 适配器收到的请求，按发出顺序 */
  calls: GenerateOptions[]
  /** 界面能看到的状态序列（相邻重复已去掉） */
  trace: string[]
  slowTool: { entered: Promise<void>; release: () => void }
  dispose(): Promise<void>
}

function traceOf(snapshot: AgentSnapshot): string {
  const last = [...snapshot.messages].reverse().find((item) => item.role === 'assistant')
  const parts = (last?.parts ?? [])
    .map((part) =>
      part.type === 'tool' ? `tool:${part.state}` : `${part.type}:${part.text.length}`,
    )
    .join(',')
  const retrying = last?.retrying ? ` retry ${last.retrying.retry}/${last.retrying.maxRetries}` : ''
  return `${snapshot.phase}${retrying}${parts ? ` [${parts}]` : ''}`
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const DOMAIN_TOOLS = [
  'tool-backend-api',
  'tool-kegg',
  'tool-knowledge',
  'tool-literature',
  'tool-web-search',
  'tool-page-context',
  'tool-ion-image',
  'tool-ask-user',
]

export async function createLockedAgent(
  script: ScriptStep[] = [],
  options: LockedAgentOptions = {},
): Promise<LockedAgent> {
  const storages: OpenedStorage[] = []
  const byDataset = new Map<string, SessionStorage>()
  const openStorage = async (
    datasetId: string,
    target: SessionTarget = 'last',
  ): Promise<SessionStorage> => {
    if (typeof target === 'object') {
      const opened = storages.find((entry) => entry.storage.id === target.id)
      if (!opened) throw new DOMException('Missing', 'NotFoundError')
      if (!target.readOnly) byDataset.set(datasetId, opened.storage)
      return opened.storage
    }
    const fresh = target === 'new'
    if (fresh && (await listStored(datasetId)).length >= MAX_SESSIONS) throw new SessionLimitError()
    let storage: SessionStorage | undefined = options.openStorage
      ? await options.openStorage(datasetId, fresh)
      : byDataset.get(datasetId)
    if (!storage || (fresh && !options.openStorage)) storage = createMemoryStorage()
    byDataset.set(datasetId, storage)
    if (!storages.some((entry) => entry.storage === storage)) storages.push({ datasetId, storage })
    return storage
  }
  /** 打开顺序就是更新顺序，够场景测试用。真实的目录规则在存储插件自己的测试里 */
  const listStored = async (datasetId: string): Promise<StoredSessionInfo[]> => {
    const sessions: StoredSessionInfo[] = []
    for (const [index, { datasetId: scope, storage }] of storages.entries()) {
      if (scope !== datasetId) continue
      // 读不出来的对话也要列出来，和真实存储一样
      const batches = await storage.read().catch(() => [makeBatch('unreadable', 0, [{}])])
      const question = batches.map(firstQuestion).find((item) => item !== undefined)
      sessions.push({
        id: storage.id,
        title: question || null,
        blank: question === undefined && batches.every((batch) => batch.id !== 'unreadable'),
        updatedAt: index,
      })
    }
    return sessions.reverse()
  }
  class TestPersistence extends SessionPersistence {
    open(scope: string, target?: SessionTarget) {
      return openStorage(scope, target)
    }
    list(scope: string) {
      return listStored(scope)
    }
    async remove(scope: string, id: string) {
      if (options.busySessions?.has(id)) throw new SessionBusyError()
      const index = storages.findIndex((entry) => entry.storage.id === id)
      if (index >= 0) storages.splice(index, 1)
      if (byDataset.get(scope)?.id === id) {
        byDataset.delete(scope)
        const remaining = storages.filter((entry) => entry.datasetId === scope)
        const latest = remaining[remaining.length - 1]
        if (latest) byDataset.set(scope, latest.storage)
      }
    }
    async importSession(scope: string, archive: SessionArchive) {
      if ((await listStored(scope)).filter((item) => !item.blank).length >= MAX_SESSIONS)
        throw new SessionLimitError()
      const memory = createMemoryStorage()
      for (const batch of archive.batches) await memory.append(batch)
      const storage: SessionStorage = {
        ...memory,
        id: archive.id,
        getArtifact: async (id) => archive.artifacts.get(id) ?? memory.getArtifact(id),
        listArtifacts: async () => [...archive.artifacts.keys()],
      }
      storages.push({ datasetId: scope, storage })
      return storage.id
    }
  }

  const ctx = new Context()
  for (const row of baseBundle) {
    if (row.id === 'llm-anthropic' || row.id === 'session-persistence-opfs') continue
    if (!options.fullTools && DOMAIN_TOOLS.includes(row.id) && !options.with?.includes(row.id)) continue
    if (options.without?.includes(row.id)) continue
    ctx.plugin(row.plugin, options.config?.[row.id] ?? row.config)
  }
  ctx.plugin(TestPersistence)
  await settle()

  const calls: GenerateOptions[] = []
  let cursor = 0
  ctx.llm.registerAdapter({
    endpoint: 'anthropic',
    async *stream(request, connection, signal) {
      calls.push(request)
      const step = script[cursor++]
      if (!step) throw new Error(`The script has no response for call ${cursor}`)
      if (typeof step === 'function') yield* step(request, connection, signal)
      else yield* step
    },
    listModels: async () => [],
    probeVision: async () => 'vision',
    retryPolicy: () =>
      resolveRetryPolicy(
        options.retryPolicy ?? {
          maxRetries: 2,
          backoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 },
        },
        'test',
      ),
    ...options.adapter,
  })

  let enterSlow!: () => void
  let releaseSlow!: () => void
  const entered = new Promise<void>((resolve) => {
    enterSlow = resolve
  })
  const released = new Promise<void>((resolve) => {
    releaseSlow = resolve
  })
  if (!options.noScriptTools) {
    ctx.tools.register(
      defineTool({
        name: 'lookup',
        description: 'Look up evidence',
        parameters: {},
        execute: async () => 'evidence 885.5',
      }),
    )
    ctx.tools.register(
      defineTool({
        name: 'long_lookup',
        description: 'Look up a long listing',
        parameters: {},
        execute: async () => 'L'.repeat(5000),
      }),
    )
    ctx.tools.register(
      defineTool({
        name: 'needs_arg',
        description: 'Requires an argument',
        parameters: { value: { type: 'string', required: true } },
        execute: async (args) => `got ${args.value}`,
      }),
    )
    ctx.tools.register(
      defineTool({
        name: 'failing',
        description: 'Always throws',
        parameters: {},
        execute: async (): Promise<string> => {
          throw new Error('tool exploded')
        },
      }),
    )
    ctx.tools.register(
      defineTool({
        name: 'slow',
        description: 'Waits for the test',
        parameters: {},
        execute: async (_args, exec) => {
          enterSlow()
          await new Promise<void>((resolve, reject) => {
            void released.then(resolve)
            exec.signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            )
          })
          return 'slow result'
        },
      }),
    )
  }

  const agent: Agent = ctx.agent

  const trace: string[] = []
  agent.subscribe((snapshot) => {
    const line = traceOf(snapshot)
    if (trace[trace.length - 1] !== line) trace.push(line)
  })

  return {
    ctx,
    agent,
    storages,
    calls,
    trace,
    slowTool: { entered, release: releaseSlow },
    async dispose() {
      await ctx.fiber.dispose()
    },
  }
}

// ---- 归一化 ----

const checksum = (value: string) => fnv1a(value).toString(16).padStart(8, '0')

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const LONG_TEXT = 240

/** 去重状态：跨整个 outcome 共享，同一份内容只全文保留第一次 */
interface Dedup {
  baseGeneration: number
  requests: Map<string, string>
  messages: Map<string, string>
  /** 相邻事件里相同的关联 id 只在第一次出现时保留 */
  last: { turnId?: string; attemptId?: string; compactionId?: string }
}

/** 首次出现全文保留，之后每次重复都换成同一个标签；内容一变就是新的全文 */
function firstOnly(
  seen: Map<string, string>,
  prefix: string,
  raw: string,
  full: () => unknown,
): unknown {
  const label = seen.get(raw)
  if (label) return label
  seen.set(raw, `<${prefix} ${seen.size + 1}>`)
  return full()
}

/**
 * 事件瘦身：id 是随机数、time 是时钟（顺序由数组位置和 seq 锁定），turnId/attemptId/
 * compactionId 这类关联 id 与上一条相同时也不再重复。这些字段都没有行为含义，删掉只是去噪。
 */
function slimEvent(event: unknown, dedup: Dedup): unknown {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event
  const rest = { ...(event as Record<string, unknown>) }
  delete rest.id
  delete rest.time
  const kept: Record<string, string> = {}
  for (const field of ['turnId', 'attemptId', 'compactionId'] as const) {
    const value = rest[field]
    delete rest[field]
    if (typeof value === 'string' && value !== dedup.last[field]) {
      dedup.last[field] = value
      kept[field] = value
    }
  }
  return { ...kept, ...rest }
}

function abbreviate(value: unknown, key: string, dedup: Dedup): unknown {
  if (key === 'generation' && typeof value === 'number') return value - dedup.baseGeneration
  if (key === 'system' && typeof value === 'string') return `<prompt ${checksum(value)}>`
  if (key === 'tools' && Array.isArray(value)) return `<tools ${checksum(JSON.stringify(value))}>`
  if (typeof value === 'string')
    return value.length > LONG_TEXT
      ? `<text ${value.length} ${checksum(value)} ${value.slice(0, 40)}…${value.slice(-80)}>`
      : value
  // request/context 与 attempt/start 成对携带同一份 request，calls 逐轮重发整段历史：
  // 全 outcome 只全文保留第一次，之后换成 <request N> / <message N>。
  if (value && typeof value === 'object' && key === 'request')
    return firstOnly(dedup.requests, 'request', JSON.stringify(value), () =>
      abbreviate(value, '', dedup),
    )
  if (value && typeof value === 'object' && (key === 'message' || key === 'user'))
    return firstOnly(dedup.messages, 'message', JSON.stringify(value), () =>
      abbreviate(value, '', dedup),
    )
  if (Array.isArray(value)) {
    if (key === 'events') return value.map((event) => abbreviate(slimEvent(event, dedup), '', dedup))
    if (key === 'messages')
      return value.map((message) =>
        firstOnly(dedup.messages, 'message', JSON.stringify(message), () =>
          abbreviate(message, '', dedup),
        ),
      )
    return value.map((item) => abbreviate(item, '', dedup))
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, abbreviate(item, name, dedup)]),
    )
  return value
}

/** 随机 id 换成按出现顺序编号的标签，长文本和提示词换成校验和，重复内容只保留第一次 */
export function normalize(value: unknown, baseGeneration = 0): string {
  const labels = new Map<string, string>()
  const stable = JSON.stringify(value, (_key, item) =>
    item instanceof Error ? `${item.name}: ${item.message}` : item,
  ).replace(UUID, (id) => {
    if (!labels.has(id)) labels.set(id, `uuid-${labels.size + 1}`)
    return labels.get(id)!
  })
  const dedup: Dedup = {
    baseGeneration,
    requests: new Map(),
    messages: new Map(),
    last: {},
  }
  return JSON.stringify(abbreviate(JSON.parse(stable), '', dedup), null, 1) + '\n'
}

/** 一次场景的完整结果：写进存储的事件、发给模型的请求、界面状态序列和最终快照 */
export async function outcomeOf(h: LockedAgent, extra: Record<string, unknown> = {}) {
  const logs = await Promise.all(
    h.storages.map(async ({ datasetId, storage }) => ({
      datasetId,
      mode: storage.mode,
      events: (await storage.read()).flatMap((batch) => batch.events),
    })),
  )
  const { sessionId: _sessionId, ...snapshot } = h.agent.snapshot()
  return { ...extra, logs, calls: h.calls, trace: h.trace, snapshot }
}
