import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VizInfoPanel from '../VizInfoPanel.vue'
import { mapItemToDataset } from '@/features/datasets/mappers/datasetMapper'
import { deriveAcquisition } from '@/features/vizworkbench/utils/acquisition'
import type { MetadataAttrs } from '@/services/zarr/types/zarr'
import type { File } from '@/features/datasets/types/dataset'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

// 直方图画布挂载时会建 ResizeObserver，jsdom 没有
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
)

// 字段名与词表文案来自 datasets 包（可视化路由会一并加载），断言保持英文原文
beforeAll(() =>
  Promise.all([
    loadCoreMessages('en'),
    loadFeatureMessages('vizworkbench'),
    loadFeatureMessages('datasets'),
  ]),
)

function sourceFile(over: Record<string, unknown> = {}) {
  return mapItemToDataset({
    public_id: 'AbCdEfGh12345678',
    maldi_matrix: 'DHB',
    maldi_matrix_application: 'Spray coating',
    solvent: '70% Acetonitrile, 30% Water',
    resolving_power: 70000,
    mz: 400,
    organism: 'Mouse (Mus musculus)',
    organism_part: 'Brain',
    ...over,
  })
}

/** 面板拿到的是 useResultMeta 推导出的 acquisition 与原始文件记录 */
function mountPanel(file: File | null, attrs: MetadataAttrs | null = null) {
  return mount(VizInfoPanel, {
    props: {
      globalMin: 0,
      globalMax: 1,
      displayMin: 0,
      displayMax: 1,
      acquisition: deriveAcquisition(attrs, file, []),
      sourceFile: file,
    },
    global: { plugins: [i18n] },
  })
}

const zarrPositive = { polarity: 'positive' } as MetadataAttrs

describe('VizInfoPanel source file metadata', () => {
  it('shows matrix, solvent and resolving power alongside the instrument fields', () => {
    const text = mountPanel(sourceFile(), zarrPositive).text()
    expect(text).toContain('Matrix')
    expect(text).toContain('DHB')
    expect(text).toContain('70% Acetonitrile, 30% Water')
    expect(text).toContain('at m/z 400, 70000')
  })

  it('shows a sample section with the biological fields', () => {
    const text = mountPanel(sourceFile()).text()
    expect(text).toContain('Biological & Sample Info')
    expect(text).toContain('Mouse (Mus musculus)')
    expect(text).toContain('Brain')
  })

  it('hides the sample section and file-only rows without a source file', () => {
    const text = mountPanel(null, zarrPositive).text()
    expect(text).not.toContain('Biological & Sample Info')
    expect(text).not.toContain('Matrix')
    expect(text).not.toContain('Resolving Power')
  })

  it('shows resolving power alone when the file has no m/z', () => {
    const text = mountPanel(sourceFile({ mz: null })).text()
    expect(text).toContain('70000')
    expect(text).not.toContain('at m/z')
  })
})
