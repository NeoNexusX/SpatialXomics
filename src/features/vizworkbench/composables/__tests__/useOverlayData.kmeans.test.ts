import { describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useOverlayData } from '../useOverlayData'

const kmeans = vi.hoisted(() => ({ finish: null as ((result: unknown) => void) | null }))

vi.mock('../useZarrIonImage', async () => {
  const { ref } = await import('vue')
  return { dataModeRef: ref(null) }
})
vi.mock('@/services/zarr/api/zarrAccessApi', () => ({ getZarrAccess: async () => ({}) }))
vi.mock('@/services/clustering/clusteringZarrStore', () => ({
  ClusteringZarrStore: class {
    async init() {}
    async loadUmap() {
      return {
        image: { data: new Uint8Array(3), height: 1, width: 1, channels: 3 },
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
  it('drops a result that finishes after the run changed', async () => {
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
