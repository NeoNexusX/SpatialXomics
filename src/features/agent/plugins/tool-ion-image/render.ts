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
  /** 显式显示范围 [min,max]；缺省按 display 从矩阵推导（get_ion 复刻用户真实范围用） */
  range?: [number, number]
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

/**
 * 叠加层栅格（UMAP/KMeans 的 H×W×3 uint8）→ RGBA（jsdom 可测的纯函数）。
 *
 * 前景判断**不依赖颜色**（审核约束 5）：
 * - occupancy 模式：mask 非零即前景（UMAP 用，RGB (0,0,0) 的有效点保留）
 * - labels 模式：labels[i] ∈ visibleIds 即前景（KMeans 用，镜像 computeKmeansOverlay 语义）
 * 只有两者都缺省时才退回「非黑即前景」（老导出行为，仅作为兼容兜底）。
 */
export function overlayImageData(
  rgb: Uint8Array,
  width: number,
  height: number,
  mask?: { occupancy?: Uint8Array; labels?: Int32Array; visibleIds?: Set<number> } | null,
): Uint8ClampedArray {
  const n = width * height
  const rgba = new Uint8ClampedArray(n * 4)
  const occupancy = mask?.occupancy
  const labels = mask?.labels
  const visibleIds = mask?.visibleIds
  for (let i = 0; i < n; i++) {
    let foreground: boolean
    if (occupancy) foreground = occupancy[i] === 1
    else if (labels && visibleIds) foreground = labels[i]! >= 0 && visibleIds.has(labels[i]!)
    else if (labels) foreground = labels[i]! >= 0
    else foreground = rgb[i * 3] !== 0 || rgb[i * 3 + 1] !== 0 || rgb[i * 3 + 2] !== 0
    if (!foreground) continue
    const off = i * 4
    rgba[off] = rgb[i * 3]!
    rgba[off + 1] = rgb[i * 3 + 1]!
    rgba[off + 2] = rgb[i * 3 + 2]!
    rgba[off + 3] = 255
  }
  return rgba
}

/** 叠加图图例项：色块用簇色，label 为 "#<id> (<count> px)" 一类文本。 */
export interface OverlayLegendItem {
  color: readonly [number, number, number]
  label: string
}

const LEGEND_ROW_HEIGHT = 18
const LEGEND_FONT = '11px sans-serif'
const LEGEND_SWATCH = 10
const LEGEND_PAD = 8
/** 图例带最小宽度：小尺寸栅格（如 2×1）放大后画布仍很窄，保证图例可读。 */
const LEGEND_MIN_BAND_WIDTH = 360

/**
 * 图例带布局（纯函数）：每行 ≤3 项，>12 项截断为 "+N more"。
 * 返回每个格子的左上坐标（相对图例带原点）、色块（null = 纯文本）与带高。
 */
export function legendLayout(items: readonly OverlayLegendItem[], width: number): {
  cells: { x: number; y: number; swatch: readonly [number, number, number] | null; label: string }[]
  height: number
  truncated: number
} {
  const column = width / 3
  const shown = items.slice(0, 12)
  const place = (index: number, label: string, swatch: readonly [number, number, number] | null) => ({
    x: Math.floor((index % 3) * column) + LEGEND_PAD,
    y: Math.floor(index / 3) * LEGEND_ROW_HEIGHT + 4,
    swatch,
    label,
  })
  const cells = shown.map((item, index) => place(index, item.label, item.color))
  const truncated = items.length - shown.length
  if (truncated > 0) cells.push(place(shown.length, `+${truncated} more`, null))
  const rows = Math.ceil(cells.length / 3)
  return { cells, height: rows * LEGEND_ROW_HEIGHT + LEGEND_PAD, truncated }
}

/** 邻近放大的叠加层 ToolImage（逻辑取自 useOverlayData.exportRgbPng，但返回 dataUrl 不触发下载）。 */
export function renderOverlayImage(
  rgb: Uint8Array,
  width: number,
  height: number,
  label: string,
  mask?: { occupancy?: Uint8Array; labels?: Int32Array; visibleIds?: Set<number> } | null,
  legend?: readonly OverlayLegendItem[],
): ToolImage {
  const scale = Math.min(4, Math.max(1, Math.floor(640 / Math.max(width, height))))
  const data = overlayImageData(rgb, width, height, mask)
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas rendering is unavailable')
  ctx.imageSmoothingEnabled = false
  const src = document.createElement('canvas')
  src.width = width
  src.height = height
  const sctx = src.getContext('2d')
  if (!sctx) throw new Error('Canvas rendering is unavailable')
  const imageData = sctx.createImageData(width, height)
  imageData.data.set(data)
  sctx.putImageData(imageData, 0, 0)
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  // 无图例：与历史输出逐字节一致（提前返回，不动原画布）。
  if (!legend || legend.length === 0) {
    return {
      dataUrl: canvas.toDataURL('image/png'),
      mime: 'image/png',
      width: canvas.width,
      height: canvas.height,
      label,
    }
  }
  const bandWidth = Math.max(canvas.width, LEGEND_MIN_BAND_WIDTH)
  const layout = legendLayout(legend, bandWidth)
  const out = document.createElement('canvas')
  out.width = bandWidth
  out.height = canvas.height + layout.height
  const octx = out.getContext('2d')
  if (!octx) throw new Error('Canvas rendering is unavailable')
  octx.drawImage(canvas, 0, 0)
  octx.fillStyle = '#080808'
  octx.fillRect(0, canvas.height, out.width, layout.height)
  octx.font = LEGEND_FONT
  octx.textBaseline = 'top'
  for (const cell of layout.cells) {
    const y = canvas.height + cell.y
    if (cell.swatch) {
      octx.fillStyle = `rgb(${cell.swatch[0]}, ${cell.swatch[1]}, ${cell.swatch[2]})`
      octx.fillRect(cell.x, y, LEGEND_SWATCH, LEGEND_SWATCH)
      octx.fillStyle = '#ffffff'
      octx.fillText(cell.label, cell.x + LEGEND_SWATCH + 4, y)
    } else {
      octx.fillStyle = '#ffffff'
      octx.fillText(cell.label, cell.x, y)
    }
  }
  return {
    dataUrl: out.toDataURL('image/png'),
    mime: 'image/png',
    width: out.width,
    height: out.height,
    label,
  }
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas rendering is unavailable')
  return { canvas, ctx }
}

