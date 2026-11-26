<template>
  <div
    ref="surface"
    data-testid="roi-overlay"
    class="absolute inset-0 overflow-hidden"
    :class="editor.drawing ? 'cursor-crosshair touch-none' : 'pointer-events-none'"
    :tabindex="editor.drawing ? 0 : -1"
    :aria-label="$t('vizworkbench.roi.tools')"
    @pointerdown="start"
    @pointermove="move"
    @pointerleave="hover = null"
    @pointerup="finish"
    @pointercancel="cancelPointer"
    @lostpointercapture="cancelPointer"
    @keydown="onKeydown"
  >
    <canvas
      v-if="fill"
      ref="fillCanvas"
      data-testid="roi-shape-fill"
      class="absolute pointer-events-none"
      style="image-rendering: pixelated"
      :style="imageStyle"
      :width="imageWidth"
      :height="imageHeight"
      aria-hidden="true"
    />
    <svg
      v-if="outline || shapeOutline"
      class="absolute pointer-events-none overflow-visible"
      :style="imageStyle"
      :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        v-if="shapeOutline && editor.shapeColor && !dragBox"
        :data-testid="editor.hasPendingShape ? 'roi-pending-outline' : 'roi-shape-outline'"
        :d="shapeOutline"
        :stroke="editor.shapeColor"
        :stroke-width="editor.hasPendingShape ? 2.5 : 5"
        :stroke-dasharray="editor.hasPendingShape ? '4 4' : undefined"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
        fill="none"
      />
      <path
        v-if="outline"
        data-testid="roi-draft-outline"
        :d="outline"
        fill="none"
        stroke="white"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
        class="[filter:drop-shadow(0_0_1px_#000)]"
      />
    </svg>
    <svg class="absolute inset-0 h-full w-full pointer-events-none" aria-hidden="true">
      <polyline
        v-if="line.length"
        :points="line.map((p) => `${screenX(p.x)},${screenY(p.y)}`).join(' ')"
        fill="none"
        :stroke="pathColor"
        stroke-width="2.5"
        stroke-dasharray="4 4"
        data-testid="roi-open-outline"
      />
      <line
        v-if="guide"
        :x1="screenX(guide.from.x)"
        :y1="screenY(guide.from.y)"
        :x2="screenX(guide.to.x)"
        :y2="screenY(guide.to.y)"
        :stroke="pathColor"
        stroke-width="2"
        stroke-dasharray="4 4"
      />
      <circle
        v-if="editor.path[0]"
        :cx="screenX(editor.path[0].x)"
        :cy="screenY(editor.path[0].y)"
        r="4"
        fill="#0f172a"
        :stroke="pathColor"
        stroke-width="2"
      />
      <circle
        v-if="resumePoint"
        :cx="screenX(resumePoint.x)"
        :cy="screenY(resumePoint.y)"
        r="4"
        :fill="pathColor"
        stroke="#0f172a"
        stroke-width="1.5"
      />
      <template v-if="screenBox">
        <ellipse
          v-if="dragBox && editor.tool === 'ellipse'"
          :cx="screenBox.x + screenBox.width / 2"
          :cy="screenBox.y + screenBox.height / 2"
          :rx="screenBox.width / 2"
          :ry="screenBox.height / 2"
          fill="none"
          :stroke="editor.gestureColor ?? editor.nextColor"
          stroke-width="2.5"
          stroke-dasharray="4 4"
        />
        <rect
          v-else-if="dragBox"
          v-bind="screenBox"
          fill="none"
          :stroke="editor.gestureColor ?? editor.nextColor"
          stroke-width="2.5"
          stroke-dasharray="4 4"
        />
        <circle
          v-for="handle in handles"
          :key="handle.kind"
          :cx="handle.x"
          :cy="handle.y"
          r="4"
          class="pointer-events-auto"
          :class="handle.kind === 'center' ? 'cursor-move' : 'cursor-crosshair'"
          fill="#0f172a"
          :stroke="editor.editableColor ?? editor.nextColor"
          stroke-width="2"
          @pointerdown.stop="start($event, handle.kind)"
        />
      </template>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
import type { RoiEditor } from '@/features/vizworkbench/composables/useRoiEditor'
import { hexToRgb } from '@/features/vizworkbench/utils/regionPalette'
import {
  isRoiContour,
  isRoiDrawingTool,
  roiBoxBounds,
  roiMaskOutline,
  type ROIBox,
  type ROIPoint,
} from '@/features/vizworkbench/utils/roiMask'

const props = defineProps<{
  editor: RoiEditor
  imageWidth: number
  imageHeight: number
  imageRect: { x: number; y: number; width: number; height: number }
}>()

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'center'

const surface = ref<HTMLDivElement | null>(null)
const hover = shallowRef<ROIPoint | null>(null)
const stroke = ref<ROIPoint[]>([])
const dragBox = shallowRef<ROIBox | null>(null)

let gesture: {
  id: number
  origin: ROIPoint
  clientX: number
  clientY: number
  dragging: boolean
  handle?: Handle
  initialBox: ROIBox | null
} | null = null

