/**
 * agent 启动入口：创建 cordis 根 context，装配组合表（bundles/base.ts）。
 *
 * 模块级单例：首次调用 whenAgentReady() 时创建并缓存；
 * 聊天界面首次打开时经动态 import 触发（独立 chunk）。
 */

import { Context, type Fiber } from '@deepseek-ai/cordis'
import { baseBundle } from './bundles/base'

// cordis 的 FiberState 是 declare const enum，运行时没有导出
const FIBER_ACTIVE = 2
const FIBER_FAILED = 3

let rootCtx: Context | null = null
let rows: { id: string; fiber: Fiber }[] = []
let ready: Promise<Context> | null = null

/** 获取（懒创建）agent 的 cordis 根 context 单例 */
function getAgentContext(): Context {
  if (rootCtx) return rootCtx

  const ctx = new Context()
  rows = baseBundle.map((row) => ({ id: row.id, fiber: ctx.plugin(row.plugin, row.config) }))

  return (rootCtx = ctx)
}

/**
 * 插件在 inject 的服务就绪后才异步启动，全部启动后才能使用。
 * 有插件启动失败时报出它的名字：fiber 失败不会抛给调用方。
 */
export function whenAgentReady(): Promise<Context> {
  ready ??= new Promise((resolve, reject) => {
    const ctx = getAgentContext()
    const settle = () => {
      const failed = rows.filter((row) => row.fiber.state === FIBER_FAILED)
      if (failed.length) {
        stop()
        reject(
          new Error(`Agent plugins failed to start: ${failed.map((row) => row.id).join(', ')}`),
        )
      } else if (rows.every((row) => row.fiber.state === FIBER_ACTIVE)) {
        stop()
        resolve(ctx)
      }
    }
    const stop = ctx.on('internal/status', settle)
    settle()
  })
  return ready
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void rootCtx?.fiber.dispose()
    rootCtx = null
    rows = []
    ready = null
  })
}
