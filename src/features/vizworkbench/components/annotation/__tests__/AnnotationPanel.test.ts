import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AnnotationPanel from '../AnnotationPanel.vue'
import positiveCsv from '@/features/vizworkbench/utils/annotation/__fixtures__/peaks.positive.csv?raw'
import dbCsv from '@/features/vizworkbench/utils/annotation/__fixtures__/annotation-db.csv?raw'
import { parseTestSpectrum } from '@/features/vizworkbench/utils/annotation/__fixtures__/testPeaks'
import {
  loadStoredDb,
  saveStoredDb,
  clearStoredDb,
} from '@/features/vizworkbench/utils/annotation/dbStore'
import { getAnnotationRows } from '@/features/assistant/providers/analysisContext'
import { dataModeRef, meanSpectrumRef, mzAxisRef } from '@/services/zarr/zarrSharedState'
import type { Acquisition } from '@/features/vizworkbench/types/acquisition'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

vi.mock('@/features/vizworkbench/utils/annotation/dbStore', () => ({
  loadStoredDb: vi.fn(async () => null),
  saveStoredDb: vi.fn(async () => {}),
  clearStoredDb: vi.fn(async () => {}),
  loadPlatformFile: vi.fn(async () => null),
  savePlatformFile: vi.fn(async () => {}),
}))

// 真实的 useZarrIonImage 会拉起整套 zarr store；这里只要共享 ref 和取图入口
vi.mock('@/features/vizworkbench/composables/useZarrIonImage', async () => {
  const shared = await import('@/services/zarr/zarrSharedState')
  return {
    mzAxisRef: shared.mzAxisRef,
    dataModeRef: shared.dataModeRef,
    meanSpectrumRef: shared.meanSpectrumRef,
    spectrumError: shared.spectrumError,
    getSharedZarrContext: () => ({ ionShape: { width: 40, height: 40 } }),
    loadIonMatrixByIndex: async () => {
      const img = new Float32Array(40 * 40)
      for (let i = 0; i < img.length; i++) img[i] = (i % 40) * Math.floor(i / 40)
      return img
    },
  }
})

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
)

// jsdom 的 File 没有 arrayBuffer()
if (!('arrayBuffer' in File.prototype)) {
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    value(this: File) {
      return new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.readAsArrayBuffer(this)
      })
    },
  })
}

const acquisition: Acquisition = {
  polarity: 'Positive',
  ionSource: 'MALDI',
  analyzer: 'Q Exactive HF',
  resolvingPower: '',
  resolvingPowerMz: '',
  maldiMatrix: 'DHB (2,5-Dihydroxybenzoic acid)',
  maldiMatrixApplication: '',
  solvent: '70% Methanol (MeOH), 0.1% Trifluoroacetic acid (TFA)',
  spectrumMode: 'centroid',
  storageMode: 'continuous',
}

/** 测试数据当作对齐数据集：平均轴 + 平均谱 */
const spectrum = parseTestSpectrum(positiveCsv)

beforeAll(async () => {
  await Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')])
  dataModeRef.value = 'continuous'
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadStoredDb).mockResolvedValue(null)
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected database download'))
  localStorage.clear()
  mzAxisRef.value = spectrum.axis
  meanSpectrumRef.value = spectrum.mean
})

afterEach(() => vi.restoreAllMocks())

afterAll(() => {
  mzAxisRef.value = null
  meanSpectrumRef.value = null
  dataModeRef.value = null
})

const settle = async () => {
  for (let i = 0; i < 2; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 220))
  }
}

