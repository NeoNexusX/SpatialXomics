<template>
  <div class="kawaru-text-68">
    <!-- Mode toggle -->
    <label class="flex items-center justify-between mb-2 cursor-pointer select-none kawaru-text-75">
      <span class="text-base-content">{{ $t('vizworkbench.channels.overlayMode') }}</span>
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        :checked="state.enabled"
        @change="state.setEnabled(($event.target as HTMLInputElement).checked)"
      />
    </label>

    <!-- Channel list -->
    <div v-if="state.channels.length" class="space-y-0.5 mb-2">
      <div
        v-for="c in state.channels"
        :key="c.id"
        class="flex items-center gap-1.5 py-0.5"
        :class="{ 'opacity-50': !state.enabled }"
      >
        <input
          type="checkbox"
          class="checkbox checkbox-xs checkbox-primary shrink-0"
          :checked="c.visible"
          :disabled="!state.enabled || !c.matrix"
          :aria-label="$t('vizworkbench.channels.show', { mz: c.mz })"
          @change="state.toggleChannelVisible(c.id)"
        />
        <input
          type="color"
          class="w-5 h-5 rounded border border-base-content/30 shrink-0 cursor-pointer bg-transparent p-0"
          :value="rgbToHex(c.color)"
          :aria-label="$t('vizworkbench.channels.changeColor', { mz: c.mz })"
          :disabled="!state.enabled"
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
          :disabled="!state.enabled"
          @input="state.updateChannelOpacity(c.id, +($event.target as HTMLInputElement).value)"
        />
        <span class="font-mono text-base-content truncate" :title="`m/z ${c.mz.toFixed(6)}`">
          {{ c.mz.toFixed(6) }}
        </span>
        <span v-if="c.loading" class="loading loading-spinner loading-xs text-base-content/50" />
        <button
          v-else-if="c.error"
          class="text-error shrink-0"
          :title="$t('vizworkbench.channels.loadFailed')"
          @click="state.retryChannel(c.id)"
        >
          <SvgIcon type="warning" class="w-[1.1em] h-[1.1em]" />
        </button>
        <button
          class="ml-auto text-base-content/50 hover:text-error shrink-0"
          :aria-label="$t('vizworkbench.channels.remove', { mz: c.mz })"
          @click="state.removeChannel(c.id)"
        >
          <SvgIcon type="trash" class="w-[1em] h-[1em]" />
        </button>
      </div>
    </div>

    <!-- Add current m/z stays on its own row. -->
    <div class="flex items-center gap-1 mb-1">
      <button
        class="btn btn-sm btn-primary w-full kawaru-text-68"
        :disabled="!state.enabled || !state.canAdd"
        :title="addTitle"
        @click="state.addCurrentChannel()"
      >
        <span v-if="state.channelsLoading" class="loading loading-spinner loading-xs"></span>
        <SvgIcon v-else type="plus" />
        <MzText :text="$t('vizworkbench.channels.add', { mz: state.currentMz.toFixed(6) })" />
      </button>
    </div>

    <!-- Batch mode listens to user m/z clicks; Clear shares this row. -->
    <div class="flex items-center gap-1">
      <button
        class="btn btn-sm flex-1 kawaru-text-68"
        :class="state.batchAddMode ? 'btn-secondary' : 'btn-ghost'"
        :disabled="!state.enabled || !state.canAdd"
        :title="$t('vizworkbench.channels.batchHint')"
        @click="state.toggleBatchAdd()"
      >
        <SvgIcon type="plus" />
        <MzText :text="$t('vizworkbench.channels.batchAdd')" />
      </button>
      <button
        class="btn btn-ghost btn-sm kawaru-text-68"
        :disabled="!state.channels.length"
        @click="state.clearChannels()"
      >
        {{ $t('common.action.clear') }}
      </button>
    </div>

    <div v-if="state.batchAddMode" class="text-secondary mt-1.5">
      <MzText :text="$t('vizworkbench.channels.batchHint')" />
    </div>

    <div v-if="state.channels.length >= MAX_ION_CHANNELS" class="text-base-content/60 mt-1.5">
      {{ $t('vizworkbench.channels.full', { max: MAX_ION_CHANNELS }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import MzText from '@/shared/components/MzText.vue'
import type { IonChannelState } from '@/features/vizworkbench/composables/useIonChannels'
import { MAX_ION_CHANNELS } from '@/features/vizworkbench/utils/ionChannelBlend'
import { t } from '@/i18n'

const props = defineProps<{
  /** Multi-ion overlay state: the channel list, the mode and batch add. */
  state: IonChannelState
}>()

const addTitle = computed(() => {
  const { enabled, channels, currentMz } = props.state
  if (!enabled) return t('vizworkbench.channels.enableFirst')
  if (channels.length >= MAX_ION_CHANNELS) return t('vizworkbench.channels.colorsInUse')
  return t('vizworkbench.channels.addHint', { mz: currentMz.toFixed(6) })
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
  props.state.updateChannelColor(id, {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  })
}
</script>
