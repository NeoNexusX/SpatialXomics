/** A single model-facing search tool backed by Exa's hosted search MCP. */
import type { Context } from '@deepseek-ai/cordis'
import { ENV } from '@/shared/config/env'
import { defineTool, TOOL_RESULT_CHARS_EVIDENCE } from '../tools'
import { searchExa } from './exa'

export { searchExa } from './exa'

export const name = 'tool-web-search'
export const inject = ['tools']

export interface Config {
  /** Optional user/deployment subkey for higher limits; never supplied by the model. */
  apiKey?: string
}

export function apply(ctx: Context, config: Config = {}) {
  ctx.tools.register(
    defineTool({
      name: 'web_search',
      category: 'web',
      description:
        'Search the public web with Exa for current information, official documentation and source discovery. Returns source URLs and text excerpts. Describe the page you need in natural language. Use europepmc_search for scientific abstracts. Do not send private dataset contents or credentials.',
      timeoutMs: 30000,
      maxResultChars: TOOL_RESULT_CHARS_EVIDENCE,
      parameters: {
        query: {
          type: 'string',
          required: true,
          description:
            'Focused natural-language description of the information or page to find, at most 1000 characters',
        },
        maxResults: { type: 'integer', description: 'Number of results, default 5, maximum 10' },
      } as const,
      async execute(args, exec) {
        return searchExa(args.query, args.maxResults, exec.signal, config.apiKey ?? ENV.exaApiKey)
      },
    }),
  )
}