function mountPanel(runId: string, selectMzIndex = vi.fn()) {
  return mount(AnnotationPanel, {
    props: { expanded: true, runId, acquisition, selectMzIndex, selectedMzIndex: -1 },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

async function startAnnotation(wrapper: ReturnType<typeof mountPanel>) {
  const button = wrapper.get('button[aria-label="Start annotation"]')
  if (!button.isVisible()) {
    await wrapper
      .findAll('button')
      .find((b) => b.text().startsWith('Conditions'))!
      .trigger('click')
  }
  await button.trigger('click')
  await settle()
}

async function selectDb(wrapper: ReturnType<typeof mountPanel>, csv = dbCsv, name = 'test-db.csv') {
  const input = wrapper.find('input[type="file"]')
  const file = new File([csv], name, { type: 'text/csv' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await settle()
}

describe('AnnotationPanel', () => {
  it('annotates the mean-spectrum peaks after Start, and jumps between ions of a molecule', async () => {
    const selectMzIndex = vi.fn()
    const wrapper = mountPanel('run-1', selectMzIndex)
    // 不点开始不跑
    await settle()
    expect(
      wrapper.get('button[aria-label="Start annotation"]').attributes('disabled'),
    ).toBeDefined()
    expect(getAnnotationRows()).toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()

    // 通过按钮打开本地文件选择器；选择库后仍需点击开始。
    const click = vi.spyOn(wrapper.find('input[type="file"]').element as HTMLInputElement, 'click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Choose CSV')!
      .trigger('click')
    expect(click).toHaveBeenCalledOnce()
    await selectDb(wrapper)
    expect(getAnnotationRows()).toBeNull()

    await startAnnotation(wrapper)
    const text = wrapper.text()
    // 条件：峰来自平均谱；Orbitrap 默认 5 ppm
    expect(text).toContain(`${spectrum.axis.length} / ${spectrum.axis.length} peaks matched`)
    expect(text).toContain('Default 5 ppm (Q Exactive HF)')
    expect(text).toContain('test-db.csv · 31 formulas')
    expect(saveStoredDb).toHaveBeenCalledWith({ fileName: 'test-db.csv', text: dbCsv })
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(text).toMatch(/≤10%\s*\d+/)

    // jsdom 里视口高度为 0，虚拟列表只渲染前几行：先搜索
    await wrapper.find('input[placeholder="Search name / formula / m/z"]').setValue('PC 34:1')
    await settle()
    const rows = wrapper.findAll('[data-ion-id]')
    // PC 34:1 的 [M+H]⁺ / [M+Na]⁺ / [M+K]⁺ 各是一行
    expect(rows.length).toBe(3)

    // 点一行：离子图切到它在平均轴上的点
    const row = rows[0]!
    await row.trigger('click')
    expect(selectMzIndex).toHaveBeenCalledTimes(1)
    const first = selectMzIndex.mock.calls[0]![0] as number
    const shown = Number(row.text().match(/\d+\.\d{4}/)![0])
    expect(Math.abs(spectrum.axis[first]! - shown)).toBeLessThan(1e-4)

    // 点同分子的离子标签：跳到另一个峰
    const chip = row.findAll('button').find((b) => /^(H|Na|K)⁺$/.test(b.text()))!
    await chip.trigger('click')
    expect(selectMzIndex).toHaveBeenCalledTimes(2)
    expect(selectMzIndex.mock.calls[1]![0]).not.toBe(first)

    wrapper.unmount()
  })

  it('never matches zero-intensity points and drops the weakest n% with the slider', async () => {
    // 把 PC 34:1 [M+K]⁺ 所在的点的平均强度置 0
    const mean = Float32Array.from(spectrum.mean)
    const kIdx = spectrum.axis.findIndex((mz) => Math.abs(mz - 798.541) < 0.01)
    expect(kIdx).toBeGreaterThanOrEqual(0)
    mean[kIdx] = 0
    meanSpectrumRef.value = mean

    const wrapper = mountPanel('run-2')
    await selectDb(wrapper)
    await startAnnotation(wrapper)
    const nonZero = spectrum.axis.length - 1
    expect(wrapper.text()).toContain(`${nonZero} / ${nonZero} peaks matched`)
    let rows = getAnnotationRows()!
    expect(rows.some((r) => Math.abs(r.obsMz - spectrum.axis[kIdx]!) < 1e-6)).toBe(false)
    expect(
      rows
        .filter((r) => r.name === 'PC 34:1')
        .map((r) => r.adduct)
        .sort(),
    ).toEqual(['[M+H]+', '[M+Na]+'])

    // 滑动条：去掉最弱的 50%（松手才生效）
    const slider = wrapper.find('input[type="range"]')
    await slider.setValue(50)
    await slider.trigger('change')
    await settle()
    const kept = nonZero - Math.floor(nonZero / 2)
    expect(wrapper.text()).toContain(`${kept} / ${nonZero} peaks matched`)
    expect(wrapper.text()).toContain('Drop weakest 50%')
    expect(getAnnotationRows()).toBeNull()
    await startAnnotation(wrapper)
    const threshold = [...mean].filter((v) => v > 0).sort((a, b) => a - b)[nonZero - kept]!
    rows = getAnnotationRows()!
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.intensity!).toBeGreaterThanOrEqual(threshold)

    wrapper.unmount()
  })

  it('waits for Start after replacing a database or selecting it again', async () => {
    const wrapper = mountPanel('run-3')
    await selectDb(wrapper)
    await startAnnotation(wrapper)
    expect(getAnnotationRows()!.some((r) => r.name !== 'PC 34:1')).toBe(true)

    const input = wrapper.find('input[type="file"]')
    const csv = 'ID,Name,Formula,InChI,Mass\nX1,PC 34:1,C42H82NO8P,,759.5778056\n'
    const file = new File([csv], 'my-db.csv', { type: 'text/csv' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await settle()

    expect(wrapper.text()).toContain('my-db.csv · 1 formulas')
    expect(getAnnotationRows()).toBeNull()
    await startAnnotation(wrapper)
    const rows = getAnnotationRows()!
    expect(rows.length).toBe(3)
    expect(new Set(rows.map((r) => r.name))).toEqual(new Set(['PC 34:1']))

    // 不是数据库的 CSV（峰列表）：报错，继续用当前的库
    const bad = new File(['m/z,intensity\n536.1682,1200\n'], 'peaks.csv', { type: 'text/csv' })
    Object.defineProperty(input.element, 'files', { value: [bad], configurable: true })
    await input.trigger('change')
    await settle()
    expect(wrapper.text()).toContain('my-db.csv · 1 formulas')

    // 清除用户库后回到文件选择，不下载默认库。
    await wrapper.find('button[title="Clear the selected annotation database"]').trigger('click')
    await settle()
    expect(clearStoredDb).toHaveBeenCalledOnce()
    expect(getAnnotationRows()).toBeNull()
    expect(wrapper.text()).toContain('Choose the annotation CSV file to match the peaks')
    expect(globalThis.fetch).not.toHaveBeenCalled()

    // 重新选择库仍需点击开始。
    await selectDb(wrapper, csv, 'my-db.csv')
    expect(getAnnotationRows()).toBeNull()
    await startAnnotation(wrapper)
    expect(getAnnotationRows()).toHaveLength(3)

    wrapper.unmount()
  })

  it('restores only the database previously selected by the user', async () => {
    vi.mocked(loadStoredDb).mockResolvedValue({ fileName: 'saved-db.csv', text: dbCsv })
    const wrapper = mountPanel('run-4')
    await settle()
    expect(wrapper.text()).toContain('saved-db.csv · 31 formulas')
    expect(getAnnotationRows()).toBeNull()
    await startAnnotation(wrapper)
    expect(getAnnotationRows()!.length).toBeGreaterThan(0)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('never starts automatically when reopening a result annotated previously', async () => {
    vi.mocked(loadStoredDb).mockResolvedValue({ fileName: 'saved-db.csv', text: dbCsv })
    localStorage.setItem(
      'annotation-settings:run-5',
      JSON.stringify({
        started: true,
        tolValue: 10,
        tolUnit: 'ppm',
        overrides: {},
        polarity: null,
        spatialPct: 20,
      }),
    )
    const wrapper = mountPanel('run-5')
    await settle()
    expect(getAnnotationRows()).toBeNull()
    expect(
      wrapper.get('button[aria-label="Start annotation"]').attributes('disabled'),
    ).toBeUndefined()
    expect(
      (wrapper.get('input[aria-label="Spatial scoring"]').element as HTMLInputElement).value,
    ).toBe('20')
    await startAnnotation(wrapper)
    expect(getAnnotationRows()!.length).toBeGreaterThan(0)
    wrapper.unmount()
  })
})
