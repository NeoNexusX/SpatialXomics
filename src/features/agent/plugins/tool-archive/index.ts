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

  /**
   * read_archived_result —— 按窗口读回此前被截断的工具结果全文。
   *
   * 作用：历史截断桩里带 archiveId，传入即可取回完整输出（如未截断的注释列表或
   * 数据库结果；全文已写入会话存储）。长存档分窗返回：每次 ≤ARCHIVE_WINDOW_CHARS
   * 字符 + nextOffset 续读指针；本工具 maxResultChars 提到 Evidence 上限，读回内容
   * 不会被 ToolRuntime 再截一次。存档不存在/过期/OPFS 不可用时返回提示而非报错。
   *
   * 参数：
   * - archiveId (string, 必填)：截断桩中的存档 id
   * - offset (integer, 可选)：起始字符偏移，默认 0；用上次返回的 nextOffset 续读
   */
  ctx.tools.register(
    defineTool({
      name: 'read_archived_result',
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      category: 'system',
      description:
        'Retrieve the full text of a previously truncated tool result using the archiveId from its ' +
        'history stub. Returns a character window; continue with the returned nextOffset until the ' +
        'archive ends. This reads saved output — it does not rerun the original tool; a missing or ' +
        'expired archive returns a notice, not an error.',
      parameters: {
        archiveId: {
          type: 'string',
          required: true,
          description: 'The archiveId quoted in the truncation stub; pass verbatim.',
        },
        offset: {
          type: 'integer',
          description:
            "Character offset to start reading (default 0); use the previous call's nextOffset to continue.",
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
