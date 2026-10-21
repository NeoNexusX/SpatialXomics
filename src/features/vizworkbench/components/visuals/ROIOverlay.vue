<template>
  <div
    ref="containerRef"
    class="absolute inset-0 z-20"
    :class="tool ? 'cursor-crosshair' : 'pointer-events-none'"
    @mousedown.prevent="onDown"
  >
    <canvas ref="canvasRef" class="absolute inset-0 w-full h-full pointer-events-none" />
    <!-- Drag handles for rectangle -->
    <template v-if="tool === 'rectangle' && draftReady">
      <div
        class="absolute w-2.5 h-2.5 bg-white border-2 border-red-500 rounded-full -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize z-30"
        :style="handlePos.tl"
        @mousedown.prevent.stop="startHandleDrag('tl', $event)"
      />
      <div
        class="absolute w-2.5 h-2.5 bg-white border-2 border-red-500 rounded-full -translate-x-1/2 -translate-y-1/2 cursor-nesw-resize z-30"
        :style="handlePos.tr"
        @mousedown.prevent.stop="startHandleDrag('tr', $event)"
      />
      <div
        class="absolute w-2.5 h-2.5 bg-white border-2 border-red-500 rounded-full -translate-x-1/2 -translate-y-1/2 cursor-nesw-resize z-30"
        :style="handlePos.bl"
        @mousedown.prevent.stop="startHandleDrag('bl', $event)"
      />
      <div
        class="absolute w-2.5 h-2.5 bg-white border-2 border-red-500 rounded-full -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize z-30"
        :style="handlePos.br"
        @mousedown.prevent.stop="startHandleDrag('br', $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { ROIType, DraftROI, ROIPoint } from '@/features/vizworkbench/composables/useROI'
import { computeFitTransform } from '@/features/vizworkbench/utils/fitTransform'

const props = defineProps<{
  tool: ROIType | null
  imageWidth: number
  imageHeight: number
  /** Element whose bounding rect represents the image draw area (must match canvas renderer's container) */
  targetEl?: HTMLElement | null
}>()

