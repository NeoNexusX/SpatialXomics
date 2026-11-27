import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MaskExportPanel from '../MaskExportPanel.vue'
import type { KmeansRegion, RegionGrid, RoiRegion } from '@/features/vizworkbench/utils/region'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))

const GRID: RegionGrid = { runId: '', shape: [1, 1] }

function roi(id: string, label: string): RoiRegion {
  return { id, kind: 'roi', label, color: '#e11d48', grid: GRID, mask: Uint8Array.of(1) }
}

function cluster(id: number): KmeansRegion {
  return {
    id: `kmeans:1:${id}`,
    kind: 'kmeans',
    clusterId: id,
    label: `Cluster ${id}`,
    color: 'rgb(0,0,0)',
    grid: GRID,
    labels: Int32Array.of(id),
  }
}

const ROIS = [roi('a', 'ROI 1'), roi('b', 'ROI 2')]
const CLUSTERS = [cluster(0), cluster(1), cluster(2)]

type Props = InstanceType<typeof MaskExportPanel>['$props']

function mountPanel(over: Partial<Props> = {}) {
  return mount(MaskExportPanel, {
    props: {
      // Clusters come first in the page's region list.
      regions: [...CLUSTERS, ...ROIS],
      selectedRoiIds: null,
      kmeansVisible: true,
      selectedKmeansIds: null,
      ...over,
    },
    global: { plugins: [i18n] },
  })
}

const names = (w: ReturnType<typeof mountPanel>) => w.findAll('li').map((li) => li.text())
const exportButton = (w: ReturnType<typeof mountPanel>) =>
  w.findAll('button').find((b) => b.text() === 'Export mask')!

describe('MaskExportPanel', () => {
  it('lists the ROIs, then the clusters, to export by name without checkboxes', () => {
    const w = mountPanel({
      selectedRoiIds: new Set(['b', 'deleted']),
      selectedKmeansIds: new Set([2]),
    })
    expect(names(w)).toEqual(['ROI 2', 'Cluster 2'])
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('leaves clusters out while the KMeans overlay is hidden', async () => {
    const w = mountPanel({ kmeansVisible: false })
    expect(names(w)).toEqual(['ROI 1', 'ROI 2'])

    await exportButton(w).trigger('click')
    expect(w.emitted('export-masks')).toEqual([['npz', ROIS]])
  })

  it('exports the listed ROIs and clusters in the chosen format', async () => {
    const w = mountPanel({ selectedKmeansIds: new Set([0, 2]) })
    await w
      .findAll('button')
      .find((b) => b.text() === '.csv')!
      .trigger('click')
    await exportButton(w).trigger('click')
    expect(w.emitted('export-masks')).toEqual([['csv', [...ROIS, CLUSTERS[0], CLUSTERS[2]]]])
  })

  it('hands the picked mask files to the parent, which adds them as ROIs', async () => {
    const w = mountPanel()
    const files = [new File(['x'], 'tumor.npz'), new File(['y'], 'normal.csv')]
    const input = w.get<HTMLInputElement>('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: files })
    await input.trigger('change')
    expect(w.emitted('import-masks')).toEqual([[files]])
  })

  it('disables export when the list is empty', async () => {
    const none = mountPanel({ selectedRoiIds: new Set(), kmeansVisible: false })
    expect(names(none)).toEqual([])
    expect(exportButton(none).attributes('disabled')).toBeDefined()
    await exportButton(none).trigger('click')
    expect(none.emitted('export-masks')).toBeUndefined()

    const empty = mountPanel({ regions: [] })
    expect(names(empty)).toEqual([])
    expect(exportButton(empty).attributes('disabled')).toBeDefined()
  })
})
