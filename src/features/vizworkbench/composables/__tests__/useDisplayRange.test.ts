import { describe, expect, it } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useDisplayRange } from '../useDisplayRange'

function setup(values: number[]) {
  const matrix = ref<Float32Array | null>(Float32Array.from(values))
  const colormap = ref('gray')
  let api!: ReturnType<typeof useDisplayRange>
  mount(
    defineComponent({
      setup() {
        api = useDisplayRange(matrix, colormap, ref(values.length), ref(1))
        return () => null
      },
    }),
  )
  return { api, matrix, colormap }
}

describe('useDisplayRange', () => {
  it('builds the gradient from the stops the image is drawn with', () => {
    const { api, colormap } = setup([1, 2, 3, 4])
    expect(api.gradientCSS.value).toContain('rgb(0 0 0)')
    expect(api.gradientCSS.value).toContain('rgb(255 255 255)')
    colormap.value = 'viridis'
    expect(api.gradientCSS.value).toContain('rgb(68 1 84)')
  })

  it('carries a manual range over to the next matrix, as fractions of its span', async () => {
    const { api, matrix } = setup([1, 2, 3, 4])
    api.displayMax.value = 4
    matrix.value = Float32Array.from([10, 20, 30, 40])
    await nextTick()
    expect(api.globalMax.value).toBe(40)
    expect(api.displayMax.value).toBe(40)
  })

  it('goes back to the automatic range on reset', async () => {
    const { api, matrix } = setup([1, 2, 3, 4])
    api.displayMax.value = 1
    matrix.value = Float32Array.from([10, 20, 30, 40])
    await nextTick()
    expect(api.displayMax.value).toBe(10)
    api.resetRange()
    expect(api.displayMax.value).toBe(40)
  })

  it('ignores non-finite pixels in the statistics', () => {
    const { api } = setup([1, Number.NaN, 3, Number.POSITIVE_INFINITY])
    expect(api.globalMax.value).toBe(3)
    expect(api.imageInfo.value.nonZero).toBe('50.0%')
    expect(api.intensityHistogram.value.reduce((a, b) => a + b, 0)).toBe(2)
  })
})
