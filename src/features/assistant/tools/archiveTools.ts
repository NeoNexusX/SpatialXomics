/**
 * 助手内部工具：OPFS 存档读取。
 *
 * agentLoop 把超过截断线（TOOL_RESULT_CHARS）的工具结果全文写入
 * utils/opfsStore 的存档区；历史预算吃紧时旧结果被替换为存根
 * （"…[truncated — call read_archived_result(id)]"）。本工具按 id 取回
 * 全文，模型在需要深挖旧数据时自取，不需要时零成本。
 */

import type { Context, Plugin } from 'cordis'
import { defineTool } from './defineTool'
import { readArchive } from '../utils/opfsStore'
import { ARCHIVE_WINDOW_CHARS } from '../agentconfig/defaults'

export const archiveTools: Plugin.Function<void> = (ctx: Context) => {
  ctx.tools.register(
    defineTool({
      name: 'read_archived_result',
      category: 'system',
      description:
        'Read the full text of a previously truncated tool result from the assistant archive. ' +
        'History truncation stubs mention an archive id — pass it here to recover the complete ' +
        'output (e.g. the untruncated annotation listing or database result). ' +
        'Long archives are returned in windows: pass the returned nextOffset to read the ' +
        'following section.',
      parameters: {
        archiveId: {
          type: 'string',
          required: true,
          description: 'Archive id from the truncation stub (the tool_call_id)',
        },
        offset: {
          type: 'integer',
          description: 'Character offset to start reading from (default 0). ' +
            'Use nextOffset from a previous call to continue reading.',
        },
      },
      async execute(args) {
        const offset = Math.max(0, args.offset ?? 0)
        const text = await readArchive(args.archiveId!)
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
          const window = text.slice(offset, offset + ARCHIVE_WINDOW_CHARS)
          const note =
            offset > 0
              ? `[archive continuation from char ${offset}]\n`
              : ''
          if (offset + ARCHIVE_WINDOW_CHARS >= text.length) {
            return `${note}${window}\n[end of archived result (${text.length} chars total)]`
          }
          const next = offset + ARCHIVE_WINDOW_CHARS
          return (
            `${note}${window}\n` +
            `…[archive is ${text.length} chars — read the next section with ` +
            `read_archived_result(archiveId, offset=${next})]`
          )
        },
      },
    }),
  )
}

// cordis 4：fiber 内访问兄弟服务（ctx.tools）必须声明 inject。
archiveTools.inject = ['tools']
