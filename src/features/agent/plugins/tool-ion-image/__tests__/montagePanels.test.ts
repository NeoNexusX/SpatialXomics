import { afterEach, expect, it, vi } from 'vitest'
import { renderIonImages, type RenderOptions } from '../render'

/**
 * jsdom 没有 canvas，但拼图序号是画上去的文字——只有让真正的 renderIonImages
 * 跑起来、记录 fillText，才能验证模型看到的 #N 和 summaries 的编号对得上。
 */
function recordingCanvas() {
  const labels: string[] = []
  const create = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
    const ctx = {
      fillStyle: '',
      font: '',
      textAlign: '',
      textBaseline: '',
      imageSmoothingEnabled: true,
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
      drawImage: () => {},
      fillRect: () => {},
      fillText: (text: string) => labels.push(text),
    }
    return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,' }
  }) as never)
  return { labels, create }
}

afterEach(() => vi.restoreAllMocks())

const options: RenderOptions = {
  colormap: 'gray',
  scale: 'linear',
  gamma: 1,
  display: 'max',
  normalize: 'shared',
  layout: 'montage',
  columns: 2,
  width: 384,
}

const raster = (label: string, panel: number) => ({
  matrix: new Float32Array([0, 10, 0, 0]),
  width: 2,
  height: 2,
  label,
  panel,
})

it('numbers montage panels by requested target so a failed target does not shift the rest', () => {
  // 请求 5 个目标、第 2 个取不到：成功数组下标 0..3 对应请求序号 1,3,4,5。
  const { labels } = recordingCanvas()
  const out = renderIonImages([raster('A', 1), raster('C', 3), raster('D', 4), raster('E', 5)], options)
  expect(labels).toEqual(['#1', '#3', '#4', '#5'])
  expect(out.description).toContain('ranges #1 ')
  expect(out.description).toContain('#5 ')
  expect(out.description).not.toContain('#2 ')
  expect(out.description).toContain('requested target numbers')
})

it('falls back to array order when no requested numbers are supplied', () => {
  const { labels } = recordingCanvas()
  const images = [{ ...raster('A', 0), panel: undefined }, { ...raster('B', 0), panel: undefined }]
  renderIonImages(images, options)
  expect(labels).toEqual(['#1', '#2'])
})