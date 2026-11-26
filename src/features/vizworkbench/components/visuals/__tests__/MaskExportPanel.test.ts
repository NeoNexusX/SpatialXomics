import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MaskExportPanel from '../MaskExportPanel.vue'
import type { ImportedMask } from '@/features/vizworkbench/composables/useImportedMasks'
import type { ConfirmedROI } from '@/features/vizworkbench/composables/useROI'
import type { KmeansCluster } from '@/features/vizworkbench/composables/useOverlayData'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))

function roi(id: string, label: string): ConfirmedROI {
  return {
    id,
    type: 'rectangle',
    label,
    color: '#e11d48',
    mask: Uint8Array.of(1),
    shape: [1, 1],
    pixelCount: 1,
    stats: null,
    spectrum: null,
  }
}

function cluster(id: number): KmeansCluster {
  return { id, color: [0, 0, 0], count: 10 }
}

type Props = InstanceType<typeof MaskExportPanel>['$props']

function mountPanel(over: Partial<Props> = {}) {
  return mount(MaskExportPanel, {
    props: {
      rois: [roi('a', 'ROI 1'), roi('b', 'ROI 2')],
      selectedRoiIds: null,
      kmeansClusters: [cluster(0), cluster(1), cluster(2)],
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
  it('lists the regions to export by name, without checkboxes', () => {
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
    expect(w.find('p').exists()).toBe(false)

    await exportButton(w).trigger('click')
    expect(w.emitted('export-masks')).toEqual([
      [{ format: 'npz', roiIds: ['a', 'b'], clusterIds: [] }],
    ])
  })

  it('exports the listed ROIs and clusters in the chosen format', async () => {
    const w = mountPanel({ selectedKmeansIds: new Set([0, 2]) })
    await w
      .findAll('button')
      .find((b) => b.text() === '.csv')!
      .trigger('click')
    await exportButton(w).trigger('click')
    expect(w.emitted('export-masks')).toEqual([
      [{ format: 'csv', roiIds: ['a', 'b'], clusterIds: [0, 2] }],
    ])
  })

  it('manages imported masks independently of the export list', async () => {
    const imported: ImportedMask = {
      id: 'import-1',
      name: 'tissue.npz',
      format: 'npz',
      color: '#56b4e9',
      mask: new Uint8Array([1]),
      shape: [1, 1],
      summary: { name: 'tissue.npz', pixelCount: 1, format: 'npz', stats: null },
      active: true,
    }
    const w = mountPanel({ importedMasks: [imported], kmeansVisible: false })
    expect(names(w)).toEqual(['ROI 1', 'ROI 2'])
    expect(w.text()).toContain('tissue.npz')
    expect(w.text()).toContain('1/1')

    await w.get('input[type="checkbox"]').setValue(false)
    expect(w.emitted('toggle-imported-mask')).toEqual([['import-1']])
    await w.setProps({ importedMasks: [{ ...imported, active: false }] })
    expect(w.text()).toContain('0/1')

    await w.get('button[title="Remove this mask"]').trigger('click')
    expect(w.emitted('remove-imported-mask')).toEqual([['import-1']])
  })

  it('disables export when the list is empty', () => {
    const none = mountPanel({ selectedRoiIds: new Set(), kmeansVisible: false })
    expect(names(none)).toEqual([])
    expect(none.find('p').exists()).toBe(false)
    expect(exportButton(none).attributes('disabled')).toBeDefined()

    const empty = mountPanel({ rois: [], kmeansClusters: [] })
    expect(empty.find('p').exists()).toBe(false)
    expect(exportButton(empty).attributes('disabled')).toBeDefined()
  })
})
