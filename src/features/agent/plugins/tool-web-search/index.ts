/** A single model-facing search tool backed by Exa's hosted search MCP. */
import type { Context } from '@deepseek-ai/cordis'
import { ENV } from '@/shared/config/env'
import { defineTool, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'
import { searchExa } from './exa'

export { searchExa, searchExaResults } from './exa'
export type { ExaSearchResult } from './exa'

export const name = 'tool-web-search'
export const inject = ['tools']

export interface Config {
  /** Optional user/deployment subkey for higher limits; never supplied by the model. */
  apiKey?: string
}

export function apply(ctx: Context, config: Config = {}) {
  /**
   * web_search —— Exa 托管搜索的通用网络检索。
   *
   * 作用：为时事信息、官方文档与来源发现搜公网；返回来源 URL 与文本摘录；用自然
   * 语言描述所需页面。科学摘要用 europepmc_search。不得发送私有数据集内容或凭据。
   *
   * 参数：
   * - query (string, 必填)：聚焦的自然语言描述，≤1000 字符
   * - maxResults (integer, 可选)：结果数，默认 5、cap 10
   */
  ctx.tools.register(
    defineTool({
      name: 'web_search',
      category: 'web',
      description:
        'Search the public web with Exa for current facts, official documentation and source discovery. ' +
        'Returns URLs and text excerpts; ground claims in the retrieved sources, and prefer ' +
        'europepmc_search for scientific abstracts. Never include private dataset content, personal data ' +
        'or credentials in the query; an excerpt is not the full page and does not support claims beyond it.',
      timeoutMs: 30000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      parameters: {
        query: {
          type: 'string',
          required: true,
          description:
            'Focused natural-language description of the information or page to find, at most 1000 characters; exclude private data or credentials.',
        },
        maxResults: {
          type: 'integer',
          description: 'Number of results, default 5, clamped 1–10.',
        },
      } as const,
      async execute(args, exec) {
        return searchExa(args.query, args.maxResults, exec.signal, config.apiKey ?? ENV.exaApiKey)
      },
    }),
  )
}
