import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import VizInfoPanel from '../VizInfoPanel.vue'
import { mapItemToDataset } from '@/features/datasets/mappers/datasetMapper'
import { deriveAcquisition } from '@/features/vizworkbench/utils/acquisition'
import type { MetadataAttrs } from '@/services/zarr/types/zarr'
import type { File } from '@/features/datasets/types/dataset'
import { i18n, loadActiveFeatureMessages, loadCoreMessages, loadFeatureMessages } from '@/i18n'

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

afterEach(() => {
  i18n.global.locale.value = 'en'
})

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

describe('VizInfoPanel sections', () => {
  const headers = (w: ReturnType<typeof mountPanel>) =>
    w.findAll('h2 > button[aria-expanded]').map((b) => b.text())

  it('keeps instrument info, sample and preprocessing as sub-items of Info', async () => {
    const w = mountPanel(sourceFile(), zarrPositive)
    await w.setProps({ methods: ['tic'], info: { pixels: '120 × 80' } })
    expect(headers(w)).toEqual(['Info', 'Intensity'])
    const subheads = w.findAll('h3').map((h) => h.text())
    expect(subheads).toEqual(['Instrument Info', 'Biological & Sample Info', 'Preprocessing'])
    expect(w.text()).toContain('120 × 80')

    const infoToggle = w.get('h2 > button')
    const infoContent = w.get<HTMLDivElement>(`#${infoToggle.attributes('aria-controls')}`).element
    expect(infoToggle.attributes('aria-expanded')).toBe('false')
    expect(infoContent.style.display).toBe('none')
    await infoToggle.trigger('click')
    expect(infoToggle.attributes('aria-expanded')).toBe('true')
    expect(infoContent.style.display).toBe('')

    await Promise.all([loadCoreMessages('zh-CN'), loadActiveFeatureMessages('zh-CN')])
    i18n.global.locale.value = 'zh-CN'
    await nextTick()
    expect(w.get('h3').text()).toBe('仪器信息')
    w.unmount()
  })

  it('puts gamma next to the display range in Intensity', async () => {
    const w = mountPanel(null)
    const slider = w.get('input[type="range"]')
    const intensityToggle = w.get('h2 > button')
    expect(intensityToggle.text()).toBe('Intensity')
    expect(intensityToggle.attributes('aria-expanded')).toBe('false')
    expect(slider.isVisible()).toBe(false)
    await intensityToggle.trigger('click')
    expect(slider.isVisible()).toBe(true)

    const help = w.get('button[aria-label="About Gamma"]')
    expect(help.attributes('aria-expanded')).toBe('false')
    expect(w.text()).not.toContain('brighten weak signals')
    await help.trigger('click')
    expect(help.attributes('aria-expanded')).toBe('true')
    expect(
      document.body.querySelector('[role="dialog"][aria-label="Gamma"]')?.textContent,
    ).toContain('brighten weak signals')
    await slider.setValue('1.3')
    expect(w.emitted('update:gamma')).toEqual([[1.3]])
    await w.setProps({ channelsMode: true })
    expect(slider.attributes('disabled')).toBeDefined()
    w.unmount()
  })
})
