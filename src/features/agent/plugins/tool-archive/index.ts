/**
 * 工具结果存档：完整结果写进会话存储，模型历史里被截断的结果带一个取回提示，
 * read_archived_result 工具按窗口读回来。
 */

import type { Context } from '@deepseek-ai/cordis'
import { readBlobText } from '../attachments'
import type { Session } from '../session'
import { defineTool, TOOL_RESULT_CHARS_DEFAULT, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'

/** read_archived_result 单次返回的窗口字符数（超出经 offset 翻页取回） */
const ARCHIVE_WINDOW_CHARS = TOOL_RESULT_CHARS_EVIDENCE

export const name = 'tool-archive'
export const inject = ['tools']

async function readArchive(session: Session | undefined, id: string): Promise<string | null> {
  if (!session) return null
  try {
    return await readBlobText(await session.storage.getArtifact(id))
  } catch {
    return null
  }
}

export function apply(ctx: Context) {
  ctx.on('agent/tool-result', async ({ session, result }, next) => {
    const stored = await next()
    if (stored.isError) return stored
    const archiveId = await session.storage.putArtifact(
      new Blob([result.fullContent ?? stored.content], { type: 'text/plain' }),
    )
    if (!result.fullContent) return { ...stored, archiveId }
    const note = `\n[full result archived; call read_archived_result("${archiveId}")]`
    const limit = result.maxResultChars ?? TOOL_RESULT_CHARS_DEFAULT
    return { ...stored, archiveId, content: stored.content.slice(0, limit - note.length) + note }
  })

  ctx.tools.register(
    defineTool({
      name: 'read_archived_result',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'system',
      description:
        'Read the full text of a previously truncated tool result from the agent archive. ' +
        'History truncation stubs mention an archive id — pass it here to recover the complete ' +
        'output (e.g. the untruncated annotation listing or database result). ' +
        'Long archives are returned in windows: pass the returned nextOffset to read the ' +
        'following section.',
      parameters: {
        archiveId: {
          type: 'string',
          required: true,
          description: 'Archive id from the truncation stub',
        },
        offset: {
          type: 'integer',
          description:
            'Character offset to start reading from (default 0). ' +
            'Use nextOffset from a previous call to continue reading.',
        },
      },
      async execute(args, exec) {
        const offset = Math.max(0, args.offset ?? 0)
        const text = await readArchive(exec.session, args.archiveId!)
        if (text == null) {
          return `No archived result for id "${args.archiveId}" (archive expired, OPFS unavailable, or the id is wrong).`
        }
        return { text, offset }
      },
      // 存档取回的语义是「全文」，不能被 ToolRuntime 截到 TOOL_RESULT_CHARS——
      // 否则模型反复调用都拿到同一份被砍的文本（skill 工作流因此读不全）。
      // 窗口化读取：每次返回 ARCHIVE_WINDOW_CHARS 字符 + nextOffset 续读指针，
      // 模型按需翻页，而不是假装一次性给全文。
      output: {
        render(_args, value) {
          const { text, offset } =
            typeof value === 'object' && value !== null
              ? (value as { text: string; offset: number })
              : { text: String(value), offset: 0 }
          const start = Math.min(offset, text.length)
          const note = start > 0 ? `[archive continuation from char ${start}]\n` : ''
          // Reserve enough for the longest footer; nextOffset counts only returned body characters.
          const reserve =
            `[archive ${text.length} chars; nextOffset=${text.length}; call read_archived_result(archiveId, offset=${text.length})]`
              .length + 2
          const window = text.slice(start, start + ARCHIVE_WINDOW_CHARS - note.length - reserve)
          const next = start + window.length
          const footer =
            next < text.length
              ? `[archive ${text.length} chars; nextOffset=${next}; call read_archived_result(archiveId, offset=${next})]`
              : `[end of archived result (${text.length} chars total)]`
          return `${note}${window}\n${footer}`
        },
      },
    }),
  )
}
