import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useIonChannels, type IonChannelDeps } from '../useIonChannels'
import { ION_CHANNEL_COLORS, MAX_ION_CHANNELS } from '../../utils/ionChannelBlend'

/** Build deps with a controllable loader. Resolves immediately unless a
 *  deferred promise is queued. */
function makeDeps(overrides: Partial<IonChannelDeps> = {}) {
  const currentMzIndex = ref(100)
  const currentMz = ref(445.0494)
  const tolerance = ref(0.0001)
  const isContinuous = ref(true)
  const ready = ref(true)
  const calls: number[] = []
  const pending: { idx: number; resolve: (m: Float32Array) => void; reject: (e: Error) => void }[] =
    []

  const loadMatrix = (idx: number) => {
    calls.push(idx)
    return new Promise<Float32Array>((resolve, reject) => {
      pending.push({ idx, resolve, reject })
    })
  }

  const deps: IonChannelDeps = {
    currentMzIndex,
    currentMz,
    tolerance,
    isContinuous,
    ready,
    loadMatrix,
    ...overrides,
  }
  return { deps, calls, pending }
}

const m = (v = 1) => new Float32Array([v, v, v, v])

/** Let the loader's .then/.catch callbacks run. */
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('useIonChannels', () => {
  it('assigns channel colors in order', () => {
    const { deps, pending } = makeDeps()
    const c = useIonChannels(deps)

    for (let i = 0; i < 3; i++) {
      deps.currentMzIndex.value = 100 + i
      const res = c.addCurrentMz()
      expect(res.ok).toBe(true)
      pending[i]!.resolve(m())
    }

    expect(c.channels.value.map((ch) => ch.colorIndex)).toEqual([0, 1, 2])
    expect(c.channels.value[0]!.color).toEqual(ION_CHANNEL_COLORS[0])
  })

  it('rejects more than the maximum number of channels', () => {
    const { deps, pending } = makeDeps()
    const c = useIonChannels(deps)

    for (let i = 0; i < MAX_ION_CHANNELS; i++) {
      deps.currentMzIndex.value = i
      expect(c.addCurrentMz().ok).toBe(true)
      pending[i]!.resolve(m())
    }
    deps.currentMzIndex.value = 999
    expect(c.addCurrentMz()).toEqual({ ok: false, reason: 'full' })
    expect(c.channels.value).toHaveLength(MAX_ION_CHANNELS)
  })

  it('rejects a duplicate m/z index', () => {
    const { deps, pending, calls } = makeDeps()
    const c = useIonChannels(deps)

    expect(c.addCurrentMz().ok).toBe(true)
    pending[0]!.resolve(m())
    expect(c.addCurrentMz()).toEqual({ ok: false, reason: 'duplicate' })
    expect(calls).toEqual([100])
  })

  it('reuses a freed color slot after removal', async () => {
    const { deps, pending } = makeDeps()
    const c = useIonChannels(deps)

    for (let i = 0; i < 3; i++) {
      deps.currentMzIndex.value = 100 + i
      c.addCurrentMz()
      pending[i]!.resolve(m())
      await flush()
    }
    c.removeChannel(c.channels.value[1]!.id)
    deps.currentMzIndex.value = 500
    c.addCurrentMz()
    expect(c.channels.value.map((ch) => ch.colorIndex)).toEqual([0, 2, 1])
  })

  it('marks a failed load on the channel row instead of dropping it', async () => {
    const { deps, pending } = makeDeps()
    const c = useIonChannels(deps)

    c.addCurrentMz()
    pending[0]!.reject(new Error('boom'))
    await flush()

    expect(c.channels.value).toHaveLength(1)
    // 错误只保留面向用户的一句话（本地化），不泄漏底层 err.message
    expect(c.channels.value[0]!.error).toBeTruthy()
    expect(c.channels.value[0]!.error).not.toBe('boom')
    expect(c.channels.value[0]!.loading).toBe(false)
  })

  it('drops a load that resolves after the channel was removed', async () => {
    const { deps, pending } = makeDeps()
    const c = useIonChannels(deps)

    c.addCurrentMz()
    const id = c.channels.value[0]!.id
    c.removeChannel(id)
    pending[0]!.resolve(m())
    await flush()

    expect(c.channels.value).toHaveLength(0)
  })

  it('clears channels on reset and leaves the mode', async () => {
    const { deps, pending } = makeDeps()
    const c = useIonChannels(deps)

    c.enabled.value = true
    c.addCurrentMz()
    pending[0]!.resolve(m())
    await flush()

    c.reset()
    expect(c.channels.value).toEqual([])
    expect(c.enabled.value).toBe(false)
    expect(c.overlayActive.value).toBe(false)
  })

  it('drops in-flight loads after reset', async () => {
    const { deps, pending } = makeDeps()
    const c = useIonChannels(deps)

    c.addCurrentMz()
    c.reset()
    pending[0]!.resolve(m())
    await flush()

    expect(c.channels.value).toEqual([])
  })

  it('only blends visible, loaded channels', async () => {
    const { deps, pending } = makeDeps()
    const c = useIonChannels(deps)

    deps.currentMzIndex.value = 1
    c.addCurrentMz()
    pending[0]!.resolve(m())
    await flush()
    deps.currentMzIndex.value = 2
    c.addCurrentMz()
    // second channel still loading → not blended yet
    expect(c.blendChannels.value).toHaveLength(1)

    pending[1]!.resolve(m())
    await flush()
    expect(c.blendChannels.value).toHaveLength(2)

    c.toggleChannelVisible(c.channels.value[0]!.id)
    expect(c.blendChannels.value).toHaveLength(1)
  })

  it('updates a channel color and clamps its opacity', () => {
    const { deps } = makeDeps()
    const c = useIonChannels(deps)
    c.addCurrentMz()
    const id = c.channels.value[0]!.id

    c.updateChannelColor(id, { r: 12, g: 34, b: 56 })
    c.updateChannelOpacity(id, 2)

    expect(c.channels.value[0]!.color).toEqual({ r: 12, g: 34, b: 56 })
    expect(c.channels.value[0]!.opacity).toBe(1)
  })

  it('reports overlayActive only when enabled with a loaded channel', async () => {
    const { deps, pending } = makeDeps()
    const c = useIonChannels(deps)

    c.addCurrentMz()
    pending[0]!.resolve(m())
    await flush()
    expect(c.overlayActive.value).toBe(false) // enabled is still false
    c.enabled.value = true
    expect(c.overlayActive.value).toBe(true)
  })

  it('refuses to add for non-continuous or non-ready data', () => {
    const { deps } = makeDeps({ isContinuous: ref(false) })
    const c = useIonChannels(deps)
    expect(c.addCurrentMz()).toEqual({ ok: false, reason: 'not-continuous' })

    const { deps: deps2 } = makeDeps({ ready: ref(false) })
    const c2 = useIonChannels(deps2)
    expect(c2.addCurrentMz()).toEqual({ ok: false, reason: 'not-ready' })
  })
})
