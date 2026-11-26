import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type Ref } from 'vue'
import { mzAxisRef, resetZarrSharedState, setZarrStore } from '@/services/zarr/zarrSharedState'
import type { Region, RegionGrid } from '@/features/vizworkbench/utils/region'
import { useRegionComparison } from '../useRegionComparison'

const GRID: RegionGrid = { runId: 'test-run', shape: [2, 2] }

function makeRoi(id: string, name: string, mask = Uint8Array.of(1, 0, 0, 0)): Region {
  return { id, kind: 'roi', label: name, color: 'rgb(86,180,233)', grid: GRID, mask }
}

function setup(regions: Ref<Region[]>, grid = ref(GRID)) {
  let api!: ReturnType<typeof useRegionComparison>
  // onScopeDispose 在无活动 scope 时会告警，套一层 effectScope 消掉
  effectScope().run(() => {
    api = useRegionComparison({ regions, grid, dataMode: ref(null) })
  })
  return api
}

describe('useRegionComparison · ROI masks', () => {
  it('allows comparing one ROI against another', () => {
    const api = setup(ref([makeRoi('roi-1', 'tumor'), makeRoi('roi-2', 'normal')]))

    api.regionAIds = ['roi-1']
    api.regionBIds = ['roi-2']
    expect(api.canCompare).toBe(true)

    // 同一区域不能同时进 A/B 两组（与 ROI / KMeans 一致的规则）
    api.regionBIds = ['roi-1']
    expect(api.canCompare).toBe(false)
  })

  it('drops selections of removed ROIs instead of keeping stale ids', async () => {
    const regions = ref<Region[]>([makeRoi('roi-1', 'tumor'), makeRoi('roi-2', 'normal')])
    const api = setup(regions)

    api.regionAIds = ['roi-1']
    api.regionBIds = ['roi-2']

    // 删除一个 ROI 后，指向它的选择应被清理；未删除的保留
    regions.value = regions.value.filter((region) => region.id !== 'roi-1')
    await nextTick()
    expect(api.regionAIds).toEqual([])
    expect(api.regionBIds).toEqual(['roi-2'])
  })

  describe('scanning', () => {
    afterEach(() => {
      setZarrStore(null)
      resetZarrSharedState()
    })

    const stats = (value: number) => ({
      sum: Float64Array.of(value),
      count: Int32Array.of(value > 0 ? 2 : 0),
    })

    function installStore(
      scan: (cancelled: () => boolean) => Promise<unknown> = async () => [stats(2), stats(0)],
    ) {
      setZarrStore({
        spatialShape: GRID.shape,
        buildPixelMask: async () => ({ mask: new Uint8Array(4), pixelCount: 2 }),
        streamRegionStatsBySpectra: (
          _masks: unknown,
          _progress: unknown,
          cancelled: () => boolean,
        ) => scan(cancelled),
      } as never)
      mzAxisRef.value = Float64Array.of(100)
    }

    async function compared(regions: Ref<Region[]>) {
      installStore()
      const api = setup(regions)
      api.regionAIds = ['a']
      api.regionBIds = ['b']
      await api.compare()
      expect(api.results).toHaveLength(1)
      return api
    }

    it('does not let an abandoned scan overwrite the comparison that replaced it', async () => {
      const scans: { finish: (result: unknown) => void; cancelled: () => boolean }[] = []
      installStore((cancelled) => new Promise((finish) => scans.push({ finish, cancelled })))
      const api = setup(ref([makeRoi('a', 'A'), makeRoi('b', 'B')]))
      api.regionAIds = ['a']
      api.regionBIds = ['b']

      const abandoned = api.compare()
      await vi.waitFor(() => expect(scans).toHaveLength(1))
      api.cancel()
      const current = api.compare()
      await vi.waitFor(() => expect(scans).toHaveLength(2))
      expect(scans[0]!.cancelled()).toBe(true)
      expect(scans[1]!.cancelled()).toBe(false)

      scans[0]!.finish([stats(9), stats(9)])
      await abandoned
      expect(api.results).toEqual([])
      expect(api.comparing).toBe(true)

      scans[1]!.finish([stats(2), stats(0)])
      await current
      expect(api.results).toHaveLength(1)
      expect(api.comparing).toBe(false)
    })

    it('drops the results once a compared region is gone, but not for other regions', async () => {
      const regions = ref([makeRoi('a', 'A'), makeRoi('b', 'B'), makeRoi('c', 'C')])
      const api = await compared(regions)

      regions.value = regions.value.filter((region) => region.id !== 'c')
      await nextTick()
      expect(api.results).toHaveLength(1)

      regions.value = regions.value.filter((region) => region.id !== 'a')
      await nextTick()
      expect(api.results).toEqual([])
      expect(api.filterStats.total).toBe(0)
    })
  })
})
