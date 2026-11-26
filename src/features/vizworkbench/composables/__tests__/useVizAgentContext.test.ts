import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { mount } from '@vue/test-utils'
import {
  getSelectedIon,
  hasAnnotationContext,
  registerContextProviders,
  unregisterContextProviders,
} from '@/features/agent/bridge/analysisContext'
import {
  metadataAttrsRef,
  pixelSpectrum,
  resetZarrSharedState,
  spectrumView,
} from '@/services/zarr/zarrSharedState'
import type { MetadataAttrs, PixelSpectrum } from '@/services/zarr/types/zarr'
import {
  useVizAgentContext,
  vizContextProviders,
  type VizContextSources,
} from '../useVizAgentContext'

afterEach(() => {
  unregisterContextProviders()
  resetZarrSharedState()
})

/** A loaded 2 × 1 continuous image with two saved ROIs (one imported, one selected). */
function sources(over: { [K in keyof VizContextSources]?: Record<string, unknown> } = {}) {
  const parts = {
    zarr: {
      imageMatrix: Float32Array.of(1, 2),
      isProcessed: false,
      selectedMz: 445.05,
      mzTolerance: 0.01,
      ionCols: 2,
      ionRows: 1,
      dataMode: 'continuous',
    },
    display: {
      colormap: 'inferno',
      intensityScale: 'linear',
      gamma: 1,
      displayMin: 0,
      displayMax: 2,
      globalMin: 0,
      globalMax: 2,
      imageInfo: { pixels: '2 × 1', nonZero: '100.0%', totalIon: '3.00e+0' },
    },
    meta: {
      datasetName: 'kidney',
      status: 'completed',
      acquisition: { polarity: 'negative' },
      sourceFile: null,
      methods: ['tic'],
      pixelSize: '10 × 10 µm',
    },
    multiIon: {
      enabled: true,
      overlayActive: true,
      channels: [
        { id: 1, mz: 500, color: { r: 1, g: 2, b: 3 }, visible: true, loading: false, error: null },
      ],
    },
    roi: {
      confirmedROIs: [
        { id: 'roi-1', type: 'rectangle' },
        { id: 'roi-2', type: 'imported' },
      ],
      isRoiSelected: (id: string) => id === 'roi-2',
    },
    clustering: {
      kmeansClusters: [],
      kmeansK: null,
      kmeansComputing: false,
      selectedKmeansIds: null,
      kmeansLabelsAvailable: false,
      kmeansVisible: false,
      clusteringReady: true,
      umapVisible: false,
      clusteringComputing: false,
      overlayError: null,
      getKmeansLabels: () => null,
      getKmeansRgb: () => null,
      getOverlayDims: () => null,
      getUmapRgb: () => null,
      getUmapOccupancyMask: () => null,
    },
  }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parts)) {
    result[key] = reactive({ ...value, ...over[key as keyof VizContextSources] })
  }
  return result as unknown as VizContextSources
}

describe('vizContextProviders', () => {
  it('reports no ion before an image loads', () => {
    const providers = vizContextProviders(sources({ zarr: { imageMatrix: null } }))
    expect(providers.selectedIon()).toBeNull()
  })

  it('describes the shown ion with its display, spectrum, channels and ROIs', () => {
    spectrumView.value = 'pixel'
    pixelSpectrum.value = { x: 1, y: 0 } as PixelSpectrum
    const ion = vizContextProviders(sources()).selectedIon()!
    expect(ion).toMatchObject({ mz: 445.05, tolerance: 0.01, width: 2, height: 1 })
    expect(ion.view).toMatchObject({
      dataMode: 'continuous',
      display: { colormap: 'inferno', displayMax: 2 },
      spectrum: { view: 'pixel', selectedPixel: { x: 1, y: 0 } },
      channels: {
        enabled: true,
        overlayActive: true,
        list: [{ id: 1, mz: 500, color: [1, 2, 3], opacity: 1 }],
      },
      roi: { confirmed: 2, selected: 1 },
      masks: { imported: 1 },
    })
  })

  it('reports the TIC image of processed data without an m/z', () => {
    const ion = vizContextProviders(
      sources({ zarr: { isProcessed: true, dataMode: 'processed' } }),
    ).selectedIon()!
    expect(ion).toMatchObject({ mz: 0, tolerance: 0 })
    expect(ion.view).toMatchObject({ mz: 0, tolerance: 0, dataMode: 'processed' })
  })

  it('reports no KMeans before a run and lists every cluster while all are selected', () => {
    expect(vizContextProviders(sources()).kmeans()).toBeNull()

    const clusters = [
      { id: 0, color: [1, 1, 1], count: 4 },
      { id: 1, color: [2, 2, 2], count: 6 },
    ]
    const all = vizContextProviders(
      sources({ clustering: { kmeansClusters: clusters, kmeansK: 2 } }),
    )
    expect(all.kmeans()).toMatchObject({ k: 2, clusterSizes: [4, 6], selectedIds: [0, 1] })

    const picked = vizContextProviders(
      sources({
        clustering: { kmeansClusters: clusters, kmeansK: 2, selectedKmeansIds: new Set([1]) },
      }),
    )
    expect(picked.kmeans()?.selectedIds).toEqual([1])
  })

  it('reports the dataset panel and leaves out statistics that are not there yet', () => {
    metadataAttrsRef.value = { name: 'kidney' } as MetadataAttrs
    const info = vizContextProviders(
      sources({
        display: { imageInfo: { pixels: '--', nonZero: '--', totalIon: '--' } },
        meta: { pixelSize: '' },
      }),
    ).datasetInfo()
    expect(info).toMatchObject({
      attrs: { name: 'kidney' },
      acquisition: { polarity: 'negative' },
      methods: ['tic'],
      imageInfo: { pixels: null, nonZero: null, totalIon: null, pixelSize: null },
    })

    const unnamed = sources({ meta: { datasetName: '', sourceFile: null } })
    expect(vizContextProviders(unnamed).datasetInfo()).toBeNull()
  })

  it('reports the page header', () => {
    expect(vizContextProviders(sources()).pageHeader()).toEqual({
      datasetName: 'kidney',
      status: 'completed',
    })
  })
})

describe('useVizAgentContext', () => {
  it('registers the page providers and removes only those on unmount', () => {
    registerContextProviders({ annotations: () => ({ count: 0, rows: () => [] }) })
    const page = mount(
      defineComponent({
        setup() {
          useVizAgentContext(sources())
          return () => null
        },
      }),
    )
    expect(getSelectedIon()?.mz).toBe(445.05)

    page.unmount()
    expect(getSelectedIon()).toBeNull()
    expect(hasAnnotationContext()).toBe(true)
  })
})
