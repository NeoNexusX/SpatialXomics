<template>
  <div
    class="shrink-0 flex flex-col items-center gap-2 w-[3em] kawaru-text-87"
    :class="{ 'opacity-40 pointer-events-none': disabled }"
    :title="disabled ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
  >
    <!-- 强度条：多离子叠加模式下每通道各自归一化，此条不适用 → 置灰但保留 DOM -->
    <button
      class="text-base-content/40 hover:text-base-content w-[3em]"
      :title="$t('vizworkbench.ionImage.resetRange')"
      :disabled="disabled"
      @click="display.resetRange()"
    >
      <SvgIcon type="refresh" />
    </button>
    <span class="range-label">{{ formatIonValue(display.displayMax) }}</span>
    <div
      ref="strip"
      data-testid="display-range-strip"
      class="flex-1 w-[1.5em] rounded-sm border border-base-300 relative cursor-pointer bg-base-200"
      @mousedown.prevent="onStripMouseDown"
    >
      <div class="absolute inset-0 rounded-sm" :style="{ background: display.gradientCss }"></div>
      <!-- 上下两个拖拽手柄结构一致，只是绑定的端点不同 -->
      <div
        v-for="handle in ['max', 'min'] as const"
        :key="handle"
        :data-testid="`display-range-${handle}`"
        class="absolute left-0 right-0 h-3 cursor-ns-resize z-10 flex items-center justify-center"
        :style="{ top: handleTop(handle) + '%', transform: 'translateY(-50%)' }"
        @mousedown.prevent.stop="startDrag(handle)"
      >
        <div class="w-full h-[3px] bg-base-100 rounded shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"></div>
      </div>
    </div>
    <span class="range-label">{{ formatIonValue(display.displayMin) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import {
  formatIonValue,
  type IonImageDisplay,
} from '@/features/vizworkbench/composables/useIonImageDisplay'

const props = defineProps<{
  display: IonImageDisplay
  /** The multi-ion overlay normalizes each channel on its own, so the range does not apply. */
  disabled?: boolean
}>()

const strip = useTemplateRef<HTMLElement>('strip')
const span = computed(() => props.display.globalMax - props.display.globalMin || 1)

function clampPct(value: number) {
  return Math.max(0, Math.min(100, value))
}

function handleTop(handle: 'min' | 'max') {
  const { displayMin, displayMax, globalMax } = props.display
  const value = handle === 'max' ? displayMax : displayMin
  return clampPct(((globalMax - value) / span.value) * 100)
}

/** The range value at a pointer height; the strip runs from globalMax at the top to globalMin. */
function valueAt(clientY: number, rect: DOMRect) {
  const topPct = clampPct(((clientY - rect.top) / rect.height) * 100)
  return props.display.globalMax - (topPct / 100) * span.value
}

/** A click on the strip moves the nearer end of the range there. */
function onStripMouseDown(event: MouseEvent) {
  const element = strip.value
  if (!element) return
  const value = valueAt(event.clientY, element.getBoundingClientRect())
  const { displayMin, displayMax } = props.display
  if (Math.abs(displayMin - value) <= Math.abs(displayMax - value))
    props.display.setDisplayMin(value)
  else props.display.setDisplayMax(value)
}

let stopDrag: (() => void) | null = null

/** Drag one handle; it stays inside the data range and on its own side of the other handle. */
function startDrag(handle: 'min' | 'max') {
  const element = strip.value
  if (!element) return
  stopDrag?.()
  const rect = element.getBoundingClientRect()
  const onMove = (event: MouseEvent) => {
    const value = valueAt(event.clientY, rect)
    const { displayMin, displayMax, globalMin, globalMax } = props.display
    if (handle === 'min')
      props.display.setDisplayMin(Math.max(globalMin, Math.min(value, displayMax)))
    else props.display.setDisplayMax(Math.min(globalMax, Math.max(value, displayMin)))
  }
  const listeners = [
    useEventListener(document, 'mousemove', onMove),
    useEventListener(document, 'mouseup', () => stopDrag?.()),
  ]
  stopDrag = () => {
    for (const stop of listeners) stop()
    stopDrag = null
  }
}

// Remove the drag listeners if the strip unmounts mid-drag.
onBeforeUnmount(() => stopDrag?.())
</script>

<style scoped>
/* 强度条两端的数值标签：等宽字体让拖动手柄时数字不左右抖动，
   nowrap 避免科学计数法（如 1.2e+05）时被 3em 宽的列折行。 */
.range-label {
  font-family: var(--font-mono, ui-monospace, monospace);
  color: color-mix(in oklch, var(--color-base-content) 60%, transparent);
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}
</style>
