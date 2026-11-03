import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import IonImageToolbar from '../IonImageToolbar.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

// 组件模板用 $t：挂载时装上 i18n 实例，并预先加载英文语言包（断言保持英文原文）
beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))

function mountToolbar(over: Record<string, unknown> = {}) {
  return mount(IonImageToolbar, {
    props: {
      selectedMz: 445.0494,
      mzTolerance: 0.0001,
      colormap: 'inferno',
      intensityScale: 'linear',
      ...over,
    },
    global: { plugins: [i18n] },
  })
}

describe('IonImageToolbar export', () => {
  it('defaults the main export button to JPG', async () => {
    const w = mountToolbar()
    expect(w.get('[data-testid="export-button"]').text()).toContain('JPG')

    await w.get('[data-testid="export-button"]').trigger('click')
    expect(w.emitted('download')).toEqual([['jpeg']])
  })

  it('offers both formats and exports the picked one', async () => {
    const w = mountToolbar()
    // 菜单项常驻 DOM（展开/收起是 CSS 行为），不依赖 hover 也能断言
    expect(w.get('[data-testid="export-jpg"]').text()).toBe('JPG')
    expect(w.get('[data-testid="export-png"]').text()).toBe('PNG')

    await w.get('[data-testid="export-png"]').trigger('click')
    expect(w.emitted('download')).toEqual([['png']])

    await w.get('[data-testid="export-jpg"]').trigger('click')
    expect(w.emitted('download')).toEqual([['png'], ['jpeg']])
  })
})
