import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import IonChannelPanel from '../IonChannelPanel.vue'
import type {
  IonChannel,
  IonChannelState,
} from '@/features/vizworkbench/composables/useIonChannels'
import { ION_CHANNEL_COLORS, MAX_ION_CHANNELS } from '@/features/vizworkbench/utils/ionChannelBlend'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

// 组件模板用 $t：挂载时装上 i18n 实例，并预先加载英文语言包（断言保持英文原文）
beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))

function channel(over: Partial<IonChannel> = {}): IonChannel {
  return {
    id: 1,
    colorIndex: 0,
    color: ION_CHANNEL_COLORS[0]!,
    mzIndex: 10,
    mz: 445.0494,
    matrix: new Float32Array(4),
    loading: false,
    error: null,
    visible: true,
    ...over,
  }
}

/** The fields and actions the panel uses. */
function channelState(over: Record<string, unknown> = {}) {
  return reactive({
    enabled: true,
    channels: [] as IonChannel[],
    currentMz: 445.0494,
    canAdd: true,
    channelsLoading: false,
    batchAddMode: false,
    setEnabled: vi.fn(),
    addCurrentChannel: vi.fn(),
    toggleBatchAdd: vi.fn(),
    removeChannel: vi.fn(),
    toggleChannelVisible: vi.fn(),
    updateChannelColor: vi.fn(),
    updateChannelOpacity: vi.fn(),
    retryChannel: vi.fn(),
    clearChannels: vi.fn(),
    ...over,
  }) as unknown as IonChannelState
}

function mountPanel(state = channelState()) {
  return mount(IonChannelPanel, { props: { state }, global: { plugins: [i18n] } })
}

describe('IonChannelPanel', () => {
  it('shows the current m/z on the add button without an empty-state hint', () => {
    const w = mountPanel()
    expect(w.text()).not.toContain('Add the current m/z to start overlaying.')
    // m/z is shown at 6-decimal precision (matches the toolbar's input)
    expect(w.get('button.btn-primary').text()).toContain('445.049400')
  })

  it('adds the current m/z', async () => {
    const state = channelState()
    await mountPanel(state).get('button.btn-primary').trigger('click')
    expect(state.addCurrentChannel).toHaveBeenCalledOnce()
  })

  it('disables add when nothing more can be added', () => {
    const w = mountPanel(channelState({ canAdd: false }))
    expect(w.get('button.btn-primary').attributes('disabled')).toBeDefined()
  })

  it('disables add while the overlay mode is off', () => {
    const w = mountPanel(channelState({ enabled: false }))
    expect(w.get('button.btn-primary').attributes('disabled')).toBeDefined()
  })

  it('turns the mode on from the toggle', async () => {
    const state = channelState({ enabled: false })
    await mountPanel(state).get('input[type="checkbox"].toggle').setValue(true)
    expect(state.setEnabled).toHaveBeenCalledWith(true)
  })

  it('renders one row per channel with its m/z at 6 decimals', () => {
    const w = mountPanel(
      channelState({ channels: [channel(), channel({ id: 2, colorIndex: 1, mz: 500 })] }),
    )
    expect(w.findAll('button[aria-label^="Remove channel"]')).toHaveLength(2)
    expect(w.text()).toContain('445.049400')
    expect(w.text()).toContain('500.000000')
  })

  it('removes a row and toggles its visibility', async () => {
    const state = channelState({ channels: [channel()] })
    const w = mountPanel(state)
    await w.get('button[aria-label^="Remove channel"]').trigger('click')
    expect(state.removeChannel).toHaveBeenCalledWith(1)

    await w.get('input[type="checkbox"].checkbox').trigger('change')
    expect(state.toggleChannelVisible).toHaveBeenCalledWith(1)
  })

  it('updates a row color and opacity', async () => {
    const state = channelState({ channels: [channel()] })
    const w = mountPanel(state)
    await w.get('input[type="color"]').setValue('#0c2238')
    expect(state.updateChannelColor).toHaveBeenCalledWith(1, { r: 12, g: 34, b: 56 })

    await w.get('input[type="range"]').setValue('0.5')
    expect(state.updateChannelOpacity).toHaveBeenCalledWith(1, 0.5)
  })

  it('shows a retry button instead of the spinner when a channel failed', async () => {
    const state = channelState({ channels: [channel({ error: 'boom', matrix: null })] })
    const w = mountPanel(state)
    expect(w.find('.loading').exists()).toBe(false)
    await w.get('button.text-error').trigger('click')
    expect(state.retryChannel).toHaveBeenCalledWith(1)
  })

  it('shows a spinner while a channel is loading', () => {
    const w = mountPanel(channelState({ channels: [channel({ loading: true, matrix: null })] }))
    expect(w.find('.loading').exists()).toBe(true)
  })

  it('reports the channel cap', () => {
    const many = Array.from({ length: MAX_ION_CHANNELS }, (_, i) =>
      channel({ id: i + 1, colorIndex: i, mz: 100 + i }),
    )
    const w = mountPanel(channelState({ channels: many, canAdd: false }))
    expect(w.text()).toContain(`Maximum of ${MAX_ION_CHANNELS} channels reached.`)
  })

  it('clears the channels', async () => {
    const state = channelState({ channels: [channel()] })
    const clear = mountPanel(state)
      .findAll('button')
      .find((b) => b.text() === 'Clear')!
    await clear.trigger('click')
    expect(state.clearChannels).toHaveBeenCalledOnce()
  })

  it('toggles batch add from the batch button', async () => {
    const state = channelState()
    const batch = mountPanel(state)
      .findAll('button')
      .find((b) => b.text().includes('Batch add'))!
    await batch.trigger('click')
    expect(state.toggleBatchAdd).toHaveBeenCalledOnce()
  })
})
