import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ContextSettings from '../components/connection/ContextSettings.vue'
import { getContextWindow, saveContextWindow } from '../plugins/llm'
import type { ResolvedEndpoint } from '../plugins/connection'

vi.mock('../bootstrap', () => ({
  whenAgentReady: async () => ({
    agent: {
      ready: async () => {},
      subscribe: (callback: (value: object) => void) => {
        callback({})
        return () => {}
      },
    },
  }),
}))
const endpoint: ResolvedEndpoint = {
  endpoint: 'anthropic',
  baseUrl: 'https://model.test/v1',
  apiKey: 'test',
  source: 'user',
}
const mountSettings = () =>
  mount(ContextSettings, {
    props: { endpoint, model: 'first' },
    global: { mocks: { $t: (key: string) => key } },
  })

beforeEach(() => localStorage.clear())
describe('model context settings', () => {
  it('defaults to 256k and persists each model independently', async () => {
    const wrapper = mountSettings()
    const input = wrapper.get('input[type="number"]')
    expect((input.element as HTMLInputElement).value).toBe('256000')
    await input.setValue('128000')
    await wrapper.get('button').trigger('click')
    expect(getContextWindow(endpoint, 'first')).toBe(128000)
    await wrapper.setProps({ model: 'second' })
    expect((input.element as HTMLInputElement).value).toBe('256000')
    await input.setValue('64000')
    await wrapper.get('button').trigger('click')
    await wrapper.setProps({ model: 'first' })
    expect((input.element as HTMLInputElement).value).toBe('128000')
    wrapper.unmount()
    const restored = mountSettings()
    expect((restored.get('input[type="number"]').element as HTMLInputElement).value).toBe('128000')
  })

  it('rejects invalid capacities and isolates different endpoints', async () => {
    const wrapper = mountSettings()
    await wrapper.get('input[type="number"]').setValue('0')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(() => saveContextWindow(endpoint, 'first', Number.NaN)).toThrow()
    saveContextWindow(endpoint, 'first', 128000)
    expect(getContextWindow({ ...endpoint, baseUrl: 'https://different.test/v1' }, 'first')).toBe(
      256000,
    )
  })

  it('shows failed preference writes without claiming they were saved', async () => {
    const wrapper = mountSettings()
    await flushPromises()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('quota')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    spy.mockRestore()
  })
})
