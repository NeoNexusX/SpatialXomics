import { computed, reactive, ref, shallowRef, watch, type Ref } from 'vue'
import { t } from '@/i18n'
import { useToast } from '@/shared/composables/useToast'
import type { RGB } from '@/features/vizworkbench/utils/regionPalette'
import { ION_CHANNEL_COLORS, MAX_ION_CHANNELS } from '@/features/vizworkbench/utils/ionChannelBlend'

/** One m/z layer in the multi-ion overlay. */
export interface IonChannel {
  id: number
  /** Index into ION_CHANNEL_COLORS; freed for reuse when the channel is removed. */
  colorIndex: number
  color: RGB
  mzIndex: number
  mz: number
  matrix: Float32Array | null
  loading: boolean
  error: string | null
  visible: boolean
  /** Per-layer opacity, 0..1. Optional for backwards-compatible callers. */
  opacity?: number
}

/** Why `addCurrentMz()` refused; `addCurrentChannel()` turns this into a toast. */
export type AddChannelResult =
  | { ok: true; channel: IonChannel }
  | { ok: false; reason: 'not-continuous' | 'not-ready' | 'full' | 'duplicate' }

/** A visible, fully-loaded channel as consumed by the viewer (render + hover). */
export interface ViewIonChannel {
  id: number
  mz: number
  color: RGB
  matrix: Float32Array
  opacity: number
}

export interface IonChannelDeps {
  /** Currently selected m/z axis index (the "current m/z"). */
  currentMzIndex: Ref<number>
  /** Currently selected m/z value. */
  currentMz: Ref<number>
  /** Current m/z tolerance, read live at add/retry time. */
  tolerance: Ref<number>
  isContinuous: Ref<boolean>
  ready: Ref<boolean>
  /** Loads one ion image by index. Injected for testing; wired to
   *  `loadIonMatrixByIndex` in the app. */
  loadMatrix: (idx: number, tolerance: number) => Promise<Float32Array>
}

/**
 * Multi-ion channel overlay state.
 *
 * Owns a list of independently-loaded ion images shown as additive color
 * channels. Deliberately separate from `useZarrIonImage`'s single-image state
 * so switching a channel never disturbs the base ion image, ROI masks or the
 * display-range controls.
 */
