import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { buildMaskExport } from '../../utils/maskExport'
import { useResultROI } from '../useResultROI'

// Import validation takes [rows, cols]; every mask here is a 2×3 raster.
const W = 3
const H = 2

function setup() {
  const matrix = ref<Float32Array | null>(new Float32Array(W * H).fill(2))
  return { ...useResultROI(matrix, ref(W), ref(H)), matrix }
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
    const { importRois, confirmedROIs, selectedRoiIds } = setup()
    const { imported, failed } = await importRois(
      [await maskFile(['010', '000'], 'tumor.npz'), await maskFile(['000', '001'], 'normal.npz')],
      'colon_2024',
    )

    expect(imported).toEqual(['tumor.npz', 'normal.npz'])
    expect(failed).toEqual([])
    expect(confirmedROIs.value.map(({ label, type }) => ({ label, type }))).toEqual([
      { label: 'tumor', type: 'imported' },
      { label: 'normal', type: 'imported' },
    ])
    expect(Array.from(confirmedROIs.value[1]!.mask)).toEqual([0, 0, 0, 0, 0, 1])
    expect(new Set(confirmedROIs.value.map((roi) => roi.color)).size).toBe(2)
    expect(selectedRoiIds.value).toBeNull()
  })

  it('keeps the valid files when others in the batch fail', async () => {
    const { importRois, confirmedROIs } = setup()
    const { imported, failed } = await importRois(
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
    expect(confirmedROIs.value.map((roi) => roi.label)).toEqual(['good'])
  })

  it('freezes the statistics at import time and filters the ROI-only view', async () => {
    const { importRois, confirmedROIs, matrix, viewingROI, displayMatrix } = setup()
    await importRois([await maskFile(['010', '000'], 'a.csv.npz')], 'colon_2024')
    const [roi] = confirmedROIs.value
    expect(roi!.label).toBe('a.csv')
    expect(roi!.stats).toMatchObject({ mean: 2, std: 0, min: 2, max: 2, pixelCount: 1 })

    matrix.value = new Float32Array(W * H).fill(9)
    expect(confirmedROIs.value[0]!.stats).toMatchObject({ mean: 2 })
    viewingROI.value = true
    expect(Array.from(displayMatrix.value!)).toEqual([0, 9, 0, 0, 0, 0])
  })
})
