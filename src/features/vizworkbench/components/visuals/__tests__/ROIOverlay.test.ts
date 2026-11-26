import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import { useROI } from '@/features/vizworkbench/composables/useROI'
import { useRoiCollect } from '@/features/vizworkbench/composables/useRoiCollect'
import { installCanvasStub, px } from '@/features/vizworkbench/composables/__tests__/canvasStub'
import { hexToRgb } from '@/features/vizworkbench/utils/regionPalette'
import ROIOverlay from '../ROIOverlay.vue'

beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('vizworkbench')]))
enableAutoUnmount(afterEach)

it('paints a collected mask instead of outlining it and leaves the image interactive', async () => {
  const { puts } = installCanvasStub()
  const matrix = ref<Float32Array | null>(Float32Array.of(5, 0, 2, 0))
  const { editor } = useROI(matrix, ref({ runId: '', shape: [2, 2] as const }))
  const collect = useRoiCollect(editor, {
    matrix,
    acquired: ref(Uint8Array.of(1, 1, 1, 0)),
    image: ref('TIC' as const),
    available: ref(true),
    loading: ref(false),
  })
  editor.selectTool('collect')
  collect.stage('present')
  const overlay = mount(ROIOverlay, {
    props: {
      editor,
      imageWidth: 2,
      imageHeight: 2,
      imageRect: { x: 0, y: 0, width: 20, height: 20 },
    },
    global: { plugins: [i18n] },
  })
  await nextTick()

  expect(overlay.classes()).toContain('pointer-events-none')
  expect(overlay.find('[data-testid="roi-pending-outline"]').exists()).toBe(false)
  expect(overlay.find('[data-testid="roi-shape-fill"]').exists()).toBe(true)
  const { r, g, b } = hexToRgb(editor.shapeColor!)!
  const image = puts[puts.length - 1]!
  expect([0, 1, 2, 3].map((i) => px(image, i))).toEqual([
    [r, g, b, 153],
    [0, 0, 0, 0],
    [r, g, b, 153],
    [0, 0, 0, 0],
  ])

  editor.confirmShape()
  await nextTick()
  expect(overlay.find('[data-testid="roi-shape-fill"]').exists()).toBe(true)
  expect(overlay.find('[data-testid="roi-shape-outline"]').exists()).toBe(false)
  expect(overlay.find('[data-testid="roi-draft-outline"]').exists()).toBe(true)
})
