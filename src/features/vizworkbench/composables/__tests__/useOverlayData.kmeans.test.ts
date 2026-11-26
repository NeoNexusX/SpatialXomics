import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useOverlayData } from '../useOverlayData'

const kmeans = vi.hoisted(() => ({ finish: null as ((result: unknown) => void) | null }))

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
      return {
        image: { data: new Uint8Array(6), height: 1, width: 2, channels: 3 },
        embedding: {
          coordinates: new Uint32Array(2),
          scaledEmbedding: new Float32Array(3),
          count: 1,
        },
      }
    }
    dispose() {}
  },
}))
vi.mock('@/features/vizworkbench/utils/kmeans', () => ({
  preloadKmeans: () => {},
  computeKmeansFromUmap: () => new Promise((finish) => (kmeans.finish = finish)),
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
})
