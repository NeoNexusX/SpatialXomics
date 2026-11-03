/** 循环驱动器的实现插件：注册给 ctx.agent，消费方只依赖 ctx.agent */

import { Context, Service } from '@deepseek-ai/cordis'
import { LoopDriver } from './driver'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentLoop: AgentLoop
  }
}

export class AgentLoop extends Service {
  static inject = ['agent', 'attachments', 'connection', 'llm', 'tools']

  constructor(ctx: Context) {
    super(ctx, 'agentLoop')
    ctx.effect(() =>
      ctx.agent.setDriverFactory((session, notify) => new LoopDriver(session, ctx, notify)),
    )
  }
}
