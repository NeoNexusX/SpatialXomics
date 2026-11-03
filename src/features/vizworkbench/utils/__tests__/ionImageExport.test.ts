import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ION_IMAGE_FORMAT,
  ION_IMAGE_EXT,
  ION_IMAGE_MIME,
  flattenOnBackground,
  ionImageFilename,
} from '../ionImageExport'

describe('ionImageExport', () => {
  it('defaults to JPEG with the .jpg extension', () => {
    expect(DEFAULT_ION_IMAGE_FORMAT).toBe('jpeg')
    expect(ION_IMAGE_EXT.jpeg).toBe('jpg')
    expect(ION_IMAGE_MIME.jpeg).toBe('image/jpeg')
  })

  it('builds the filename from the existing label convention', () => {
    expect(ionImageFilename('_mz_445.049400', 'jpeg')).toBe('ion_image_mz_445.049400.jpg')
    expect(ionImageFilename('_channels_445.049400_500.000000', 'png')).toBe(
      'ion_image_channels_445.049400_500.000000.png',
    )
    expect(ionImageFilename('', 'png')).toBe('ion_image.png')
  })

  it('flattens onto an opaque background (JPEG has no alpha channel)', () => {
    const original = HTMLCanvasElement.prototype.getContext
    const calls: string[] = []
    let fillStyle = ''
    const ctx = {
      set fillStyle(v: string) {
        fillStyle = v
      },
      get fillStyle() {
        return fillStyle
      },
      fillRect: () => calls.push('fillRect'),
      drawImage: () => calls.push('drawImage'),
    }
    HTMLCanvasElement.prototype.getContext = function () {
      return ctx
    } as unknown as HTMLCanvasElement['getContext']

    try {
      const src = document.createElement('canvas')
      src.width = 4
      src.height = 2
      const out = flattenOnBackground(src, '#ffffff')

      expect(out).not.toBe(src)
      expect([out.width, out.height]).toEqual([4, 2])
      // 先铺底再画原图，顺序不能反
      expect(calls).toEqual(['fillRect', 'drawImage'])
      expect(fillStyle).toBe('#ffffff')
    } finally {
      HTMLCanvasElement.prototype.getContext = original
    }
  })
})
