/** 批量查询工具的公共部分：分页参数、单值和数组参数合并、逐项拼接输出 */

import type { Session } from '../session'
import type { ParameterSchemaSpec } from './schema'

export const batchPageParameters = {
  offset: {
    type: 'integer',
    description:
      'Zero-based start into the batch query inputs (default 0); continue with nextOffset.',
  },
  limit: {
    type: 'integer',
    description: 'Queries processed per page, default 5, max 8; pages inputs.',
  },
} satisfies ParameterSchemaSpec

/** 证据类批量工具的字符预算（配合 TOOL_RESULT_CHARS_EVIDENCE 的结果上限） */
export const EVIDENCE_BATCH_BUDGET = { maxChars: 11700, maxCharsPerItem: 11000 }

/** 批量参数优先，否则把单值参数变成一项 */
export function batchInput<T>(many: T[] | undefined, one: T | undefined): T[] {
  return many ?? (one != null ? [one] : [])
}

/**
 * 批量工具的统一输出形态：单项时不加节标题，和单查的输出一样；多项时逐项加
 * `### <label>` 节标题拼接。
 *
 * 单项 render 抛错按原样上抛（索引未构建等全局错误应让整次调用失败）；
 * 多项时单项失败不拖垮整批——错误文本就地成为该节内容（批量 PubChem/ChEBI
 * 查询里一个未知名字不该让其余结果全丢）。
 */
export async function renderBatch<T>(
  items: T[],
  label: (item: T) => string,
  render: (item: T) => string | Promise<string>,
  options: {
    offset?: number
    limit?: number
    maxChars?: number
    maxCharsPerItem?: number
    /** false: offset/limit belong to each query's results, never to the input array. */
    paginateInputs?: boolean
    /**
     * Soft wall-clock budget (epoch ms) for slow-network batch tools. An item
     * that would START past it is skipped and left to the nextOffset footer —
     * never degraded in place, which would consume the pagination cursor and
     * get skipped forever when the model follows the footer.
     */
    deadline?: number
    session?: Session
    signal?: AbortSignal
  } = {},
): Promise<string> {
  const paginateInputs = options.paginateInputs ?? true
  const offset = paginateInputs
    ? Math.min(items.length, Math.max(0, Math.floor(options.offset ?? 0)))
    : 0
  const limit = paginateInputs
    ? Math.min(8, Math.max(1, Math.floor(options.limit ?? 5)))
    : items.length
  const budget = options.maxChars ?? 3700
  const itemBudget = options.maxCharsPerItem ?? 700
  const sections: string[] = []
  let used = 0
  let next = offset
  let deadlineHit = false
  for (let index = offset; index < Math.min(items.length, offset + limit); index++) {
    options.signal?.throwIfAborted()
    if (options.deadline != null && Date.now() > options.deadline && sections.length) {
      deadlineHit = true
      break
    }
    const item = items[index]!
    const heading = items.length > 1 ? `### ${label(item).slice(0, 180)}\n` : ''
    // Do not query an item that cannot fit. Leave it for the next page.
    const remaining = budget - 200 - used - heading.length - 2
    if (sections.length && remaining < Math.min(itemBudget, 256)) break
    let body: string
    try {
      body = await render(item)
      options.signal?.throwIfAborted()
    } catch (error) {
      options.signal?.throwIfAborted()
      if (items.length === 1) throw error
      body = `Error: ${error instanceof Error ? error.message : String(error)}`
    }
    // Keep complete evidence items. Long single items remain available in the archive.
    const cap = Math.min(items.length === 1 ? budget : itemBudget, remaining)
    const needsArchive = body.length > cap
    const previewLength = needsArchive ? Math.max(0, cap - 180) : body.length
    if (needsArchive && options.session) {
      const id = await options.session.storage.putArtifact(new Blob([body], { type: 'text/plain' }))
      body =
        body.slice(0, previewLength) +
        `\n[complete item archived; call read_archived_result("${id}")]`
    } else if (needsArchive) {
      // Without session storage return the full item so the runtime can archive it.
      sections.push(heading + body)
      next = index + 1
      break
    }
    sections.push(heading + body)
    used += heading.length + body.length + 2
    next = index + 1
  }
  const footer = deadlineHit
    ? paginateInputs
      ? `\n[${items.length - next} inputs not started: the batch time budget was exhausted by earlier slow responses; nextOffset=${next}; repeat the same query arrays with offset=${next} to continue with a fresh budget.]`
      : `\n[${items.length - next} queries not started because the batch time budget was exhausted by earlier slow responses; retry the remaining queries in a smaller batch.]`
    : next < items.length
      ? paginateInputs
        ? `\n[${items.length - next} more; nextOffset=${next}; repeat the same query arrays with offset=${next}]`
        : `\n[${items.length - next} queries not returned because the result character budget was exhausted; retry the remaining queries in a smaller batch.]`
      : ''
  return sections.join('\n\n') + footer
}

