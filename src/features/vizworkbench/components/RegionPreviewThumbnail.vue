<script setup lang="ts">
/**
 * Region preview thumbnail.
 *
 * Sits under the Compare Regions panel and shows the compared regions (A/B)
 * on a dimmed TIC backdrop, each in its own identity color (kmeans palette
 * color for clusters, palette-assigned color for ROIs). Confirmed ROIs are
 * also rendered as colored fills + outlines, so the thumbnail doubles as the
 * "where are my ROIs" overview (the main ion image intentionally doesn't draw
 * confirmed ROI frames).
 *
 * Rendering: masks are H×W grids (row*width+col), drawn into a 1:1 ImageData
 * and upscaled with drawImage - same pattern as the main canvas renderer, so
 * colors and geometry match the ion image exactly. The canvas itself is a
 * fixed-size box (see BOX_ASPECT); the image is contain-fitted and centred
 * inside it, so datasets of any aspect ratio render into the same footprint.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { ConfirmedROI } from '@/features/vizworkbench/composables/useROI'
import {
  COMPARISON_A_ALPHA,
  COMPARISON_B_ALPHA,
  hexToRgb,
  rgbCss,
  type RGB,
} from '@/features/vizworkbench/utils/regionPalette'

export interface ThumbnailRegion {
  value: string
  label: string
  color: RGB
  /** H×W 0/1 raster, row*width+col. */
  mask: Uint8Array
}

