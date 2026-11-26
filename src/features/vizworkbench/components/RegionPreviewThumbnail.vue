<script setup lang="ts">
/**
 * Region preview thumbnail.
 *
 * Sits under the Compare Regions panel and shows the compared groups (A/B) on
 * a dimmed TIC backdrop. Each group is drawn as the union of its members in
 * the group's fixed color, i.e. exactly the pixels the comparison uses.
 *
 * Rendering: masks are H×W grids (row*width+col), drawn into a 1:1 ImageData
 * and upscaled with drawImage - same pattern as the main canvas renderer, so
 * colors and geometry match the ion image exactly. The canvas itself is a
 * fixed-size box (see BOX_ASPECT); the image is contain-fitted and centred
 * inside it, so datasets of any aspect ratio render into the same footprint.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { buildRegionMask, type Region, type RegionGrid } from '@/features/vizworkbench/utils/region'
import {
  COMPARISON_A_ALPHA,
  COMPARISON_A_RGB,
  COMPARISON_B_ALPHA,
  COMPARISON_B_RGB,
  rgbCss,
} from '@/features/vizworkbench/utils/regionPalette'
import { compositeMask } from '@/features/vizworkbench/utils/roiMask'

const props = defineProps<{
  /** Members of group A / B. */
  a: Region[]
  b: Region[]
  grid: RegionGrid
  /** Backdrop image, drawn dimmed. */
  matrix: Float32Array | null
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// B is painted after A with lower alpha so overlap shows through instead of
// reading as B-only - same precedence as the ion-image overlay.
const groups = computed(() => [
  { name: 'A', regions: props.a, color: COMPARISON_A_RGB, opacity: COMPARISON_A_ALPHA },
  { name: 'B', regions: props.b, color: COMPARISON_B_RGB, opacity: COMPARISON_B_ALPHA },
])

// One legend entry per group: member labels joined, swatch in the group's color.
const legends = computed(() =>
  groups.value
    .filter((group) => group.regions.length)
    .map((group) => ({
      label: `${group.name} · ${group.regions.map((region) => region.label).join(' + ')}`,
      css: rgbCss(group.color),
    })),
)

// ---------- raster building ----------

const BG = { r: 0x0a, g: 0x0a, b: 0x0f } // same backdrop as the main canvas

function buildImageData(): ImageData | null {
  const [h, w] = props.grid.shape
  if (!w || !h) return null
  const img = new ImageData(w, h)
  const buf = img.data
  const n = w * h

  // Backdrop: dimmed grayscale of the TIC/ion matrix so the regions sit in
  // spatial context without competing with the group colors.
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

  for (const { regions, color, opacity } of groups.value) {
    const mask = buildRegionMask(regions, props.grid)
    if (mask) compositeMask(buf, mask, color, Math.round(opacity * 255))
  }

  return img
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
  () => [props.a, props.b, props.grid, props.matrix],
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
    <div v-if="legends.length" class="px-3 pb-2.5 flex flex-wrap gap-x-4 gap-y-1">
      <span
        v-for="legend in legends"
        :key="legend.label"
        class="flex items-center gap-1.5 text-base-content/80"
      >
        <span
          class="w-2.5 h-2.5 rounded-sm border border-base-content/30 shrink-0"
          :style="{ backgroundColor: legend.css }"
        ></span>
        <span class="truncate" :title="legend.label">{{ legend.label }}</span>
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
