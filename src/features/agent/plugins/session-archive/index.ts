/**
 * ctx.sessionArchive 服务：把一段对话打成 ZIP，解开并校验 ZIP。
 *
 * 校验只在内存里做，写入存储由 ctx.agent.importConversation 负责。日志原样进出：
 * 工具结果的存档 id 写在消息正文里，改写就对不上了。fflate 用到时才加载。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Zippable } from 'fflate'
import { Session } from '../session'
import { assertArtifactId, createMemoryStorage, type SessionArchive } from '../session-persistence'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionArchive: SessionArchiveService
  }
}

const FORMAT = 'sxo-session'
const VERSION = 1
const LOG = 'session.jsonl'
const ARTIFACTS = 'artifacts/'

export class InvalidSessionArchiveError extends Error {
  constructor(cause: unknown) {
    super(`Invalid conversation file: ${String(cause)}`)
    this.name = 'InvalidSessionArchiveError'
  }
}

/** 所有图片引用都要在文件里，否则这段对话之后每次请求都会失败 */
function assertComplete(session: Session, artifacts: Map<string, Blob>): void {
  if (!session.events.some((event) => event.type === 'turn/start'))
    throw new Error('The conversation is empty')
  for (const event of session.events) {
    const refs =
      event.type === 'turn/start'
        ? event.user.attachments
        : event.type === 'message' &&
            (event.message.role === 'user' || event.message.role === 'tool')
          ? event.message.attachments
          : undefined
    for (const ref of refs ?? [])
      if (!artifacts.has(ref.id)) throw new Error(`Missing attachment ${ref.id}`)
  }
}

export class SessionArchiveService extends Service {
  static inject = ['analysisBinding', 'sessionPersistence']

  constructor(ctx: Context) {
    super(ctx, 'sessionArchive')
  }

  /** 打包当前数据集的一段对话。只读打开，对话可以正在运行 */
  async pack(id: string): Promise<{ blob: Blob; filename: string }> {
    const datasetId = this.ctx.analysisBinding.datasetId()
    const storage = await this.ctx.sessionPersistence.open(datasetId, { id, readOnly: true })
    try {
      const { strToU8, zipSync } = await import('fflate')
      const header = {
        format: FORMAT,
        version: VERSION,
        id,
        datasetId,
        exportedAt: new Date().toISOString(),
      }
      const lines = [header, ...(await storage.read())].map((line) => `${JSON.stringify(line)}\n`)
      const files: Zippable = { [LOG]: strToU8(lines.join('')) }
      for (const artifact of await storage.listArtifacts()) {
        const blob = await storage.getArtifact(artifact)
        files[ARTIFACTS + artifact] = new Uint8Array(await blob.arrayBuffer())
      }
      return {
        blob: new Blob([zipSync(files)], { type: 'application/zip' }),
        filename: `sxo-conversation-${id.slice(0, 8)}.zip`,
      }
    } finally {
      await storage.close()
    }
  }

  /** 解开并校验：批次的连续性和校验和、事件结构、状态折叠、图片引用。不合格抛错，不碰存储 */
  async unpack(file: Blob): Promise<SessionArchive> {
    try {
      const { strFromU8, unzipSync } = await import('fflate')
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: ({ name }) => name === LOG || (name.startsWith(ARTIFACTS) && !name.endsWith('/')),
      })
      if (!entries[LOG]) throw new Error(`Missing ${LOG}`)
      const [first, ...lines] = strFromU8(entries[LOG]).split('\n').filter(Boolean)
      const header = JSON.parse(first ?? 'null')
      if (header?.format !== FORMAT || header.version !== VERSION || typeof header.id !== 'string')
        throw new Error('Unsupported file format')

      const artifacts = new Map<string, Blob>()
      for (const [name, bytes] of Object.entries(entries))
        if (name !== LOG)
          artifacts.set(assertArtifactId(name.slice(ARTIFACTS.length)), new Blob([bytes]))

      const storage = createMemoryStorage()
      for (const line of lines) await storage.append(JSON.parse(line))
      const session = new Session(storage)
      await session.restore()
      assertComplete(session, artifacts)
      return { id: header.id, batches: await storage.read(), artifacts }
    } catch (error) {
      throw new InvalidSessionArchiveError(error)
    }
  }
}
