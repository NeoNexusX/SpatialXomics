import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useAnnotationSpatial } from '../useAnnotationSpatial'
import type { SpatialJob } from '@/features/vizworkbench/types/annotation'

const { reads, failures } = vi.hoisted(() => ({
  /** 读过的峰，按发起读取的顺序 */
  reads: [] as number[],
  /** 峰 → 还要失败几次 */
  failures: new Map<number, number>(),
}))

vi.mock('../useZarrIonImage', async () => {
  const { ref } = await import('vue')
  return {
    mzAxisRef: ref(Float64Array.from({ length: 500 }, (_, i) => 100 + i)),
    // 2×2 的小图：在途上限取最大的 256 张
    getSharedZarrContext: () => ({ ionShape: { width: 2, height: 2 } }),
    loadIonMatrixByIndex: async (idx: number) => {
      reads.push(idx)
      const left = failures.get(idx) ?? 0
      if (left > 0) {
        failures.set(idx, left - 1)
        throw new Error('read failed')
      }
      return Float32Array.of(idx, idx, idx, idx)
    },
  }
})

interface Sent {
  axis: number
  image: Float32Array | null
  /** worker 处理完：带回要重读的峰 */
  resolve: (reread: number[]) => void
}

function setup() {
  const sent: Sent[] = []
  let spatial!: ReturnType<typeof useAnnotationSpatial>
  const app = createApp({
    setup() {
      spatial = useAnnotationSpatial({
        tolerance: () => ({ value: 5, unit: 'ppm', origin: 'user' }),
        send: (axis, image) => new Promise((resolve) => sent.push({ axis, image, resolve })),
      })
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  return { spatial, sent, app }
}

/** 单峰任务：第 i 个的峰是 axes[i]，优先级 i + 1 */
function jobs(axes: number[]): SpatialJob[] {
  return axes.map((axis, i) => ({ job: `t${i}`, axisIndices: [axis], priority: i + 1 }))
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** 依次让 worker 处理完所有送出的图（处理时会送出新的图） */
async function drain(sent: Sent[]) {
  for (let i = 0; i < sent.length; i++) {
    sent[i]!.resolve([])
    await flushPromises()
  }
}

afterEach(() => {
  reads.length = 0
  failures.clear()
})

describe('useAnnotationSpatial', () => {
  it('reads the top-priority groups first, then every other peak once in m/z order', async () => {
    const { spatial, sent, app } = setup()
    // 优先级越靠前，峰的下标越大；最后一个 decoy 组的峰 99 已在首屏组里
    const axes = range(30).map((i) => 99 - i)
    spatial.start([...jobs(axes), { job: 'd0:1', axisIndices: [99, 5], priority: 31 }])
    await flushPromises()
    const sweep = [...axes.slice(24), 5].sort((a, b) => a - b)
    expect(reads).toEqual([...axes.slice(0, 24), ...sweep])
    expect(sent.map((s) => s.axis)).toEqual(reads)
    expect(sent[0]!.image).toEqual(Float32Array.of(99, 99, 99, 99))
    await drain(sent)
    expect(reads).toHaveLength(31)
    app.unmount()
  })

  it('caps the images in flight and re-reads what the worker asks for first', async () => {
    const { spatial, sent, app } = setup()
    spatial.start(jobs(range(300)))
    await flushPromises()
    expect(reads).toEqual(range(256))
    // 腾出的位置先给重读
    sent[0]!.resolve([7])
    await flushPromises()
    expect(reads.slice(256)).toEqual([7])
    expect(sent[sent.length - 1]!.axis).toBe(7)
    await drain(sent)
    expect(reads.slice(257)).toEqual(range(300).slice(256))
    app.unmount()
  })

  it('retries a failed read once, then reports the peak as unreadable', async () => {
    const { spatial, sent, app } = setup()
    failures.set(3, 1)
    failures.set(5, 9)
    spatial.start(jobs([3, 5, 8]))
    await flushPromises()
    expect(reads.filter((a) => a === 3)).toHaveLength(2)
    expect(reads.filter((a) => a === 5)).toHaveLength(2)
    expect(sent.find((s) => s.axis === 3)!.image).toEqual(Float32Array.of(3, 3, 3, 3))
    expect(sent.find((s) => s.axis === 5)!.image).toBeNull()
    expect(sent.map((s) => s.axis).sort()).toEqual([3, 5, 8])
    app.unmount()
  })

  it('moves a requested group ahead of the remaining sweep', async () => {
    const { spatial, sent, app } = setup()
    spatial.start(jobs(range(300)))
    await flushPromises()
    spatial.bump(['t290'])
    sent[0]!.resolve([])
    await flushPromises()
    expect(reads[256]).toBe(290)
    await drain(sent)
    expect(reads.filter((a) => a === 290)).toHaveLength(1)
    expect(new Set(reads).size).toBe(300)
    app.unmount()
  })

  it('drops queued reads on cancel and ignores late replies', async () => {
    const { spatial, sent, app } = setup()
    spatial.start(jobs(range(300)))
    await flushPromises()
    spatial.cancel()
    sent[0]!.resolve([7])
    await flushPromises()
    expect(reads).toHaveLength(256)
    // 新的一批从头开始
    spatial.start(jobs([400]))
    await flushPromises()
    expect(reads.slice(256)).toEqual([400])
    app.unmount()
  })
})
