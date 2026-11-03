import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ChatComposer from '../components/chat/ChatComposer.vue'

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

function mountComposer(props: { streaming?: boolean } = {}) {
  return mount(ChatComposer, {
    props: { streaming: false, ...props },
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
    expect(wrapper.emitted('send')).toEqual([['hello', undefined]])
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

  it('shows a stop button while streaming', async () => {
    const wrapper = mountComposer({ streaming: true })
    await wrapper.get('button[aria-label="common.assistant.stop"]').trigger('click')
    expect(wrapper.emitted('stop')).toHaveLength(1)
    expect(wrapper.find('button[aria-label="common.assistant.send"]').exists()).toBe(false)
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
    expect(wrapper.emitted('send')).toEqual([['', ['data:image/png;base64,a.png']]])
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
    await wrapper.get('button[aria-label="common.assistant.removeImage"]').trigger('click')
    expect(wrapper.findAll('img')).toHaveLength(0)
  })

  it('passes on a request to open the connection settings', async () => {
    const wrapper = mountComposer()
    await wrapper.get('.picker').trigger('click')
    expect(wrapper.emitted('openConnection')).toHaveLength(1)
  })
})
