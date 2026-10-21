import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { buildMaskExport } from '../../utils/maskExport'
import { useImportedMasks } from '../useImportedMasks'

// 与导入校验一致：expectedShape 是 [rows, cols]，这里统一用 2×3 栅格。
const W = 3
const H = 2

/** Build a boolean raster from strings of '0'/'1'. */
function maskOf(rows: string[]): boolean[][] {
  return rows.map((r) => [...r].map((ch) => ch === '1'))
}

function setup(datasetName = 'colon_2024') {
  const matrix = ref<Float32Array | null>(new Float32Array(W * H).fill(2))
  const api = useImportedMasks({
    ionCols: ref(W),
    ionRows: ref(H),
    datasetName: ref(datasetName),
    matrix,
  })
  return { api, matrix }
}

/** Export a raster to .npz bytes wrapped in a File, as the file input hands it over. */
async function maskFile(rows: string[], name: string, datasetName = 'colon_2024'): Promise<File> {
  const exported = await buildMaskExport(maskOf(rows), 'npz', {
    datasetName,
    pixelSizeUm: { x: 10, y: 10 },
  })
  return new File([exported.bytes], name)
}

describe('useImportedMasks', () => {
  it('imports multiple masks in one batch and keeps them all', async () => {
    const { api } = setup()
    const { imported, failed } = await api.importMaskFiles([
      await maskFile(['010', '000'], 'a.npz'),
      await maskFile(['000', '001'], 'b.npz'),
    ])

    expect(imported).toEqual(['a.npz', 'b.npz'])
    expect(failed).toHaveLength(0)
    expect(api.importedMasks.value.map((m) => m.name)).toEqual(['a.npz', 'b.npz'])
    // 新导入默认全部生效，且各自拿到不同的稳定 id / 颜色
    expect(api.importedMasks.value.every((m) => m.active)).toBe(true)
    const ids = new Set(api.importedMasks.value.map((m) => m.id))
    expect(ids.size).toBe(2)
    expect(new Set(api.importedMasks.value.map((m) => m.color)).size).toBe(2)
  })

  it('imports the valid files even when others in the batch fail', async () => {
    const { api } = setup()
    const { imported, failed } = await api.importMaskFiles([
      await maskFile(['010', '000'], 'good.npz'),
      new File(['not a mask'], 'bad.csv'),
    ])

    expect(imported).toEqual(['good.npz'])
    expect(failed).toHaveLength(1)
    expect(failed[0]!.name).toBe('bad.csv')
    expect(failed[0]!.error).toBeTruthy()
    expect(api.importedMasks.value.map((m) => m.name)).toEqual(['good.npz'])
  })

  it('rejects a mask exported from another dataset', async () => {
    const { api } = setup('colon_2024')
    const { imported, failed } = await api.importMaskFiles([
      await maskFile(['010', '000'], 'foreign.npz', 'brain_2023'),
    ])

    expect(imported).toHaveLength(0)
    expect(failed[0]!.name).toBe('foreign.npz')
    expect(failed[0]!.error).toContain('dataset')
    expect(api.importedMasks.value).toHaveLength(0)
  })

  it('unions the ACTIVE masks as the display filter', async () => {
    const { api } = setup()
    await api.importMaskFiles([
      await maskFile(['010', '000'], 'a.npz'),
      await maskFile(['000', '001'], 'b.npz'),
    ])

    // '010' OR '000' = '010'；'000' OR '001' = '001'
    expect([...api.activeUnionMask.value!]).toEqual([0, 1, 0, 0, 0, 1])
  })

  it('drops a mask from the union when toggled inactive, and restores it', async () => {
    const { api } = setup()
    await api.importMaskFiles([
      await maskFile(['010', '000'], 'a.npz'),
      await maskFile(['000', '001'], 'b.npz'),
    ])
    const a = api.importedMasks.value[0]!

    api.toggleImportedMask(a.id)
    expect(api.importedMasks.value[0]!.active).toBe(false)
    expect([...api.activeUnionMask.value!]).toEqual([0, 0, 0, 0, 0, 1])

    api.toggleImportedMask(a.id)
    expect([...api.activeUnionMask.value!]).toEqual([0, 1, 0, 0, 0, 1])
  })

  it('yields a null union when nothing is active or the list is empty', async () => {
    const { api } = setup()
    expect(api.activeUnionMask.value).toBeNull()

    await api.importMaskFiles([await maskFile(['010', '000'], 'a.npz')])
    api.toggleImportedMask(api.importedMasks.value[0]!.id)
    expect(api.activeUnionMask.value).toBeNull()
  })

  it('removes one mask without touching the others, and clears all', async () => {
    const { api } = setup()
    await api.importMaskFiles([
      await maskFile(['010', '000'], 'a.npz'),
      await maskFile(['000', '001'], 'b.npz'),
    ])

    api.removeImportedMask(api.importedMasks.value[0]!.id)
    expect(api.importedMasks.value.map((m) => m.name)).toEqual(['b.npz'])
    expect([...api.activeUnionMask.value!]).toEqual([0, 0, 0, 0, 0, 1])

    api.clearImportedMasks()
    expect(api.importedMasks.value).toHaveLength(0)
    expect(api.activeUnionMask.value).toBeNull()
  })

  it('freezes pixel count and stats from the matrix at import time', async () => {
    const { api, matrix } = setup()
    await api.importMaskFiles([await maskFile(['010', '000'], 'a.npz')])

    // matrix 全 2：单像素掩膜 → mean=2, std=0, min=max=2
    const s = api.importedMasks.value[0]!.summary
    expect(s.pixelCount).toBe(1)
    expect(s.stats).toEqual({ mean: 2, std: 0, min: 2, max: 2 })

    // 切换 m/z（矩阵变化）不重算导入时的统计
    matrix.value = new Float32Array(W * H).fill(9)
    expect(api.importedMasks.value[0]!.summary.stats).toEqual({ mean: 2, std: 0, min: 2, max: 2 })
  })
})
