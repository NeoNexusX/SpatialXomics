/**
 * 用户提供的指令文档：从会话日志折叠出当前文档，写进系统提示词。
 * 文档原样输出，不做解析。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionProjectionDefinition } from '../session-projection'

export interface Instructions {
  name: string
  text: string
}

export const instructionsProjection: SessionProjectionDefinition<
  Instructions | undefined,
  Instructions | undefined
> = {
  key: 'instructions',
  init: () => undefined,
  apply: (state, event) =>
    event.type === 'instructions/set'
      ? event.text
        ? { name: event.name, text: event.text }
        : undefined
      : state,
  view: (state) => state,
}

export const name = 'agent-instructions'
export const inject = ['sessionProjections', 'systemPrompt']

export function apply(ctx: Context) {
  ctx.effect(() => ctx.sessionProjections.register(instructionsProjection))
  ctx.systemPrompt.section({
    key: 'user-instructions',
    order: 5,
    render: ({ session }) => {
      const document = ctx.sessionProjections.viewOf<Instructions>(session, 'instructions')
      return document ? `## User-provided instructions (${document.name})\n${document.text}` : ''
    },
  })
}
