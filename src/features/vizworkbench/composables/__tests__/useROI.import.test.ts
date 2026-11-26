import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { buildMaskExport } from '../../utils/maskExport'
import { useROI } from '../useROI'

// Import validation takes [rows, cols]; every mask here is a 2×3 raster.
const W = 3
const H = 2

function setup() {
  const matrix = ref<Float32Array | null>(new Float32Array(W * H).fill(2))
  const state = useROI(matrix, ref({ runId: '', shape: [H, W] as const }))
  return { state, matrix }
}

/** Export a raster of '0'/'1' rows to an .npz File, as the file input hands it over. */
async function maskFile(rows: string[], name: string, datasetName = 'colon_2024') {
  const raster = rows.map((row) => [...row].map((ch) => ch === '1'))
  const exported = await buildMaskExport(raster, 'npz', {
    datasetName,
    pixelSizeUm: { x: 10, y: 10 },
  })
  return new File([exported.bytes], name)
}

describe('importing mask files as ROIs', () => {
  it('adds every file of a batch as an ROI named after the file', async () => {
    const { state } = setup()
    const { imported, failed } = await state.importRois(
      [await maskFile(['010', '000'], 'tumor.npz'), await maskFile(['000', '001'], 'normal.npz')],
      'colon_2024',
    )

    expect(imported).toEqual(['tumor.npz', 'normal.npz'])
    expect(failed).toEqual([])
    expect(state.confirmedROIs.map(({ label, type }) => ({ label, type }))).toEqual([
      { label: 'tumor', type: 'imported' },
      { label: 'normal', type: 'imported' },
    ])
    expect(Array.from(state.confirmedROIs[1]!.mask)).toEqual([0, 0, 0, 0, 0, 1])
    expect(new Set(state.confirmedROIs.map((roi) => roi.color)).size).toBe(2)
    expect(state.selectedRoiIds).toBeNull()
  })

  it('keeps the valid files when others in the batch fail', async () => {
    const { state } = setup()
    const { imported, failed } = await state.importRois(
      [
        await maskFile(['010', '000'], 'good.npz'),
        new File(['not a mask'], 'bad.csv'),
        await maskFile(['010', '000'], 'foreign.npz', 'brain_2023'),
        await maskFile(['000', '000'], 'empty.npz'),
      ],
      'colon_2024',
    )

    expect(imported).toEqual(['good.npz'])
    expect(failed.map((f) => f.name)).toEqual(['bad.csv', 'foreign.npz', 'empty.npz'])
    expect(failed[1]!.error).toContain('dataset')
    expect(failed[2]!.error).toContain('no pixels')
    expect(state.confirmedROIs.map((roi) => roi.label)).toEqual(['good'])
  })

  it('freezes the statistics at import time and joins the ROI-only view', async () => {
    const { state, matrix } = setup()
    await state.importRois([await maskFile(['010', '000'], 'a.csv.npz')], 'colon_2024')
    const [roi] = state.confirmedROIs
    expect(roi!.label).toBe('a.csv')
    expect(roi!.pixelCount).toBe(1)
    expect(roi!.stats).toEqual({ mean: 2, std: 0, min: 2, max: 2 })

    matrix.value = new Float32Array(W * H).fill(9)
    expect(state.confirmedROIs[0]!.stats).toMatchObject({ mean: 2 })
    state.viewingROI = true
    expect(Array.from(state.roiUnionMask!)).toEqual([0, 1, 0, 0, 0, 0])
  })
})
