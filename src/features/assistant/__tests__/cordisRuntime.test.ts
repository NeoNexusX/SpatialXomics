import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'

// 测试专用的合成事件：显式声明进 Events（全项目事件强类型后不再有宽索引签名）
declare module '@deepseek-ai/cordis' {
  interface Events {
    'test/event'(v: string): void
  }
}

/**
 * cordis 运行时的接线冒烟测试：
 * 验证 Context 实例化、插件加载、事件派发与服务注册
 * 在本项目环境（jsdom + 浏览器目标）下可用。
 */
describe('cordis runtime', () => {
  it('creates a root context', () => {
    const ctx = new Context()
    expect(Context.is(ctx)).toBe(true)
    expect(ctx.root).toBe(ctx)
  })

  it('loads a function plugin and disposes it', async () => {
    const ctx = new Context()
    const apply = vi.fn()
    const fiber = ctx.plugin((c) => apply(c))
    await fiber
    expect(apply).toHaveBeenCalledOnce()
    expect(typeof fiber.dispose).toBe('function')
  })

  it('supports emit/on and serial dispatch', () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.on('test/event', (v: string) => seen.push(v))
    ctx.emit('test/event', 'a')
    expect(seen).toEqual(['a'])
  })

  it('registers a Service subclass on ctx', async () => {
    class EchoService extends Service {
      constructor(ctx: Context) {
        super(ctx, 'echo')
      }
      ping() {
        return 'pong'
      }
    }
    const ctx = new Context()
    await ctx.plugin((c) => {
      new EchoService(c)
    })
    expect((ctx as any).echo.ping()).toBe('pong')
  })

  it('waits for inject dependencies before running the callback', async () => {
    const ctx = new Context()
    const ready = vi.fn()
    ctx.inject(['late'], (c) => ready((c as any).late))
    expect(ready).not.toHaveBeenCalled()
    // 通过 provide 注册服务（reflect 层）
    ;(ctx as any).reflect.provide('late', 42)
    await Promise.resolve()
    await Promise.resolve()
    expect(ready).toHaveBeenCalledWith(42)
  })
})
