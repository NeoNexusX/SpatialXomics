import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import CollapsibleText from '../CollapsibleText.vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

// jsdom 没有布局，把组件「量」截断时用到的两个数桩掉：行高固定 20px（4 行上限 = 80px），
// 内容高度由 contentHeight 给出。ResizeObserver 在 jsdom 里同样不存在，替身记下回调，
// 以便模拟容器尺寸变化。（被 line-clamp 截断时 scrollHeight 等于全文高度，已在
// Chromium / Firefox / WebKit 三个真实引擎里实测。）

let contentHeight = 0
let resizeCallback: ResizeObserverCallback | undefined

// 组件模板用 $t：挂载时装上 i18n 实例，并预先加载英文语言包（断言保持英文原文）
beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('collections')]))

beforeEach(() => {
  contentHeight = 0
  resizeCallback = undefined
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  // 组件直接调用全局 getComputedStyle（vitest 的 jsdom 环境里它是 window 方法的独立副本，
  // spyOn window 拦不到），所以要替换全局。组件只读 lineHeight，jsdom 给不出像素值
  vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '20px' }))
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => contentHeight,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight')
})

const mountText = (value: string) =>
  mount(CollapsibleText, { props: { value }, global: { plugins: [i18n] } })

type Wrapper = ReturnType<typeof mountText>

// 组件在 onMounted 里测量，测完才更新「是否显示按钮」；这次重渲染要等下一个 tick 才落地
const mountSettled = async (value: string) => {
  const wrapper = mountText(value)
  await nextTick()
  return wrapper
}

describe('CollapsibleText', () => {
  const CLAMP = 'line-clamp-4'
  const text = (wrapper: Wrapper) => wrapper.find('p')

  it('keeps short text clamped and offers no expand button', async () => {
    contentHeight = 60 // 3 行
    const wrapper = await mountSettled('short')

    expect(text(wrapper).classes()).toContain(CLAMP)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  // 宽屏上没被截断却出现按钮、点了没反应，是这类折叠最常见的毛病：按钮只在真被截断时出现
  it('offers to expand only when the text really overflows the clamp', async () => {
    contentHeight = 120 // 6 行
    const wrapper = await mountSettled('long')

    const button = wrapper.find('button')
    expect(button.text()).toBe('Show full text')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(text(wrapper).classes()).toContain(CLAMP)

    await button.trigger('click')

    expect(text(wrapper).classes()).not.toContain(CLAMP)
    expect(button.text()).toBe('Show less')
    expect(button.attributes('aria-expanded')).toBe('true')
  })

  it('collapses again when the text changes, then re-measures the new text', async () => {
    contentHeight = 120
    const wrapper = await mountSettled('long')
    await wrapper.find('button').trigger('click')

    contentHeight = 40
    await wrapper.setProps({ value: 'now short' })
    await flushPromises()

    expect(text(wrapper).classes()).toContain(CLAMP)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('re-measures when the container is resized', async () => {
    contentHeight = 40
    const wrapper = await mountSettled('same text, narrower container')
    expect(wrapper.find('button').exists()).toBe(false)

    // 窗口变窄：同一段文本换行变多，超出折叠上限
    contentHeight = 120
    resizeCallback?.([], {} as ResizeObserver)
    await nextTick()

    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('shows no button when the layout cannot be measured', () => {
    vi.unstubAllGlobals() // 行高回到 jsdom 给的空值，无从换算折叠上限
    contentHeight = 120
    const wrapper = mountText('long')

    expect(wrapper.find('button').exists()).toBe(false)
  })
})