const emit = defineEmits<{
  (e: 'draft-updated', draft: DraftROI): void
  (e: 'draft-cleared'): void
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

// ─── Rectangle state (reactive for handle tracking) ───
const rect = reactive({ x0: 0, y0: 0, x1: 0, y1: 0 })
const draftReady = ref(false)

// ─── Freehand state ───
const freePath = ref<ROIPoint[]>([])

let drawing = false
let isMoving = false
let dragCorner: 'tl' | 'tr' | 'bl' | 'br' | null = null

// ─── Computed handle positions (reactive via rect object) ───
const handlePos = computed(() => {
  const t = getScale()
  const xmin = Math.min(rect.x0, rect.x1),
    xmax = Math.max(rect.x0, rect.x1)
  const ymin = Math.min(rect.y0, rect.y1),
    ymax = Math.max(rect.y0, rect.y1)
  return {
    tl: {
      left: ((t.ox + xmin * t.scale) / t.W) * 100 + '%',
      top: ((t.oy + ymin * t.scale) / t.H) * 100 + '%',
    },
    tr: {
      left: ((t.ox + xmax * t.scale) / t.W) * 100 + '%',
      top: ((t.oy + ymin * t.scale) / t.H) * 100 + '%',
    },
    bl: {
      left: ((t.ox + xmin * t.scale) / t.W) * 100 + '%',
      top: ((t.oy + ymax * t.scale) / t.H) * 100 + '%',
    },
    br: {
      left: ((t.ox + xmax * t.scale) / t.W) * 100 + '%',
      top: ((t.oy + ymax * t.scale) / t.H) * 100 + '%',
    },
  }
})

// ─── Coordinate helpers ───
// Shared fit geometry lives in utils/fitTransform.ts (single source of truth
// for the canvas renderer, ion-image viewer, and this overlay).

/** Get the element used for coordinate calculation — use targetEl if provided, else parentElement */
function getCoordEl(): HTMLElement | null {
  return props.targetEl || containerRef.value?.parentElement || null
}

/** The overlay's own container (covers the full IonImageSection parent area) */
function getOverlayEl(): HTMLElement | null {
  return containerRef.value?.parentElement || null
}

function getScale() {
  const canvasEl = getCoordEl() // canvas container (actual image draw area)
  const overlayEl = getOverlayEl() // outer div (ROIOverlay covers this)
  if (!canvasEl || !overlayEl || !props.imageWidth || !props.imageHeight)
    return { ox: 0, oy: 0, scale: 1, W: 0, H: 0 }

  const cr = canvasEl.getBoundingClientRect()
  const fit = computeFitTransform(cr.width, cr.height, props.imageWidth, props.imageHeight)

  // Translate to overlay container's coordinate space
  const or = overlayEl.getBoundingClientRect()
  return {
    ox: cr.left - or.left + fit.ox,
    oy: cr.top - or.top + fit.oy,
    scale: fit.scaleVal,
    W: or.width,
    H: or.height,
  }
}

function toMatrix(ex: number, ey: number): ROIPoint {
  const overlayEl = getOverlayEl()
  if (!overlayEl) return { x: 0, y: 0 }
  const r = overlayEl.getBoundingClientRect()
  const t = getScale()
  return {
    x: clamp(Math.round((ex - r.left - t.ox) / t.scale), 0, props.imageWidth - 1),
    y: clamp(Math.round((ey - r.top - t.oy) / t.scale), 0, props.imageHeight - 1),
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/** Ray-casting point-in-polygon test (matrix coordinates) */
function pointInPolygon(p: ROIPoint, path: ROIPoint[]): boolean {
  let inside = false
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i]!,
      b = path[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

// ─── Canvas drawing ───
function redraw() {
  const c = canvasRef.value
  if (!c) return
  const t = getScale()
  const dpr = window.devicePixelRatio || 1
  c.width = t.W * dpr
  c.height = t.H * dpr
  c.style.width = t.W + 'px'
  c.style.height = t.H + 'px'
  const ctx = c.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, t.W, t.H)

  if (props.tool === 'rectangle') {
    const xmin = Math.min(rect.x0, rect.x1)
    const ymin = Math.min(rect.y0, rect.y1)
    const xmax = Math.max(rect.x0, rect.x1)
    const ymax = Math.max(rect.y0, rect.y1)
    if (xmax === xmin && ymax === ymin) return
    const sx = t.ox + xmin * t.scale
    const sy = t.oy + ymin * t.scale
    const sw = (xmax - xmin) * t.scale
    const sh = (ymax - ymin) * t.scale
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)'
    ctx.fillRect(sx, sy, sw, sh)
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2.5
    ctx.strokeRect(sx, sy, sw, sh)
  } else if (props.tool === 'freehand' && freePath.value.length > 1) {
    ctx.beginPath()
    const p0 = freePath.value[0]!
    ctx.moveTo(t.ox + p0.x * t.scale, t.oy + p0.y * t.scale)
    for (let i = 1; i < freePath.value.length; i++) {
      const p = freePath.value[i]!
      ctx.lineTo(t.ox + p.x * t.scale, t.oy + p.y * t.scale)
    }
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2.5
    ctx.stroke()
  }
}

function initCanvas() {
  const c = canvasRef.value
  if (!c) return
  const t = getScale()
  const dpr = window.devicePixelRatio || 1
  c.width = t.W * dpr
  c.height = t.H * dpr
  c.style.width = t.W + 'px'
  c.style.height = t.H + 'px'
}

// ─── Emit helpers ───
function emitRect() {
  emit('draft-updated', {
    type: 'rectangle',
    rect: {
      x0: Math.min(rect.x0, rect.x1),
      y0: Math.min(rect.y0, rect.y1),
      x1: Math.max(rect.x0, rect.x1),
      y1: Math.max(rect.y0, rect.y1),
    },
    path: [],
  })
}

function emitFreehand() {
  emit('draft-updated', { type: 'freehand', rect: null, path: [...freePath.value] })
}

// ─── Document-level drawing handlers ───
function onDrawMove(e: MouseEvent) {
  if (!drawing || !props.tool) return
  const p = toMatrix(e.clientX, e.clientY)
  if (props.tool === 'rectangle') {
    rect.x1 = p.x
    rect.y1 = p.y
  } else if (props.tool === 'freehand') {
    freePath.value.push(p)
  }
  redraw()
}

function onDrawUp() {
  if (!drawing) return
  drawing = false
  document.removeEventListener('mousemove', onDrawMove)
  document.removeEventListener('mouseup', onDrawUp)
  if (isMoving) {
    isMoving = false
    return
  }
  if (props.tool === 'rectangle') {
    if (Math.abs(rect.x1 - rect.x0) > 2 || Math.abs(rect.y1 - rect.y0) > 2) {
      draftReady.value = true
      redraw()
      emitRect()
    } else {
      clearAll()
    }
  } else if (props.tool === 'freehand') {
    if (freePath.value.length > 5) {
      freePath.value.push(freePath.value[0]!)
      draftReady.value = true
      redraw()
      emitFreehand()
    } else {
      clearAll()
    }
  }
}

// ─── Mouse down (start draw or move) ───
function onDown(e: MouseEvent) {
  if (!props.tool) return
  const p = toMatrix(e.clientX, e.clientY)

  // Click inside existing rectangle → move
  if (props.tool === 'rectangle' && draftReady.value) {
    const xmin = Math.min(rect.x0, rect.x1),
      xmax = Math.max(rect.x0, rect.x1)
    const ymin = Math.min(rect.y0, rect.y1),
      ymax = Math.max(rect.y0, rect.y1)
    if (p.x >= xmin && p.x <= xmax && p.y >= ymin && p.y <= ymax) {
      isMoving = true
      drawing = true
      const dx0 = p.x - rect.x0,
        dy0 = p.y - rect.y0
      const dx1 = p.x - rect.x1,
        dy1 = p.y - rect.y1
      const onMove = (ev: MouseEvent) => {
        const np = toMatrix(ev.clientX, ev.clientY)
        rect.x0 = clamp(np.x - dx0, 0, props.imageWidth - 1)
        rect.y0 = clamp(np.y - dy0, 0, props.imageHeight - 1)
        rect.x1 = clamp(np.x - dx1, 0, props.imageWidth - 1)
        rect.y1 = clamp(np.y - dy1, 0, props.imageHeight - 1)
        redraw()
        emitRect()
      }
      const onUp = () => {
        drawing = false
        isMoving = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      return
    }
  }

  // Click inside existing freehand polygon → move
  if (props.tool === 'freehand' && draftReady.value && pointInPolygon(p, freePath.value)) {
    const startP = p
    const startPath = freePath.value.map((pt) => ({ ...pt }))
    // Keep the whole bounding box inside the image while translating
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const pt of startPath) {
      if (pt.x < minX) minX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.x > maxX) maxX = pt.x
      if (pt.y > maxY) maxY = pt.y
    }
    const onMove = (ev: MouseEvent) => {
      const np = toMatrix(ev.clientX, ev.clientY)
      const dx = clamp(np.x - startP.x, -minX, props.imageWidth - 1 - maxX)
      const dy = clamp(np.y - startP.y, -minY, props.imageHeight - 1 - maxY)
      freePath.value = startPath.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }))
      redraw()
      emitFreehand()
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return
  }

  // Start new shape
  drawing = true
  if (props.tool === 'rectangle') {
    rect.x0 = p.x
    rect.y0 = p.y
    rect.x1 = p.x
    rect.y1 = p.y
    draftReady.value = false
  } else if (props.tool === 'freehand') {
    freePath.value = [p]
    draftReady.value = false
  }
  initCanvas()
  document.addEventListener('mousemove', onDrawMove)
  document.addEventListener('mouseup', onDrawUp)
}