const scaleX = computed(() => props.imageRect.width / props.imageWidth)
const scaleY = computed(() => props.imageRect.height / props.imageHeight)
const screenX = (x: number) => props.imageRect.x + x * scaleX.value
const screenY = (y: number) => props.imageRect.y + y * scaleY.value
const imageStyle = computed(() => ({
  left: `${props.imageRect.x}px`,
  top: `${props.imageRect.y}px`,
  width: `${props.imageRect.width}px`,
  height: `${props.imageRect.height}px`,
}))

const outline = computed(() => {
  const mask = props.editor.previewMask
  return mask ? roiMaskOutline(mask, props.imageWidth, props.imageHeight) : ''
})
const shapeOutline = computed(() => {
  const mask = props.editor.shapeMask
  return mask && !props.editor.shapeFill
    ? roiMaskOutline(mask, props.imageWidth, props.imageHeight)
    : ''
})

const fillCanvas = useTemplateRef<HTMLCanvasElement>('fillCanvas')
// Saved ROIs default to 0.4, which barely shows over viridis or in the darker shape colors.
const FILL_OPACITY = 0.6
/** Collected masks are painted instead of outlined. */
const fill = computed(() => {
  const { shapeFill, shapeMask, shapeColor } = props.editor
  const rgb = shapeFill && shapeColor ? hexToRgb(shapeColor) : null
  return rgb && shapeMask?.length === props.imageWidth * props.imageHeight
    ? { mask: shapeMask, rgb }
    : null
})

watch(
  [fill, fillCanvas],
  ([value, canvas]) => {
    const context = value && canvas?.getContext('2d')
    if (!value || !context) return
    const image = context.createImageData(props.imageWidth, props.imageHeight)
    const alpha = Math.round(FILL_OPACITY * 255)
    const { mask, rgb } = value
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue
      const offset = i * 4
      image.data[offset] = rgb.r
      image.data[offset + 1] = rgb.g
      image.data[offset + 2] = rgb.b
      image.data[offset + 3] = alpha
    }
    context.putImageData(image, 0, 0)
  },
  { flush: 'post' },
)
const pathColor = computed(
  () => props.editor.contourColor ?? props.editor.gestureColor ?? props.editor.nextColor,
)
const line = computed(() => [...props.editor.path, ...stroke.value])
const pathEnd = computed(() => props.editor.path[props.editor.path.length - 1])
const guide = computed(() => {
  const from = pathEnd.value
  return from && hover.value && !props.editor.hasPendingShape && props.editor.tool === 'polygon'
    ? { from, to: hover.value }
    : null
})
const resumePoint = computed(() =>
  props.editor.tool === 'freehand' && !stroke.value.length && props.editor.path.length > 1
    ? pathEnd.value
    : null,
)
const screenBox = computed(() => {
  const box = dragBox.value ?? props.editor.editableBox
  if (!box) return null
  const { left, top, right, bottom } = roiBoxBounds(box)
  const lastCell = props.editor.tool === 'rectangle' ? 1 : 0
  return {
    x: screenX(left),
    y: screenY(top),
    width: (right + lastCell - left) * scaleX.value,
    height: (bottom + lastCell - top) * scaleY.value,
  }
})
const handles = computed(() => {
  const box = screenBox.value
  if (!box || dragBox.value || !props.editor.editableBox) return []
  const { x, y, width, height } = box
  return [
    { kind: 'tl', x, y },
    { kind: 'tr', x: x + width, y },
    { kind: 'bl', x, y: y + height },
    { kind: 'br', x: x + width, y: y + height },
    { kind: 'center', x: x + width / 2, y: y + height / 2 },
  ] satisfies { kind: Handle; x: number; y: number }[]
})

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function point(event: PointerEvent, clip = false): ROIPoint | null {
  const rect = surface.value?.getBoundingClientRect()
  if (!rect || !(scaleX.value > 0 && scaleY.value > 0)) return null
  const x = (event.clientX - rect.left - props.imageRect.x) / scaleX.value
  const y = (event.clientY - rect.top - props.imageRect.y) / scaleY.value
  if (!clip && (x < 0 || y < 0 || x >= props.imageWidth || y >= props.imageHeight)) return null
  return { x: clamp(x, 0, props.imageWidth), y: clamp(y, 0, props.imageHeight) }
}

function start(event: PointerEvent, handle?: Handle) {
  if (
    !props.editor.drawing ||
    event.button !== 0 ||
    gesture ||
    (props.editor.hasPendingShape && !handle)
  )
    return
  const origin = point(event, !!handle)
  if (!origin) return
  event.preventDefault()
  surface.value?.focus({ preventScroll: true })
  surface.value?.setPointerCapture(event.pointerId)
  const color = handle
    ? props.editor.editableColor
    : props.editor.tool === props.editor.openPathType
      ? props.editor.contourColor
      : null
  props.editor.setGestureColor(color ?? props.editor.nextColor)
  gesture = {
    id: event.pointerId,
    origin,
    clientX: event.clientX,
    clientY: event.clientY,
    dragging: false,
    handle,
    initialBox: handle ? props.editor.editableBox : null,
  }
}

