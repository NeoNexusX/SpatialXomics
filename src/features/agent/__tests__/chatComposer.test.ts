import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ChatComposer from '../components/chat/ChatComposer.vue'
import type { ContextPressure } from '../plugins/token-meter'
import type { TokenUsage } from '../plugins/llm'

// 弹出面板用 Teleport 挂到 body，jsdom 没有 ResizeObserver
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    disconnect() {}
  },
)

afterEach(() => {
  document.body.innerHTML = ''
})

vi.mock('../components/chat/ModelPicker.vue', () => ({
  default: {
    name: 'ModelPicker',
    emits: ['openConnection'],
    template: '<button class="picker" @click="$emit(\'openConnection\')">k3</button>',
  },
}))

vi.mock('../utils/imageFile', () => ({
  isSupportedImage: (file: File) => file.type === 'image/png',
  fileToDataUrl: async (file: File) => `data:${file.type};base64,${file.name}`,
}))

function mountComposer(
  props: { streaming?: boolean; pressure?: ContextPressure | null; tokenUsage?: TokenUsage; canCompact?: boolean } = {},
) {
  return mount(ChatComposer, {
    props: { streaming: false, ...props, onSend: (_text: string, _images: string[] | undefined, acknowledge: (accepted: boolean) => void) => acknowledge(true) },
    global: { mocks: { $t: (key: string) => key } },
  })
}

function pasteEvent(items: { kind: string; type: string; file?: File }[], text = '') {
  return {
    clipboardData: {
      items: items.map((item) => ({ ...item, getAsFile: () => item.file ?? null })),
      getData: () => text,
    },
  }
}

const image = (name: string) => new File(['x'], name, { type: 'image/png' })

