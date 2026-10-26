/**
 * 测试用的 Worker：在当前线程里加载真实的 annotation.worker 模块。发往 worker 的消息先排队，
 * 由测试调用 deliver() 送达，用来构造消息交错的时序；worker 的回复在微任务里送回。
 * 每次安装都重新加载 worker 模块，库和会话状态不跨测试。
 */

import { vi } from 'vitest'

export interface FakeAnnotationWorker {
  onmessage: ((e: MessageEvent) => void) | null
  onerror: (() => void) | null
  terminated: boolean
  /** 已发出、还没送达的消息 */
  inbox: unknown[]
}

export interface FakeWorkerHarness {
  /** 传给 createEngineClient 的 worker 工厂 */
  spawn(): Worker
  /** spawn 创建的 worker（每个 engine 一个） */
  worker: FakeAnnotationWorker | null
  /** worker 收到的库 CSV 文件名，按收到的顺序 */
  dbFiles: string[]
  /** 把排队的消息依次送进 worker 模块 */
  deliver(): void
}

export async function installFakeAnnotationWorker(): Promise<FakeWorkerHarness> {
  const scope: {
    onmessage: ((e: { data: unknown }) => void) | null
    postMessage(msg: unknown): void
  } = {
    onmessage: null,
    postMessage(msg) {
      const w = harness.worker
      queueMicrotask(() => {
        if (w && !w.terminated) w.onmessage?.({ data: structuredClone(msg) } as MessageEvent)
      })
    },
  }

  class FakeWorker implements FakeAnnotationWorker {
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    terminated = false
    inbox: unknown[] = []
    constructor() {
      harness.worker = this
    }
    postMessage(data: unknown) {
      if (!this.terminated) this.inbox.push(structuredClone(data))
    }
    terminate() {
      this.terminated = true
    }
  }

  const harness: FakeWorkerHarness = {
    spawn: () => new FakeWorker() as unknown as Worker,
    worker: null,
    dbFiles: [],
    deliver() {
      const w = harness.worker
      if (!w || w.terminated) return
      for (const data of w.inbox.splice(0)) {
        const msg = data as { type: string; fileName?: string }
        if (msg.type === 'db') harness.dbFiles.push(msg.fileName!)
        scope.onmessage?.({ data })
      }
    },
  }

  vi.stubGlobal('self', scope)
  vi.resetModules()
  await import('../annotation.worker')
  return harness
}