export function useIonChannels(deps: IonChannelDeps) {
  /** Mode toggle. Kept across on/off so turning the overlay off and back on
   *  restores the same channels. */
  const enabled = ref(false)
  /** Batch mode: every m/z picked in the spectrum is added as a channel too. */
  const batchAddMode = ref(false)
  // shallowRef: matrices are large Float32Arrays and are replaced (never
  // mutated), so deep reactivity would only proxy every pixel read.
  const channels = shallowRef<IonChannel[]>([])

  /** Bumped whenever the whole list is invalidated (reset), so in-flight
   *  loads from before are discarded. */
  let generation = 0
  let nextId = 1

  /** True when the overlay should actually be rendered. */
  const overlayActive = computed(() => enabled.value && channels.value.some((c) => c.matrix))

  /** True while any channel is still loading its matrix. */
  const channelsLoading = computed(() => channels.value.some((c) => c.loading))

  /** Lowest channel color not currently taken. */
  function firstFreeColorIndex(list: IonChannel[]): number {
    const used = new Set(list.map((c) => c.colorIndex))
    for (let i = 0; i < MAX_ION_CHANNELS; i++) {
      if (!used.has(i)) return i
    }
    return -1
  }

  function replace(next: IonChannel[]) {
    channels.value = next
  }

  function patch(id: number, fields: Partial<IonChannel>) {
    replace(channels.value.map((c) => (c.id === id ? { ...c, ...fields } : c)))
  }

  /**
   * Load a channel's matrix in the background and patch it in. Stale results
   * are discarded when the whole list was reset (generation) or this channel
   * was removed while the read was in flight.
   */
  function loadInto(channelId: number, mzIndex: number, tolerance: number) {
    const gen = generation
    deps
      .loadMatrix(mzIndex, tolerance)
      .then((matrix) => {
        if (gen !== generation) return
        if (!channels.value.some((c) => c.id === channelId)) return
        patch(channelId, { matrix, loading: false, error: null })
      })
      .catch((e: unknown) => {
        if (gen !== generation) return
        if (!channels.value.some((c) => c.id === channelId)) return
        console.error('[useIonChannels] load failed:', e)
        patch(channelId, {
          matrix: null,
          loading: false,
          error: t('vizworkbench.channels.loadFailed'),
        })
      })
  }

  /** Add the currently selected m/z as a new channel. */
  function addCurrentMz(): AddChannelResult {
    if (!deps.isContinuous.value) return { ok: false, reason: 'not-continuous' }
    if (!deps.ready.value) return { ok: false, reason: 'not-ready' }
    const list = channels.value
    if (list.length >= MAX_ION_CHANNELS) return { ok: false, reason: 'full' }
    const mzIndex = deps.currentMzIndex.value
    if (list.some((c) => c.mzIndex === mzIndex)) return { ok: false, reason: 'duplicate' }

    const colorIndex = firstFreeColorIndex(list)
    const channel: IonChannel = {
      id: nextId++,
      colorIndex,
      color: ION_CHANNEL_COLORS[colorIndex]!,
      mzIndex,
      mz: deps.currentMz.value,
      matrix: null,
      loading: true,
      error: null,
      visible: true,
      opacity: 1,
    }
    replace([...list, channel])
    loadInto(channel.id, mzIndex, deps.tolerance.value)

    return { ok: true, channel }
  }

  function removeChannel(id: number) {
    replace(channels.value.filter((c) => c.id !== id))
  }

  function toggleChannelVisible(id: number) {
    const channel = channels.value.find((c) => c.id === id)
    if (channel) patch(id, { visible: !channel.visible })
  }

  function updateChannelColor(id: number, color: RGB) {
    patch(id, { color: { ...color } })
  }

  function updateChannelOpacity(id: number, opacity: number) {
    patch(id, { opacity: Math.max(0, Math.min(1, opacity)) })
  }

  /** The Add button: add the current m/z, or say why it cannot be added. */
  function addCurrentChannel() {
    const result = addCurrentMz()
    if (result.ok) return
    const messages: Record<typeof result.reason, string> = {
      'not-continuous': t('vizworkbench.page.channelNotContinuous'),
      'not-ready': t('vizworkbench.page.channelNotReady'),
      full: t('vizworkbench.page.channelFull', { max: MAX_ION_CHANNELS }),
      duplicate: t('vizworkbench.page.channelDuplicate'),
    }
    showToast(messages[result.reason], 'warning')
  }

  /** Call after the user picks an m/z. Batch mode adds it; a peak that already is a channel is skipped quietly. */
  function addPickedMz() {
    if (batchAddMode.value) addCurrentMz()
  }

  function setEnabled(value: boolean) {
    enabled.value = value
    if (!value) batchAddMode.value = false
  }

  function toggleBatchAdd() {
    batchAddMode.value = enabled.value && canAdd.value && !batchAddMode.value
  }

  function clearChannels() {
    replace([])
  }

  /** Drop every channel and leave the mode; in-flight loads are discarded. Called on unmount. */
  function reset() {
    generation++
    replace([])
    enabled.value = false
    batchAddMode.value = false
  }

  /** Retry a channel whose load failed. */
  function retryChannel(id: number) {
    const channel = channels.value.find((c) => c.id === id)
    if (!channel || channel.loading) return
    patch(id, { loading: true, error: null })
    loadInto(id, channel.mzIndex, deps.tolerance.value)
  }

  /** Visible, fully-loaded channels in render order, for the canvas and the hover readout.
   *  Identity changes on any add/remove/visibility/load, which drives the re-render. */
  const hoverChannels = computed<ViewIonChannel[]>(() =>
    channels.value
      .filter((c) => c.visible && c.matrix)
      .map((c) => ({
        id: c.id,
        mz: c.mz,
        color: c.color,
        matrix: c.matrix!,
        opacity: c.opacity ?? 1,
      })),
  )

  const canAdd = computed(
    () => deps.isContinuous.value && deps.ready.value && channels.value.length < MAX_ION_CHANNELS,
  )
  /** What `addCurrentMz()` would add. */
  const currentMz = computed(() => deps.currentMz.value)

  const { showToast } = useToast()

  // Batch mode ends once nothing more can be added.
  watch(canAdd, (value) => {
    if (!value) batchAddMode.value = false
  })

  return reactive({
    enabled,
    channels,
    overlayActive,
    channelsLoading,
    canAdd,
    currentMz,
    batchAddMode,
    hoverChannels,
    setEnabled,
    toggleBatchAdd,
    addCurrentMz,
    addCurrentChannel,
    addPickedMz,
    removeChannel,
    toggleChannelVisible,
    updateChannelColor,
    updateChannelOpacity,
    retryChannel,
    clearChannels,
    reset,
  })
}

export type IonChannelState = ReturnType<typeof useIonChannels>
