import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useOverlayData } from '../useOverlayData'
import type { KmeansEmbeddingInput } from '@/features/vizworkbench/utils/kmeans'

// UMAP grid is 1 × width; `points` are the embedded (x, y) cells.
const kmeans = vi.hoisted(() => ({
  finish: null as ((result: unknown) => void) | null,
  input: null as KmeansEmbeddingInput | null,
  width: 2,
  points: [[0, 0]] as [number, number][],
}))

beforeEach(() => {
  kmeans.finish = null
  kmeans.input = null
  kmeans.width = 2
  kmeans.points = [[0, 0]]
})

vi.mock('../useZarrIonImage', async () => {
  const { ref } = await import('vue')
  return { dataModeRef: ref(null) }
})
vi.mock('@/services/zarr/api/zarrAccessApi', () => ({
  getZarrUrl: async () => 'https://cdn.test/run.zarr/',
}))
vi.mock('@/services/clustering/clusteringZarrStore', () => ({
  ClusteringZarrStore: class {
    async init() {}
    async loadUmap() {
      const { width, points } = kmeans
      return {
        image: { data: new Uint8Array(width * 3), height: 1, width, channels: 3 },
        embedding: {
          coordinates: Uint32Array.from(points.flat()),
          scaledEmbedding: new Float32Array(points.length * 3),
          count: points.length,
        },
      }
    }
    dispose() {}
  },
}))
vi.mock('@/features/vizworkbench/utils/kmeans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/vizworkbench/utils/kmeans')>()),
  preloadKmeans: () => {},
  computeKmeansFromUmap: (input: KmeansEmbeddingInput) => {
    kmeans.input = input
    return new Promise((finish) => (kmeans.finish = finish))
  },
}))

describe('useOverlayData local KMeans', () => {
  it('publishes only the latest set of regions and shares that result’s labels', async () => {
    let api!: ReturnType<typeof useOverlayData>
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useOverlayData(ref('run-a'), ref(1), ref(2))
          return () => null
        },
      }),
    )
    const publish = async (labels: Int32Array) => {
      kmeans.finish = null
      const running = api.runKmeans(2)
      await vi.waitFor(() => expect(kmeans.finish).not.toBeNull())
      kmeans.finish!({ rgb: new Uint8Array(3 * labels.length), labels })
      expect(await running).toBe(true)
    }

    try {
      const first = Int32Array.of(0, -1)
      await publish(first)
      const oldId = api.kmeansRegions.value[0]!.id
      expect(api.kmeansRegions.value[0]).toMatchObject({ kind: 'kmeans', clusterId: 0 })

      const updated = Int32Array.of(0, 1)
      await publish(updated)
      const regions = api.kmeansRegions.value
      expect(regions).toHaveLength(2)
      expect(regions.map((region) => region.id)).not.toContain(oldId)
      expect(regions.every((region) => region.kind === 'kmeans' && region.labels === updated)).toBe(
        true,
      )
      expect(api.getKmeansLabels()).toBe(updated)
    } finally {
      wrapper.unmount()
    }
  })

  it('drops a result that finishes after the run changed', async () => {
    kmeans.finish = null
    const runId = ref('run-a')
    let api!: ReturnType<typeof useOverlayData>
    mount(
      defineComponent({
        setup() {
          api = useOverlayData(runId, ref(1), ref(1))
          return () => null
        },
      }),
    )

    const running = api.runKmeans(2)
    await vi.waitFor(() => expect(kmeans.finish).not.toBeNull())
    runId.value = 'run-b'
    await nextTick()
    kmeans.finish!({ rgb: new Uint8Array(3), labels: Int32Array.of(0) })

    expect(await running).toBe(false)
    expect(api.kmeansLabelsAvailable.value).toBe(false)
    expect(api.kmeansClusters.value).toEqual([])
    expect(api.kmeansVisible.value).toBe(false)
  })

  it('clusters only the points inside the chosen ROI and remembers that scope', async () => {
    kmeans.width = 3
    kmeans.points = [
      [0, 0],
      [1, 0],
      [2, 0],
    ]
    let api!: ReturnType<typeof useOverlayData>
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useOverlayData(ref('run-a'), ref(1), ref(3))
          return () => null
        },
      }),
    )
    try {
      // A single point cannot be clustered, so the worker is never asked.
      expect(await api.runKmeans(2, { mask: Uint8Array.of(1, 0, 0), label: 'ROI 1' })).toBe(false)
      expect(kmeans.input).toBeNull()
      expect(api.kmeansScope.value).toBeNull()

      const scope = { mask: Uint8Array.of(0, 1, 1), label: 'ROI 2' }
      const running = api.runKmeans(2, scope)
      await vi.waitFor(() => expect(kmeans.finish).not.toBeNull())
      expect(kmeans.input!.count).toBe(2)
      expect(Array.from(kmeans.input!.coordinates)).toEqual([1, 0, 2, 0])
      kmeans.finish!({ rgb: new Uint8Array(9), labels: Int32Array.of(-1, 0, 1) })

      expect(await running).toBe(true)
      expect(api.kmeansScope.value).toBe(scope)
      expect(api.kmeansClusters.value.map((cluster) => cluster.count)).toEqual([1, 1])
    } finally {
      wrapper.unmount()
    }
  })
})