describe('ChatComposer', () => {
  it('sends on Enter and clears the input', async () => {
    const wrapper = mountComposer()
    const textarea = wrapper.get('textarea')
    await textarea.setValue('  hello  ')
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')?.[0]?.slice(0, 2)).toEqual(['hello', undefined])
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps Shift+Enter for a new line', async () => {
    const wrapper = mountComposer()
    const textarea = wrapper.get('textarea')
    await textarea.setValue('hello')
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('does not send while an input method is composing', async () => {
    const wrapper = mountComposer()
    const textarea = wrapper.get('textarea')
    await textarea.setValue('ni')
    await textarea.trigger('keydown', { key: 'Enter', isComposing: true })
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('does not send empty input or while streaming', async () => {
    const idle = mountComposer()
    await idle.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(idle.emitted('send')).toBeUndefined()

    const busy = mountComposer({ streaming: true })
    await busy.get('textarea').setValue('hello')
    await busy.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(busy.emitted('send')).toBeUndefined()
  })

  it('shows the context meter left of the send button', () => {
    const pressure: ContextPressure = {
      inputTokens: 12_345,
      contextWindow: 128_000,
      outputReserve: 32_000,
      inputBudget: 93_440,
      ratio: 0.096,
      estimated: true,
    }
    const wrapper = mountComposer({ pressure })
    const context = wrapper.get('button[aria-label="common.agent.context.used"]')
    expect(context.text()).toContain('10%')
    const labels = wrapper.findAll('button').map((button) => button.attributes('aria-label'))
    expect(labels.indexOf('common.agent.context.used')).toBeLessThan(
      labels.indexOf('common.agent.send'),
    )
  })

  describe('context panel', () => {
    const pressure: ContextPressure = {
      inputTokens: 12_345,
      contextWindow: 128_000,
      outputReserve: 32_000,
      inputBudget: 93_440,
      ratio: 0.096,
      estimated: true,
    }

    /** 面板 Teleport 到 body，按文案在页面里找压缩动作 */
    async function openPanel(props: { streaming?: boolean; tokenUsage?: TokenUsage; canCompact?: boolean } = {}) {
      const wrapper = mountComposer({ pressure, canCompact: true, ...props })
      const trigger = wrapper.get('button[aria-label="common.agent.context.used"]')
      await trigger.trigger('click')
      await flushPromises()
      const compact = [...document.body.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('common.agent.compactNow'),
      )
      return { wrapper, trigger, compact }
    }

    it('shows reported consumption including cached input instead of capacity settings', async () => {
      const { wrapper } = await openPanel({
        tokenUsage: { inputTokens: 1_000, cacheReadTokens: 200, cacheWriteTokens: 50, outputTokens: 345 },
      })
      const panel = document.body.querySelector('[aria-label="common.agent.context.title"]')!
      expect([...panel.querySelectorAll('dt')].map((label) => label.textContent)).toEqual([
        'common.agent.context.inputUsed',
        'common.agent.context.outputUsed',
      ])
      expect([...panel.querySelectorAll('dd')].map((count) => count.textContent)).toEqual([
        (1_250).toLocaleString(),
        (345).toLocaleString(),
      ])
      expect(panel.textContent).toContain('common.agent.context.sessionTokens')
      expect(panel.textContent).not.toContain(pressure.inputBudget.toLocaleString())
      expect(panel.textContent).not.toContain(pressure.outputReserve.toLocaleString())

      await wrapper.setProps({
        tokenUsage: { inputTokens: 2_000, promptTokens: 2_500, cacheReadTokens: 400, cacheWriteTokens: 100, outputTokens: 678 },
      })
      expect([...panel.querySelectorAll('dd')].map((count) => count.textContent)).toEqual([
        (2_500).toLocaleString(),
        (678).toLocaleString(),
      ])
      wrapper.unmount()
    })

    it('hides unavailable usage and shows reported zero consumption', async () => {
      const { wrapper } = await openPanel()
      const panel = document.body.querySelector('[aria-label="common.agent.context.title"]')!
      expect(panel.querySelector('dl')).toBeNull()
      expect(panel.textContent).not.toContain('common.agent.context.sessionTokens')

      await wrapper.setProps({ tokenUsage: { inputTokens: 0, outputTokens: 0 } })
      expect([...panel.querySelectorAll('dd')].map((count) => count.textContent)).toEqual(['0', '0'])
      expect(panel.textContent).toContain('common.agent.context.sessionTokens')
      wrapper.unmount()
    })

    it('offers compaction inside the context panel', async () => {
      const { wrapper, trigger, compact } = await openPanel()
      expect(trigger.attributes('aria-expanded')).toBe('true')
      expect(compact).toBeDefined()
      expect(compact!.disabled).toBe(false)

      compact!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      expect(wrapper.emitted('compact')).toHaveLength(1)
      expect(trigger.attributes('aria-expanded')).toBe('false')
      wrapper.unmount()
    })

    it('hides compaction before the conversation starts', async () => {
      const { wrapper, compact } = await openPanel({ canCompact: false })
      expect(compact).toBeUndefined()
      wrapper.unmount()
    })

    it('disables compaction while streaming', async () => {
      const { wrapper, compact } = await openPanel({ streaming: true })
      expect(compact?.disabled).toBe(true)
      wrapper.unmount()
    })
  })

  it('shows a stop button while streaming', async () => {
    const wrapper = mountComposer({ streaming: true })
    await wrapper.get('button[aria-label="common.agent.stop"]').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
    expect(wrapper.find('button[aria-label="common.agent.send"]').exists()).toBe(false)
  })

  it('attaches pasted screenshots and can send them without text', async () => {
    const wrapper = mountComposer()
    const textarea = wrapper.get('textarea')
    await textarea.trigger(
      'paste',
      pasteEvent([{ kind: 'file', type: 'image/png', file: image('a.png') }]),
    )
    await flushPromises()

    expect(wrapper.findAll('img')).toHaveLength(1)
    await textarea.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('send')?.[0]?.slice(0, 2)).toEqual(['', ['data:image/png;base64,a.png']])
    expect(wrapper.findAll('img')).toHaveLength(0)
  })

  it('keeps the text from mixed clipboard content', async () => {
    const wrapper = mountComposer()
    const textarea = wrapper.get('textarea')
    await textarea.trigger(
      'paste',
      pasteEvent([{ kind: 'file', type: 'image/png', file: image('a.png') }], 'cell value'),
    )
    await flushPromises()
    expect((textarea.element as HTMLTextAreaElement).value).toBe('cell value')
    expect(wrapper.findAll('img')).toHaveLength(1)
  })

  it('leaves plain text paste to the textarea', async () => {
    const wrapper = mountComposer()
    const event = pasteEvent([{ kind: 'string', type: 'text/plain' }], 'plain')
    await wrapper.get('textarea').trigger('paste', event)
    expect(wrapper.findAll('img')).toHaveLength(0)
  })

  it('accepts at most four images and skips unsupported types', async () => {
    const wrapper = mountComposer()
    const files = ['a', 'b', 'c', 'd', 'e'].map((n) => ({
      kind: 'file',
      type: 'image/png',
      file: image(`${n}.png`),
    }))
    const gif = new File(['x'], 'g.gif', { type: 'image/gif' })
    await wrapper
      .get('textarea')
      .trigger('paste', pasteEvent([{ kind: 'file', type: 'image/gif', file: gif }, ...files]))
    await flushPromises()
    expect(wrapper.findAll('img')).toHaveLength(4)
  })

  it('removes an attached image', async () => {
    const wrapper = mountComposer()
    await wrapper
      .get('textarea')
      .trigger('paste', pasteEvent([{ kind: 'file', type: 'image/png', file: image('a.png') }]))
    await flushPromises()
    await wrapper.get('button[aria-label="common.agent.removeImage"]').trigger('click')
    expect(wrapper.findAll('img')).toHaveLength(0)
  })

  it('passes on a request to open the connection settings', async () => {
    const wrapper = mountComposer()
    await wrapper.get('.picker').trigger('click')
    expect(wrapper.emitted('openConnection')).toHaveLength(1)
  })
})

describe('ChatComposer acceptance boundary', () => {
  it('retains the draft on rejection and preserves text typed while accepting', async () => {
    let acknowledge: ((accepted: boolean) => void) | undefined
    const wrapper = mount(ChatComposer, {
      props: { streaming: false, onSend: (_text: string, _images: string[] | undefined, ack: (accepted: boolean) => void) => { acknowledge = ack } },
      global: { mocks: { $t: (key: string) => key } },
    })
    const input = wrapper.get('textarea')
    await input.setValue('first')
    await input.trigger('keydown', { key: 'Enter' })
    acknowledge!(false)
    await flushPromises()
    expect((input.element as HTMLTextAreaElement).value).toBe('first')
    await input.trigger('keydown', { key: 'Enter' })
    await input.setValue('next draft')
    acknowledge!(true)
    await flushPromises()
    expect((input.element as HTMLTextAreaElement).value).toBe('next draft')
  })
})
