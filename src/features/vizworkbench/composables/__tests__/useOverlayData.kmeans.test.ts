import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { loadCoreMessages, loadFeatureMessages } from '@/i18n'
import { useToast } from '@/shared/composables/useToast'
import { useOverlayData } from '../useOverlayData'
import type { KmeansEmbeddingInput } from '@/features/vizworkbench/utils/kmeans'

// UMAP grid is 1 × width; `points` are the embedded (x, y) cells.
const kmeans = vi.hoisted(() => ({
  finish: null as ((result: unknown) => void) | null,
  input: null as KmeansEmbeddingInput | null,
  width: 2,
  points: [[0, 0]] as [number, number][],
}))

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))
enableAutoUnmount(afterEach)

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
    mount(
      defineComponent({
        setup() {
          api = useOverlayData('run-a', ref(1), ref(2))
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

    const first = Int32Array.of(0, -1)
    await publish(first)
    const oldId = api.kmeansRegions[0]!.id
    expect(api.kmeansRegions[0]).toMatchObject({
      kind: 'kmeans',
      clusterId: 0,
      label: 'Cluster 0',
    })

    const updated = Int32Array.of(0, 1)
    await publish(updated)
    const regions = api.kmeansRegions
    expect(regions).toHaveLength(2)
    expect(regions.map((region) => region.id)).not.toContain(oldId)
    expect(regions.every((region) => region.labels === updated)).toBe(true)
    expect(api.getKmeansLabels()).toBe(updated)
    expect(api.kmeansK).toBe(2)
  })

  it('drops a result that finishes after the page unmounted', async () => {
    kmeans.finish = null
    let api!: ReturnType<typeof useOverlayData>
    const page = mount(
      defineComponent({
        setup() {
          api = useOverlayData('run-a', ref(1), ref(1))
          return () => null
        },
      }),
    )

    const running = api.runKmeans(2)
    await vi.waitFor(() => expect(kmeans.finish).not.toBeNull())
    page.unmount()
    kmeans.finish!({ rgb: new Uint8Array(3), labels: Int32Array.of(0) })

    expect(await running).toBe(false)
    expect(api.kmeansLabelsAvailable).toBe(false)
    expect(api.kmeansClusters).toEqual([])
    expect(api.kmeansVisible).toBe(false)
  })

  it('clusters only the points inside the chosen ROI and remembers that scope', async () => {
    kmeans.width = 3
    kmeans.points = [
      [0, 0],
      [1, 0],
      [2, 0],
    ]
    let api!: ReturnType<typeof useOverlayData>
    mount(
      defineComponent({
        setup() {
          api = useOverlayData('run-a', ref(1), ref(3))
          return () => null
        },
      }),
    )
    const { toasts } = useToast()

    // A single point cannot be clustered, so the worker is never asked.
    expect(await api.runKmeans(2, { mask: Uint8Array.of(1, 0, 0), label: 'ROI 1' })).toBe(false)
    expect(kmeans.input).toBeNull()
    expect(api.kmeansScope).toBeNull()
    expect(toasts.value[toasts.value.length - 1]).toMatchObject({
      type: 'warning',
      message: 'The selected ROI has fewer than 2 pixels to cluster',
    })

    const scope = { mask: Uint8Array.of(0, 1, 1), label: 'ROI 2' }
    const running = api.runKmeans(2, scope)
    await vi.waitFor(() => expect(kmeans.finish).not.toBeNull())
    expect(kmeans.input!.count).toBe(2)
    expect(Array.from(kmeans.input!.coordinates)).toEqual([1, 0, 2, 0])
    kmeans.finish!({ rgb: new Uint8Array(9), labels: Int32Array.of(-1, 0, 1) })

    expect(await running).toBe(true)
    expect(api.kmeansScope).toBe(scope)
    expect(api.kmeansClusters.map((cluster) => cluster.count)).toEqual([1, 1])
  })
})
