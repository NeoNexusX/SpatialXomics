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
   * 语言描述所需页面。也是文献降级链第 3 档：pubmed_search 与 europepmc_search 都
   * 报错或零命中后才用它找证据，此时拿到的是网页摘录而非同行评议摘要，须声明。
   * 不得发送私有数据集内容或凭据。
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
        'Also the last resort of the literature chain: use it for evidence only after pubmed_search and ' +
        'europepmc_search have both errored or returned no hits, and say that the evidence is then a web ' +
        'excerpt rather than a peer-reviewed abstract. Build the query from the claim you are checking. ' +
        'Returns URLs and text excerpts; ground claims in the retrieved sources. Never include private ' +
        'dataset content, personal data or credentials in the query; an excerpt is not the full page and ' +
        'does not support claims beyond it.',
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