function getBox(p: ROIPoint, event: PointerEvent): ROIBox | null {
  if (!gesture) return null
  const { origin, initialBox, handle } = gesture
  const ellipse = props.editor.tool === 'ellipse'
  const maxX = props.imageWidth - (ellipse ? 0 : 1)
  const maxY = props.imageHeight - (ellipse ? 0 : 1)
  if (initialBox && handle) {
    const { left, top, right, bottom } = roiBoxBounds(initialBox)
    const dx = ellipse ? p.x - origin.x : Math.round(p.x - origin.x)
    const dy = ellipse ? p.y - origin.y : Math.round(p.y - origin.y)
    if (handle === 'center') {
      const moveX = clamp(dx, -left, maxX - right)
      const moveY = clamp(dy, -top, maxY - bottom)
      return { x0: left + moveX, y0: top + moveY, x1: right + moveX, y1: bottom + moveY }
    }
    return {
      x0: handle.endsWith('l') ? clamp(left + dx, 0, right) : left,
      x1: handle.endsWith('r') ? clamp(right + dx, left, maxX) : right,
      y0: handle.startsWith('t') ? clamp(top + dy, 0, bottom) : top,
      y1: handle.startsWith('b') ? clamp(bottom + dy, top, maxY) : bottom,
    }
  }
  if (ellipse) {
    if (!event.shiftKey) return { x0: origin.x, y0: origin.y, x1: p.x, y1: p.y }
    const sx = p.x < origin.x ? -1 : 1
    const sy = p.y < origin.y ? -1 : 1
    const size = Math.min(
      Math.max(Math.abs(p.x - origin.x), Math.abs(p.y - origin.y)),
      sx > 0 ? maxX - origin.x : origin.x,
      sy > 0 ? maxY - origin.y : origin.y,
    )
    return { x0: origin.x, y0: origin.y, x1: origin.x + sx * size, y1: origin.y + sy * size }
  }
  return {
    x0: Math.floor(origin.x),
    y0: Math.floor(origin.y),
    x1: Math.min(maxX, Math.floor(p.x)),
    y1: Math.min(maxY, Math.floor(p.y)),
  }
}

function distance(a: ROIPoint, b: ROIPoint) {
  return Math.hypot((a.x - b.x) * scaleX.value, (a.y - b.y) * scaleY.value)
}

function move(event: PointerEvent) {
  if (!gesture) {
    hover.value = point(event)
    return
  }
  if (gesture.id !== event.pointerId) return
  const p = point(event, true)
  if (!p) return
  gesture.dragging ||=
    Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) >= 3
  if (!gesture.dragging) return
  if (props.editor.tool === 'freehand') {
    if (!stroke.value.length) {
      const endpoint = pathEnd.value
      if (endpoint && distance(endpoint, gesture.origin) > 12) return
      stroke.value.push(endpoint ?? gesture.origin)
    }
    const last = stroke.value[stroke.value.length - 1]!
    if (last.x !== p.x || last.y !== p.y) stroke.value.push(p)
  } else if (props.editor.tool !== 'polygon') {
    dragBox.value = getBox(p, event)
  }
}

function finish(event: PointerEvent) {
  if (!gesture || gesture.id !== event.pointerId) return
  move(event)
  const { dragging, origin, handle } = gesture
  const tool = props.editor.tool
  if (isRoiContour(tool)) {
    const first = props.editor.path[0]
    if (!dragging && first && props.editor.canClosePath && distance(first, origin) <= 7) {
      props.editor.closePath()
    } else if (tool === 'polygon' && !dragging) {
      props.editor.addSegment([origin])
    } else if (tool === 'freehand' && stroke.value.length > 1) {
      props.editor.addSegment([...stroke.value])
    }
  } else if (isRoiDrawingTool(tool) && dragBox.value) {
    const shape = { type: tool, rect: dragBox.value, path: [] }
    if (handle) props.editor.replaceBox(shape)
    else props.editor.stageShape(shape)
  }
  stop()
  hover.value = point(event)
}

function stop() {
  const id = gesture?.id
  gesture = null
  stroke.value = []
  dragBox.value = null
  props.editor.setGestureColor(null)
  hover.value = null
  if (id !== undefined && surface.value?.hasPointerCapture(id))
    surface.value.releasePointerCapture(id)
}

function cancelPointer(event: PointerEvent) {
  if (gesture?.id === event.pointerId) stop()
}

watch(() => [props.editor.tool, props.editor.operation, props.imageWidth, props.imageHeight], stop)
onBeforeUnmount(stop)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (gesture) stop()
    else if (props.editor.hasUnconfirmedShape) props.editor.discardShape()
    else props.editor.selectTool(null)
  } else if (gesture) {
    return
  } else if (event.key === 'Enter' && props.editor.canClosePath) {
    props.editor.closePath()
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    if (event.shiftKey) props.editor.redo()
    else props.editor.undo()
  } else {
    return
  }
  event.preventDefault()
}
</script>
