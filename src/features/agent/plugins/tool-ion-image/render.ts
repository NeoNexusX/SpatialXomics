import { buildLUT } from '@/shared/viz/colormapLut'
import type { ToolImage } from '../llm'

export interface IonRaster {
  matrix: Float32Array
  width: number
  height: number
  label: string
}

export interface RenderOptions {
  colormap: string
  scale: string
  gamma: number
  display: string
  normalize: string
  layout: string
  columns: number
  width: number
}

export function displayRange(images: IonRaster[], display: string): [number, number] {
  const sampled: number[] = []
  for (const image of images) {
    const stride = Math.max(1, Math.ceil(image.matrix.length / 10000))
    for (let i = 0; i < image.matrix.length; i += stride) {
      const value = image.matrix[i]!
      if (Number.isFinite(value) && value > 0) sampled.push(value)
    }
  }
  sampled.sort((a, b) => a - b)
  const percentile = (p: number) =>
    sampled[Math.min(sampled.length - 1, Math.floor(sampled.length * p))] ?? 0
  // Max display must include isolated hotspots, even when they fall between samples.
  let max = 0
  if (display === 'max')
    for (const image of images)
      for (const value of image.matrix) if (Number.isFinite(value)) max = Math.max(max, value)
  return display === 'p1p95'
    ? [percentile(0.01), percentile(0.95)]
    : [0, display === 'max' ? max : percentile(0.99)]
}

export function rasterize(
  image: IonRaster,
  range: [number, number],
  options: RenderOptions,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(image.width * image.height * 4)
  const lut = buildLUT(options.colormap)
  const transform = (value: number) =>
    options.scale === 'log' ? Math.log1p(Math.max(0, value)) : value
  const low = transform(range[0])
  const high = transform(range[1])
  for (let i = 0; i < image.matrix.length; i++) {
    const value = image.matrix[i]!
    let normalized = high > low ? (transform(value) - low) / (high - low) : Number(value > 0)
    normalized = Math.pow(Math.max(0, Math.min(1, normalized)), 1 / options.gamma)
    const color =
      Number.isFinite(value) && value > 0 ? lut[Math.round(normalized * 255)]! : [0, 0, 0]
    pixels[i * 4] = color[0]!
    pixels[i * 4 + 1] = color[1]!
    pixels[i * 4 + 2] = color[2]!
    pixels[i * 4 + 3] = 255
  }
  return pixels
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas rendering is unavailable')
  return { canvas, ctx }
}

export function renderIonImages(
  images: IonRaster[],
  options: RenderOptions,
): { images: ToolImage[]; description: string } {
  const shared = displayRange(images, options.display)
  const ranges = images.map((image) =>
    options.normalize === 'shared' ? shared : displayRange([image], options.display),
  )
  const montage = options.layout === 'montage'
  const columns = montage ? Math.min(options.columns, images.length) : 1
  const rows = Math.ceil(images.length / columns)
  // Limit final montage dimensions as well as individual panels.
  const labelHeight = 24
  const side = Math.min(
    options.width,
    Math.floor(1536 / columns),
    Math.floor(1536 / rows) - labelHeight,
  )
  const panels = images.map((image, index) => {
    const raw = canvas2d(image.width, image.height)
    const data = raw.ctx.createImageData(image.width, image.height)
    data.data.set(rasterize(image, ranges[index]!, options))
    raw.ctx.putImageData(data, 0, 0)
    const ratio = side / Math.max(image.width, image.height)
    const width = Math.max(1, Math.round(image.width * ratio))
    const height = Math.max(1, Math.round(image.height * ratio))
    const panel = canvas2d(side, side + labelHeight)
    panel.ctx.fillStyle = '#080808'
    panel.ctx.fillRect(0, 0, panel.canvas.width, panel.canvas.height)
    panel.ctx.imageSmoothingEnabled = false
    panel.ctx.drawImage(
      raw.canvas,
      (side - width) / 2,
      labelHeight + (side - height) / 2,
      width,
      height,
    )
    panel.ctx.fillStyle = '#ffffff'
    panel.ctx.font = '12px sans-serif'
    panel.ctx.fillText(image.label, 6, 16, side - 12)
    return panel.canvas
  })
  let canvases = panels
  if (montage) {
    const sheet = canvas2d(columns * side, rows * (side + labelHeight))
    panels.forEach((panel, index) =>
      sheet.ctx.drawImage(
        panel,
        (index % columns) * side,
        Math.floor(index / columns) * (side + labelHeight),
      ),
    )
    canvases = [sheet.canvas]
  }
  return {
    images: canvases.map((canvas, index) => ({
      dataUrl: canvas.toDataURL('image/png'),
      mime: 'image/png',
      width: canvas.width,
      height: canvas.height,
      label: montage ? images.map((image) => image.label).join(' | ') : images[index]!.label,
    })),
    description: `${options.colormap}, ${options.scale}, gamma=${options.gamma}, ${options.normalize} ${options.display}; ranges ${ranges.map((range, i) => `#${i + 1} ${range[0]}–${range[1]}`).join(', ')}. Color encodes ion intensity. Rows run top to bottom, columns left to right.`,
  }
}
