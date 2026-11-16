/** ctx.sessions 服务：从存储恢复会话。事件日志、投影驱动和崩溃收尾都在 Session 里 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionStorage } from '../session-persistence'
import { Session } from './session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessions: Sessions
  }
}

export class Sessions extends Service {
  static inject = ['sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  /** 读出日志并重建会话。可写时补齐上次崩溃留下的未结束事件 */
  async restore(storage: SessionStorage): Promise<Session> {
    const session = new Session(storage, this.ctx.sessionProjections)
    await session.restore()
    if (storage.mode !== 'read-only') await session.recover()
    return session
  }
}

export * from './session'
export * from './schema'
export { balancedEnds } from './surface'
export * from './types'
