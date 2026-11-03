/**
 * ctx.connection 服务：管理助手的连接配置（端点协议、地址、密钥、模型）。
 *
 * 其他插件只从这里拿连接，不直接读 localStorage 或环境变量；设置变化时广播
 * connection/changed，Vue 层据此刷新。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ResolvedConnection } from './types'
import {
  emptyConnectionConfig,
  loadConnectionConfig,
  resolveConnection,
  saveConnectionConfig,
  type ConnectionConfig,
} from './config'

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionManager
  }
  interface Events {
    /** 连接设置被保存或清除 */
    'connection/changed': () => void
  }
}

export class ConnectionManager extends Service {
  private config: ConnectionConfig = loadConnectionConfig()

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  /** 用户保存的设置，未合并部署默认 */
  settings(): ConnectionConfig {
    return { ...this.config }
  }

  /** 当前生效的连接；没有可用凭据时为 null */
  current(): ResolvedConnection | null {
    return resolveConnection(this.config)
  }

  save(next: ConnectionConfig): void {
    this.config = saveConnectionConfig(next)
    this.ctx.emit('connection/changed')
  }

  clear(): void {
    this.config = saveConnectionConfig(emptyConnectionConfig())
    this.ctx.emit('connection/changed')
  }
}

export * from './config'
export * from './devRelay'
export type * from './types'
