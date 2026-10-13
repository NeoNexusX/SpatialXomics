<template>
  <div class="kawaru-text-68">
    <!-- Mode toggle -->
    <label class="flex items-center justify-between mb-2 cursor-pointer select-none kawaru-text-75">
      <span class="text-base-content">{{ $t('vizworkbench.channels.overlayMode') }}</span>
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="enabled"
        @change="emit('update:enabled', ($event.target as HTMLInputElement).checked)"
      />
    </label>

    <div class="text-base-content/60 mb-2">
      {{ $t('vizworkbench.channels.hint') }}
    </div>

    <!-- Channel list -->
    <div v-if="channels.length" class="space-y-0.5 mb-2">
      <div
        v-for="c in channels"
        :key="c.id"
        class="flex items-center gap-1.5 py-0.5"
        :class="{ 'opacity-50': !enabled }"
      >
        <input
          type="checkbox"
          class="checkbox checkbox-xs checkbox-primary shrink-0"
          :checked="c.visible"
          :disabled="!enabled || !c.matrix"
          :aria-label="$t('vizworkbench.channels.show', { mz: c.mz })"
          @change="emit('toggle-visible', c.id)"
        />
        <input
          type="color"
          class="w-5 h-5 rounded border border-base-content/30 shrink-0 cursor-pointer bg-transparent p-0"
          :value="rgbToHex(c.color)"
          :aria-label="$t('vizworkbench.channels.changeColor', { mz: c.mz })"
          :disabled="!enabled"
          @input="onColorInput(c.id, ($event.target as HTMLInputElement).value)"
        />
        <input
          type="range"
          class="range range-xs range-primary w-16 shrink-0"
          min="0"
          max="1"
          step="0.01"
          :value="c.opacity ?? 1"
          :aria-label="$t('vizworkbench.channels.opacity', { mz: c.mz })"
          :disabled="!enabled"
          @input="emit('update-opacity', c.id, +($event.target as HTMLInputElement).value)"
        />
        <span class="font-mono text-base-content truncate" :title="`m/z ${c.mz.toFixed(6)}`">
          {{ c.mz.toFixed(6) }}
        </span>
        <span v-if="c.loading" class="loading loading-spinner loading-xs text-base-content/50" />
        <button
          v-else-if="c.error"
          class="text-error shrink-0"
          :title="$t('vizworkbench.channels.loadFailed', { error: c.error })"
          @click="emit('retry', c.id)"
        >
          <SvgIcon type="warning" class="w-[1.1em] h-[1.1em]" />
        </button>
        <button
          class="ml-auto text-base-content/50 hover:text-error shrink-0"
          :aria-label="$t('vizworkbench.channels.remove', { mz: c.mz })"
          @click="emit('remove', c.id)"
        >
          <SvgIcon type="trash" class="w-[1em] h-[1em]" />
        </button>
      </div>
    </div>

    <!-- Add current m/z stays on its own row. -->
    <div class="flex items-center gap-1 mb-1">
      <button
        class="btn btn-sm btn-primary w-full kawaru-text-68"
        :disabled="!enabled || !canAdd"
        :title="addTitle"
        @click="emit('add-current')"
      >
        <span v-if="anyLoading" class="loading loading-spinner loading-xs"></span>
        <SvgIcon v-else type="plus" />
        <MzText :text="$t('vizworkbench.channels.add', { mz: currentMz.toFixed(6) })" />
      </button>
    </div>

    <!-- Batch mode listens to user m/z clicks; Clear shares this row. -->
    <div class="flex items-center gap-1">
      <button
        class="btn btn-sm flex-1 kawaru-text-68"
        :class="batchAddMode ? 'btn-secondary' : 'btn-ghost'"
        :disabled="!enabled || !canAdd"
        :title="$t('vizworkbench.channels.batchHint')"
        @click="emit('toggle-batch-add')"
      >
        <SvgIcon type="plus" />
        <MzText :text="$t('vizworkbench.channels.batchAdd')" />
      </button>
      <button
        class="btn btn-ghost btn-sm kawaru-text-68"
        :disabled="!channels.length"
        @click="emit('clear')"
      >
        {{ $t('common.action.clear') }}
      </button>
    </div>

    <div v-if="batchAddMode" class="text-secondary mt-1.5">
      <MzText :text="$t('vizworkbench.channels.batchHint')" />
    </div>

    <div v-if="channels.length >= maxChannels" class="text-base-content/60 mt-1.5">
      {{ $t('vizworkbench.channels.full', { max: maxChannels }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import MzText from '@/shared/components/MzText.vue'
import type { IonChannel } from '@/features/vizworkbench/composables/useIonChannels'
import { t } from '@/i18n'

const props = defineProps<{
  enabled: boolean
  /** Channel metadata (matrices are not needed by this panel). */
  channels: IonChannel[]
  /** Current m/z — what "Add" would add. */
  currentMz: number
  /** False when the mode is off, full, or a load is in flight. */
  canAdd: boolean
  /** A channel is still loading. */
  anyLoading: boolean
  maxChannels: number
  batchAddMode?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:enabled', value: boolean): void
  (e: 'add-current'): void
  (e: 'remove', id: number): void
  (e: 'toggle-visible', id: number): void
  (e: 'update-color', id: number, color: { r: number; g: number; b: number }): void
  (e: 'update-opacity', id: number, opacity: number): void
  (e: 'retry', id: number): void
  (e: 'clear'): void
  (e: 'toggle-batch-add'): void
}>()

const addTitle = computed(() => {
  if (!props.enabled) return t('vizworkbench.channels.enableFirst')
  if (props.channels.length >= props.maxChannels) return t('vizworkbench.channels.colorsInUse')
  return t('vizworkbench.channels.addHint', { mz: props.currentMz.toFixed(6) })
})

function rgbToHex(color: { r: number; g: number; b: number }): string {
  return `#${[color.r, color.g, color.b]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

function onColorInput(id: number, value: string) {
  const hex = value.replace('#', '')
  if (hex.length !== 6) return
  emit('update-color', id, {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  })
}
</script>