const props = defineProps<{
  /** Members of group A / B, each painted in its own identity color. */
  a: ThumbnailRegion[]
  b: ThumbnailRegion[]
  rois: ConfirmedROI[]
  matrix: Float32Array | null
  width: number
  height: number
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

interface LegendEntry {
  label: string
  css: string
}
// One legend entry per group: member labels joined, swatch in the group's
// fixed color (all members carry the same group color).
const legendsA = computed<LegendEntry[]>(() =>
  props.a.length
    ? [{ label: `A · ${props.a.map((r) => r.label).join(' + ')}`, css: rgbCss(props.a[0]!.color) }]
    : [],
)
const legendsB = computed<LegendEntry[]>(() =>
  props.b.length
    ? [{ label: `B · ${props.b.map((r) => r.label).join(' + ')}`, css: rgbCss(props.b[0]!.color) }]
    : [],
)

// ---------- raster building ----------

const BG = { r: 0x0a, g: 0x0a, b: 0x0f } // same backdrop as the main canvas

function buildImageData(): ImageData | null {
  const { width: w, height: h } = props
  if (!w || !h) return null
  const img = new ImageData(w, h)
  const buf = img.data
  const n = w * h

  // Backdrop: dimmed grayscale of the TIC/ion matrix so the regions sit in
  // spatial context without competing with their identity colors.
  const matrix = props.matrix
  let max = 0
  if (matrix) {
    for (let i = 0; i < n; i++) {
      const v = matrix[i] ?? 0
      if (v > max) max = v
    }
  }
  const hasMatrix = !!(matrix && max > 0 && matrix.length >= n)
  for (let i = 0; i < n; i++) {
    const off = i * 4
    if (hasMatrix) {
      const v = (matrix![i] ?? 0) / max
      const gray = Math.round(Math.sqrt(v) * 88) // sqrt boosts dim tissue
      buf[off] = 14 + gray
      buf[off + 1] = 14 + gray
      buf[off + 2] = 20 + gray
    } else {
      buf[off] = BG.r
      buf[off + 1] = BG.g
      buf[off + 2] = BG.b
    }
    buf[off + 3] = 255
  }

  // Confirmed ROIs: same strong fill as the compared regions (KMeans), so all
  // region types share one visual language in the thumbnail. Drawn under the
  // A/B highlight so the compared regions stay on top.
  for (const roi of props.rois) {
    const c = hexToRgb(roi.color)
    if (!c) continue
    paintMask(buf, roi.mask, w, h, c, 0.85, false)
  }

  // Compared groups: strong fill in each group's fixed color. B is painted
  // after A with lower alpha so overlap shows through instead of reading as
  // B-only - same precedence as the ion-image overlay.
  for (const r of props.a) paintMask(buf, r.mask, w, h, r.color, COMPARISON_A_ALPHA, false)
  for (const r of props.b) paintMask(buf, r.mask, w, h, r.color, COMPARISON_B_ALPHA, false)

  return img
}

/**
 * Alpha-blend a region over the backdrop. `mask` may be a flat Uint8Array
 * (kmeans/comparison raster) or a boolean[][] (ROI). With `outline`, mask
 * edge pixels additionally get the full-strength color.
 */
function paintMask(
  buf: Uint8ClampedArray,
  mask: Uint8Array | boolean[][],
  w: number,
  h: number,
  c: RGB,
  alpha: number,
  outline: boolean,
) {
  const at = (r: number, col: number): boolean =>
    Array.isArray(mask) ? !!mask[r]?.[col] : !!mask[r * w + col]

  for (let r = 0; r < h; r++) {
    for (let col = 0; col < w; col++) {
      if (!at(r, col)) continue
      let a = alpha
      if (outline) {
        const edge =
          r === 0 ||
          col === 0 ||
          r === h - 1 ||
          col === w - 1 ||
          !at(r - 1, col) ||
          !at(r + 1, col) ||
          !at(r, col - 1) ||
          !at(r, col + 1)
        if (edge) a = 1
      }
      const off = (r * w + col) * 4
      buf[off] = Math.round(buf[off]! * (1 - a) + c.r * a)
      buf[off + 1] = Math.round(buf[off + 1]! * (1 - a) + c.g * a)
      buf[off + 2] = Math.round(buf[off + 2]! * (1 - a) + c.b * a)
    }
  }
}

// ---------- canvas ----------

// The canvas is a fixed viewport, not a data-shaped element: its height comes
// from the column width via a constant ratio (clamped), never from the
// dataset's aspect. A portrait dataset (e.g. 48x100) would otherwise make the
// canvas twice as tall as the column is wide, and since the left column's
// natural height drives the whole compare section, it stretched the results
// table with it.
const BOX_ASPECT = 0.75 // box height / box width
const BOX_MIN_H = 180
const BOX_MAX_H = 360

function draw() {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return

  const cw = container.clientWidth
  if (!cw) return
  const ch = Math.min(BOX_MAX_H, Math.max(BOX_MIN_H, Math.round(cw * BOX_ASPECT)))

  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(cw * dpr)
  canvas.height = Math.round(ch * dpr)
  canvas.style.height = ch + 'px'

  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // draw in CSS pixels
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = `rgb(${BG.r},${BG.g},${BG.b})`
  ctx.fillRect(0, 0, cw, ch)

  const img = buildImageData()
  if (!img) return

  // 1:1 offscreen → contain-fit blit (pixelated), matching the main renderer:
  // the image is scaled to fit inside the box and centred, so the leftover
  // space stays backdrop-coloured instead of resizing the box.
  const off = document.createElement('canvas')
  off.width = img.width
  off.height = img.height
  off.getContext('2d')!.putImageData(img, 0, 0)

  const scale = Math.min(cw / img.width, ch / img.height)
  const dw = Math.max(1, Math.round(img.width * scale))
  const dh = Math.max(1, Math.round(img.height * scale))
  ctx.drawImage(off, Math.round((cw - dw) / 2), Math.round((ch - dh) / 2), dw, dh)
}

let ro: ResizeObserver | null = null
onMounted(() => {
  if (containerRef.value) {
    ro = new ResizeObserver(() => draw())
    ro.observe(containerRef.value)
  }
  draw()
})
onBeforeUnmount(() => ro?.disconnect())

watch(
  () => [props.a, props.b, props.rois, props.matrix, props.width, props.height],
  () => draw(),
)
</script>

<template>
  <div class="border-0 rounded-none bg-transparent overflow-visible">
    <div class="px-3 pt-2 pb-1.5 flex items-center justify-between">
      <span class="font-semibold text-base-content kawaru-text-87">{{
        $t('vizworkbench.compare.preview')
      }}</span>
    </div>
    <div
      v-if="legendsA.length || legendsB.length"
      class="px-3 pb-2.5 flex flex-wrap gap-x-4 gap-y-1"
    >
      <span
        v-for="legend in [...legendsA, ...legendsB]"
        :key="legend.label"
        class="flex items-center gap-1.5 text-base-content/80"
      >
        <span
          class="w-2.5 h-2.5 rounded-sm border border-base-content/30 shrink-0"
          :style="{ backgroundColor: legend.css }"
        ></span>
        <span class="truncate max-w-[180px]" :title="legend.label">{{ legend.label }}</span>
      </span>
    </div>
    <div ref="containerRef" class="px-3 pb-2">
      <canvas
        ref="canvasRef"
        class="block w-full max-w-full rounded-md border border-base-300"
        style="image-rendering: pixelated"
      />
    </div>
  </div>
</template>
