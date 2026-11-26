import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { mzAxisRef, resetZarrSharedState, setZarrStore } from '@/services/zarr/zarrSharedState'
import type { Region } from '@/features/vizworkbench/utils/region'
import { useRegionComparison } from '../useRegionComparison'

function makeRoi(id: string, name: string): Region {
  return {
    id: `roi:${id}`,
    kind: 'roi',
    sourceId: id,
    label: name,
    pixelCount: 1,
    grid: { runId: 'test-run', shape: [2, 2] },
    mask: new Uint8Array(4),
    color: 'rgb(86,180,233)',
  }
}

function setup(rois: Region[]) {
  let api!: ReturnType<typeof useRegionComparison>
  // onScopeDispose 在无活动 scope 时会告警，套一层 effectScope 消掉
  effectScope().run(() => {
    api = useRegionComparison({
      regions: ref(rois),
      runId: ref('test-run'),
      dataMode: ref(null),
      onSelectMzIndex: () => {},
    })
  })
  return api
}

describe('useRegionComparison · ROI masks', () => {
  it('lists every ROI as a selectable region', () => {
    const api = setup([makeRoi('roi-1', 'tumor'), makeRoi('roi-2', 'normal')])

    const regions = api.availableRegions.value
    const rois = regions.filter((r) => r.kind === 'roi')
    expect(rois.map((r) => r.id)).toEqual(['roi:roi-1', 'roi:roi-2'])
    expect(rois.map((r) => r.label)).toEqual(['tumor', 'normal'])
    expect(rois.every((r) => r.color === 'rgb(86,180,233)')).toBe(true)
  })

  it('allows comparing one ROI against another', () => {
    const api = setup([makeRoi('roi-1', 'tumor'), makeRoi('roi-2', 'normal')])

    api.regionAIds.value = ['roi:roi-1']
    api.regionBIds.value = ['roi:roi-2']
    expect(api.canCompare.value).toBe(true)

    // 同一区域不能同时进 A/B 两组（与 ROI / KMeans 一致的规则）
    api.regionBIds.value = ['roi:roi-1']
    expect(api.canCompare.value).toBe(false)
  })

  it('drops selections of removed ROIs instead of keeping stale ids', async () => {
    const masks = ref<Region[]>([makeRoi('roi-1', 'tumor'), makeRoi('roi-2', 'normal')])
    let api!: ReturnType<typeof useRegionComparison>
    effectScope().run(() => {
      api = useRegionComparison({
        regions: masks,
        runId: ref('test-run'),
        dataMode: ref(null),
        onSelectMzIndex: () => {},
      })
    })

    api.regionAIds.value = ['roi:roi-1']
    api.regionBIds.value = ['roi:roi-2']

    // 删除一个 ROI 后，指向它的选择应被清理；未删除的保留
    masks.value = masks.value.filter((m) => m.id !== 'roi:roi-1')
    await nextTick()
    expect(api.regionAIds.value).toEqual([])
    expect(api.regionBIds.value).toEqual(['roi:roi-2'])
  })

  describe('cancelling', () => {
    afterEach(() => {
      setZarrStore(null)
      resetZarrSharedState()
    })

    const stats = (value: number) => ({
      sum: Float64Array.of(value),
      count: Int32Array.of(value > 0 ? 2 : 0),
    })

    it('does not let an abandoned scan overwrite the comparison that replaced it', async () => {
      const scans: { finish: (result: unknown) => void; cancelled: () => boolean }[] = []
      setZarrStore({
        spatialShape: [2, 2],
        buildPixelMask: async () => ({ mask: new Uint8Array(4), pixelCount: 2 }),
        streamRegionStatsBySpectra: (
          _masks: unknown,
          _progress: unknown,
          cancelled: () => boolean,
        ) => new Promise((finish) => scans.push({ finish, cancelled })),
      } as never)
      mzAxisRef.value = Float64Array.of(100)
      const api = setup([makeRoi('a', 'A'), makeRoi('b', 'B')])
      api.regionAIds.value = ['roi:a']
      api.regionBIds.value = ['roi:b']

      const abandoned = api.compare()
      await vi.waitFor(() => expect(scans).toHaveLength(1))
      api.reset()
      const current = api.compare()
      await vi.waitFor(() => expect(scans).toHaveLength(2))
      expect(scans[0]!.cancelled()).toBe(true)
      expect(scans[1]!.cancelled()).toBe(false)

      scans[0]!.finish([stats(9), stats(9)])
      await abandoned
      expect(api.results.value).toEqual([])
      expect(api.comparing.value).toBe(true)

      scans[1]!.finish([stats(2), stats(0)])
      await current
      expect(api.results.value).toHaveLength(1)
      expect(api.comparing.value).toBe(false)
    })
  })
})