// ---- 单像素谱图（get_pixel_spectrum 附图） ----

export interface SpectrumPlotPeak {
  mz: number
  intensity: number
}

const SPECTRUM_PLOT_WIDTH = 768
const SPECTRUM_PLOT_HEIGHT = 384
const SPECTRUM_MAX_PEAKS = 2000
/** 窗口峰高亮匹配容差（±1e-4 m/z） */
export const SPECTRUM_HIGHLIGHT_TOLERANCE = 1e-4

/** 高亮判定：mz 与任一 highlightMz 之差 ≤ 1e-4。 */
export function isSpectrumHighlight(
  mz: number,
  highlightMzs: readonly number[] | undefined,
): boolean {
  if (!highlightMzs?.length) return false
  return highlightMzs.some((target) => Math.abs(target - mz) <= SPECTRUM_HIGHLIGHT_TOLERANCE)
}

/** 绘制峰选择（纯函数）：≤2000 全画；超出按强度降序取前 2000，高亮集始终保留。 */
export function selectPlotPeaks(
  peaks: readonly SpectrumPlotPeak[],
  highlightMzs: readonly number[] | undefined,
): SpectrumPlotPeak[] {
  if (peaks.length <= SPECTRUM_MAX_PEAKS) return [...peaks]
  const highlighted = peaks.filter((peak) => isSpectrumHighlight(peak.mz, highlightMzs))
  const rest = peaks
    .filter((peak) => !isSpectrumHighlight(peak.mz, highlightMzs))
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, Math.max(0, SPECTRUM_MAX_PEAKS - highlighted.length))
  return [...rest, ...highlighted]
}

/** 棒状谱图 PNG：x=m/z 线性、y=强度归一；全谱 #9ca3af，highlightMzs 命中 #f59e0b。 */
export function renderSpectrumPlot(
  peaks: readonly SpectrumPlotPeak[],
  options: { label: string; highlightMzs?: number[] },
): ToolImage {
  const { canvas, ctx } = canvas2d(SPECTRUM_PLOT_WIDTH, SPECTRUM_PLOT_HEIGHT)
  ctx.fillStyle = '#080808'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const drawn = selectPlotPeaks(peaks, options.highlightMzs)
  const mzMin = Math.min(...drawn.map((peak) => peak.mz))
  const mzMax = Math.max(...drawn.map((peak) => peak.mz))
  const maxIntensity = Math.max(...drawn.map((peak) => peak.intensity))
  if (drawn.length > 0 && Number.isFinite(mzMin) && maxIntensity > 0) {
    const left = 8
    const right = canvas.width - 8
    const top = 18
    const bottom = canvas.height - 14
    const span = mzMax - mzMin || 1
    const x = (mz: number) => left + ((mz - mzMin) / span) * (right - left)
    const y = (intensity: number) => bottom - (intensity / maxIntensity) * (bottom - top)
    ctx.lineWidth = 1
    for (const peak of drawn) {
      ctx.strokeStyle = isSpectrumHighlight(peak.mz, options.highlightMzs)
        ? '#f59e0b'
        : '#9ca3af'
      const px = x(peak.mz)
      ctx.beginPath()
      ctx.moveTo(px, bottom)
      ctx.lineTo(px, y(peak.intensity))
      ctx.stroke()
    }
    ctx.font = '11px sans-serif'
    ctx.fillStyle = '#d1d5db'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText(`m/z ${mzMin.toFixed(3)} – ${mzMax.toFixed(3)}`, left, 4)
    ctx.textAlign = 'right'
    ctx.fillText(`max intensity ${maxIntensity.toPrecision(6)}`, right, 4)
  }
  return {
    dataUrl: canvas.toDataURL('image/png'),
    mime: 'image/png',
    width: canvas.width,
    height: canvas.height,
    label: options.label,
  }
}

export function renderIonImages(
  images: IonRaster[],
  options: RenderOptions,
): { images: ToolImage[]; description: string } {
  const shared = displayRange(images, options.display)
  const ranges = images.map((image) =>
    options.range
      ? options.range
      : options.normalize === 'shared'
        ? shared
        : displayRange([image], options.display),
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
