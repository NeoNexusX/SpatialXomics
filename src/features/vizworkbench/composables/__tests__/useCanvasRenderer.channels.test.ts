import { describe, expect, it, beforeEach } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useCanvasRenderer } from '../useCanvasRenderer'
import { installCanvasStub, px } from './canvasStub'
import type { BlendChannel } from '../../utils/ionChannelBlend'

/**
 * Everything that matters for the multi-ion path — which pixels get written and
 * in what order — is observable through the canvas stub; the per-pixel math
 * itself lives in ionChannelBlend.ts and is covered there.
 */
let puts: ImageData[]

interface Harness {
  render: () => void
  exportTransparentCanvas: () => HTMLCanvasElement | null
  matrix: Ref<Float32Array | null>
  channels: Ref<BlendChannel[]>
  channelsMode: Ref<boolean>
  roiMask: Ref<Uint8Array | null>
}

/** Mount a throwaway component so the composable's lifecycle hooks are legal. */
function makeRenderer(): Harness {
  const canvasRef = ref<HTMLCanvasElement | null>(document.createElement('canvas'))
  const containerW = ref(200)
  const containerH = ref(100)
  const matrix = ref<Float32Array | null>(null)
  const channels = ref<BlendChannel[]>([])
  const channelsMode = ref(false)
  const roiMask = ref<Uint8Array | null>(null)
  const staticRef = <T>(v: T) => ref(v)

  let api: ReturnType<typeof useCanvasRenderer> | null = null
  const Harness = defineComponent({
    setup() {
      api = useCanvasRenderer({
        canvasRef,
        containerW,
        containerH,
        matrix,
        matrixCols: staticRef(2),
        matrixRows: staticRef(2),
        colormap: staticRef('inferno'),
        intensityScale: staticRef('linear'),
        gamma: staticRef(1),
        displayMin: staticRef<number | undefined>(undefined),
        displayMax: staticRef<number | undefined>(undefined),
        overlayData: ref<Uint8ClampedArray | null>(null),
        overlayWidth: staticRef(0),
        overlayHeight: staticRef(0),
        channels,
        channelsMode,
        roiMask,
      })
      return () => h('div')
    },
  })
  mount(Harness)
  return {
    render: () => api!.render(),
    exportTransparentCanvas: () => api!.exportTransparentCanvas(),
    matrix,
    channels,
    channelsMode,
    roiMask,
  }
}

describe('useCanvasRenderer multi-ion channels', () => {
  beforeEach(() => {
    puts = installCanvasStub().puts
  })

  it('renders the additive channel composite when channels mode is on', () => {
    const r = makeRenderer()
    r.channelsMode.value = true
    // 2x2: indices 0,1 are 0; 2,3 are at the channel max. P1=0, P95=10.
    r.channels.value = [{ matrix: new Float32Array([0, 0, 10, 10]), color: { r: 255, g: 0, b: 0 } }]

    r.render()

    const grid = puts.find((p) => p.width === 2 && p.height === 2)!
    expect(grid).toBeTruthy()
    expect(px(grid, 2)).toEqual([255, 0, 0, 255])
    expect(px(grid, 0)).toEqual([0x0a, 0x0a, 0x0f, 255])
  })

  it('adds overlapping channels into yellow', () => {
    const r = makeRenderer()
    r.channelsMode.value = true
    r.channels.value = [
      { matrix: new Float32Array([0, 0, 10, 10]), color: { r: 255, g: 0, b: 0 } },
      { matrix: new Float32Array([0, 10, 10, 10]), color: { r: 0, g: 255, b: 0 } },
    ]

    r.render()

    const grid = puts.find((p) => p.width === 2 && p.height === 2)!
    expect(px(grid, 2)).toEqual([255, 255, 0, 255])
  })

  it('keeps the single-image path when channels mode is off', () => {
    const r = makeRenderer()
    r.matrix.value = new Float32Array([0, 0, 10, 10])
    r.channels.value = [{ matrix: new Float32Array([0, 0, 10, 10]), color: { r: 255, g: 0, b: 0 } }]
    // channelsMode stays false

    r.render()

    const grid = puts.find((p) => p.width === 2 && p.height === 2)!
    // colormap path: values come from the LUT, never the raw channel color
    expect(px(grid, 2)).not.toEqual([255, 0, 0, 255])
    expect(px(grid, 2)![3]).toBe(255)
  })

  it('applies the ROI mask to the composite', () => {
    const r = makeRenderer()
    r.channelsMode.value = true
    // P1=8, P95=10 → indices 0 and 1 are at full intensity.
    r.channels.value = [{ matrix: new Float32Array([10, 10, 9, 8]), color: { r: 255, g: 0, b: 0 } }]
    r.roiMask.value = new Uint8Array([1, 0, 0, 0])

    r.render()

    const grid = puts.find((p) => p.width === 2 && p.height === 2)!
    // Pixel 0 survives the mask; pixel 1 is masked out despite full intensity.
    expect(px(grid, 0)).toEqual([255, 0, 0, 255])
    expect(px(grid, 1)).toEqual([0x0a, 0x0a, 0x0f, 255])
  })

  it('exports a transparent composite when only channels are present', () => {
    const r = makeRenderer()
    r.channelsMode.value = true
    // No single-image matrix at all — the export must still succeed.
    r.channels.value = [{ matrix: new Float32Array([0, 0, 10, 10]), color: { r: 255, g: 0, b: 0 } }]

    const canvas = r.exportTransparentCanvas()
    expect(canvas).not.toBeNull()

    const grid = puts.find((p) => p.width === 2 && p.height === 2)!
    expect(px(grid, 2)).toEqual([255, 0, 0, 255])
    // Empty pixels stay transparent on the export path.
    expect(px(grid, 0)).toEqual([0, 0, 0, 0])
  })

  it('returns null from export when there is nothing to draw', () => {
    const r = makeRenderer()
    expect(r.exportTransparentCanvas()).toBeNull()
  })

  it('does not use the channel path without any loaded channel', () => {
    const r = makeRenderer()
    r.channelsMode.value = true
    r.channels.value = []
    r.matrix.value = new Float32Array([0, 0, 10, 10])

    r.render()

    // Falls back to the single-image colormap path rather than blanking out.
    const grid = puts.find((p) => p.width === 2 && p.height === 2)!
    expect(px(grid, 2)![3]).toBe(255)
    expect(px(grid, 2)).not.toEqual([255, 0, 0, 255])
  })
})
