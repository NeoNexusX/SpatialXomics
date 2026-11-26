export type ROIContourType = 'polygon' | 'freehand'
export type ROIType = 'rectangle' | 'ellipse' | ROIContourType
/** Drawing tools plus collecting the current ion image's pixels by signal. */
export type RoiTool = ROIType | 'collect'
export type SignalPresence = 'present' | 'absent'
/** What the collect tool selects: acquired pixels with or without signal, or all of them. */
export type CollectKind = SignalPresence | 'all'
export type MaskOperation = 'union' | 'difference' | 'intersection'

export interface ROIPoint {
  x: number
  y: number
}

export interface ROIBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface DraftROI {
  type: ROIType
  rect: ROIBox | null
  path: ROIPoint[]
}

export function isRoiContour(type: RoiTool | null): type is ROIContourType {
  return type === 'polygon' || type === 'freehand'
}

/** Drawing tools take pointer input on the image; collecting is driven from the panel. */
export function isRoiDrawingTool(tool: RoiTool | null): tool is ROIType {
  return !!tool && tool !== 'collect'
}

/** Signal is a finite intensity above zero, i.e. a pixel the ion image paints. */
function hasSignal(value: number) {
  return Number.isFinite(value) && value > 0
}

/**
 * Select acquired pixels with or without signal. Ion images hold 0 in cells that
 * were never acquired, so `acquired` keeps those cells out of both results.
 */
export function signalMask(
  matrix: Float32Array,
  acquired: Uint8Array,
  presence: SignalPresence,
): Uint8Array {
  const mask = new Uint8Array(acquired.length)
  const present = presence === 'present'
  for (let i = 0; i < mask.length; i++) {
    if (acquired[i] && hasSignal(matrix[i]!) === present) mask[i] = 1
  }
  return mask
}

/** Acquired pixel counts of both {@link signalMask} results. */
export function countSignal(matrix: Float32Array, acquired: Uint8Array) {
  let present = 0
  let absent = 0
  for (let i = 0; i < acquired.length; i++) {
    if (!acquired[i]) continue
    if (hasSignal(matrix[i]!)) present++
    else absent++
  }
  return { present, absent }
}

export function roiBoxBounds({ x0, y0, x1, y1 }: ROIBox) {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  }
}

/** Paint on the original image grid. Paths use pixel centers and the even-odd rule. */
export function paintRoiShape(
  mask: Uint8Array | null,
  width: number,
  height: number,
  shape: DraftROI,
  value: 0 | 1,
): number {
  let count = 0
  function span(row: number, start: number, end: number) {
    const first = Math.max(0, start)
    const last = Math.min(width, end)
    if (last <= first) return
    mask?.fill(value, row * width + first, row * width + last)
    count += last - first
  }

  if (isRoiContour(shape.type)) {
    const points = shape.path
    if (points.length < 3) return 0
    let minY = Infinity
    let maxY = -Infinity
    for (const { y } of points) {
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    const crossings: number[] = []
    for (let row = Math.max(0, Math.ceil(minY - 0.5)); row < Math.min(height, maxY - 0.5); row++) {
      const y = row + 0.5
      crossings.length = 0
      // Half-open edge ranges count a vertex shared by two edges only once per crossing.
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[j]!
        const b = points[i]!
        if (a.y > y !== b.y > y) {
          crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
        }
      }
      crossings.sort((a, b) => a - b)
      for (let i = 1; i < crossings.length; i += 2) {
        span(row, Math.ceil(crossings[i - 1]! - 0.5), Math.ceil(crossings[i]! - 0.5))
      }
    }
    return count
  }

  if (!shape.rect) return 0
  const { left, top, right, bottom } = roiBoxBounds(shape.rect)
  if (shape.type === 'rectangle') {
    // A rectangle includes both endpoint cells.
    for (
      let row = Math.max(0, Math.floor(top));
      row <= Math.min(height - 1, Math.floor(bottom));
      row++
    ) {
      span(row, Math.floor(left), Math.floor(right) + 1)
    }
    return count
  }

  const rx = (right - left) / 2
  const ry = (bottom - top) / 2
  if (!rx || !ry) return 0
  const cx = left + rx
  const cy = top + ry
  for (
    let row = Math.max(0, Math.ceil(top - 0.5));
    row <= Math.min(height - 1, bottom - 0.5);
    row++
  ) {
    const dx = rx * Math.sqrt(Math.max(0, 1 - ((row + 0.5 - cy) / ry) ** 2))
    span(row, Math.ceil(cx - dx - 0.5), Math.floor(cx + dx - 0.5) + 1)
  }
  return count
}

/** Both masks contain only 0 and 1 and share a grid. Update the first mask in place. */
export function intersectRoiMasks(target: Uint8Array, operand: Uint8Array) {
  for (let i = 0; i < target.length; i++) target[i] = target[i]! & operand[i]!
}

/** Trace the exposed cell edges, coalescing runs to keep the SVG path compact. */
export function roiMaskOutline(mask: Uint8Array, width: number, height: number): string {
  const edges: string[] = []

  for (let y = 0; y <= height; y++) {
    const above = (y - 1) * width
    const below = y * width
    let start = -1
    for (let x = 0; x <= width; x++) {
      const exposed = x < width && (mask[above + x] ?? 0) !== (mask[below + x] ?? 0)
      if (exposed && start < 0) start = x
      if (!exposed && start >= 0) {
        edges.push(`M${start} ${y}h${x - start}`)
        start = -1
      }
    }
  }

  for (let x = 0; x <= width; x++) {
    let start = -1
    for (let y = 0; y <= height; y++) {
      const left = x > 0 ? mask[y * width + x - 1] : 0
      const right = x < width ? mask[y * width + x] : 0
      const exposed = y < height && left !== right
      if (exposed && start < 0) start = y
      if (!exposed && start >= 0) {
        edges.push(`M${x} ${start}v${y - start}`)
        start = -1
      }
    }
  }

  return edges.join(' ')
}

/** Mask area includes all selected cells. Intensity statistics use finite samples only. */
export function summarizeRoiMask(mask: Uint8Array, matrix: Float32Array | null) {
  const values = matrix?.length === mask.length ? matrix : null
  let pixelCount = 0
  let count = 0
  let sum = 0
  let mean = 0
  let squaredDeviations = 0
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    pixelCount++
    if (!values) continue
    const value = values[i]!
    if (!Number.isFinite(value)) continue
    count++
    sum += value
    min = Math.min(min, value)
    max = Math.max(max, value)
    // Welford's update gives the population variance in the same pass.
    const delta = value - mean
    mean += delta / count
    squaredDeviations += delta * (value - mean)
  }
  const stats = count
    ? {
        mean: sum / count,
        std: Math.sqrt(squaredDeviations / count),
        min,
        max,
      }
    : null
  return { pixelCount, sampleCount: count, sum, stats }
}