// ─── Handle drag (resize corners) ───
function startHandleDrag(corner: 'tl' | 'tr' | 'bl' | 'br', e: MouseEvent) {
  dragCorner = corner
  const onMove = (ev: MouseEvent) => {
    if (!dragCorner) return
    const p = toMatrix(ev.clientX, ev.clientY)
    const xmin = Math.min(rect.x0, rect.x1),
      xmax = Math.max(rect.x0, rect.x1)
    const ymin = Math.min(rect.y0, rect.y1),
      ymax = Math.max(rect.y0, rect.y1)
    const isLeft = corner === 'tl' || corner === 'bl'
    const isTop = corner === 'tl' || corner === 'tr'
    if (isLeft) {
      if (rect.x0 <= rect.x1) rect.x0 = clamp(p.x, 0, xmax - 2)
      else rect.x1 = clamp(p.x, 0, xmax - 2)
    } else {
      if (rect.x0 >= rect.x1) rect.x0 = clamp(p.x, xmin + 2, props.imageWidth - 1)
      else rect.x1 = clamp(p.x, xmin + 2, props.imageWidth - 1)
    }
    if (isTop) {
      if (rect.y0 <= rect.y1) rect.y0 = clamp(p.y, 0, ymax - 2)
      else rect.y1 = clamp(p.y, 0, ymax - 2)
    } else {
      if (rect.y0 >= rect.y1) rect.y0 = clamp(p.y, ymin + 2, props.imageHeight - 1)
      else rect.y1 = clamp(p.y, ymin + 2, props.imageHeight - 1)
    }
    redraw()
    emitRect()
  }
  const onUp = () => {
    dragCorner = null
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

function clearAll() {
  draftReady.value = false
  drawing = false
  isMoving = false
  rect.x0 = 0
  rect.y0 = 0
  rect.x1 = 0
  rect.y1 = 0
  freePath.value = []
  document.removeEventListener('mousemove', onDrawMove)
  document.removeEventListener('mouseup', onDrawUp)
  initCanvas()
  const c = canvasRef.value
  if (c) {
    const ctx = c.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, c.width, c.height)
  }
  emit('draft-cleared')
}

// ─── Lifecycle ───
let ro: ResizeObserver | null = null
onMounted(() => {
  const el = getOverlayEl()
  if (el) {
    initCanvas()
    ro = new ResizeObserver(() => {
      initCanvas()
      redraw()
    })
    ro.observe(el)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  document.removeEventListener('mousemove', onDrawMove)
  document.removeEventListener('mouseup', onDrawUp)
})

watch(
  () => props.tool,
  () => {
    clearAll()
  },
)

defineExpose({ clearAll })
</script>
