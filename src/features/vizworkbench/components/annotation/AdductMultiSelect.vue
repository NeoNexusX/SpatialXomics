<script setup lang="ts">
/** 可收起的加合物多选列表；条件和结果筛选共用。 */
import { computed, ref, useId } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import { adductDisplay } from '@/features/vizworkbench/utils/annotation/format'
import type { AdductId } from '@/shared/chem/adducts'
import { t } from '@/i18n'

export interface AdductOption {
  id: AdductId
  tone?: 'primary' | 'secondary' | 'muted'
  fit?: number
  title?: string
}

const props = defineProps<{
  modelValue: AdductId[]
  options: AdductOption[]
  label: string
  emptyLabel: string
  clearLabel?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: AdductId[]): void }>()

const open = ref(false)
const listId = useId()
const selected = computed(() => new Set(props.modelValue))
const summary = computed(() =>
  props.modelValue.length
    ? t('vizworkbench.annotation.adductSelected', { count: props.modelValue.length })
    : props.emptyLabel,
)

function toggle(id: AdductId, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  emit(
    'update:modelValue',
    checked ? [...props.modelValue, id] : props.modelValue.filter((value) => value !== id),
  )
}
</script>

<template>
  <div class="min-w-0 rounded-md border border-base-content/20 bg-base-100 kawaru-text-62">
    <div class="flex items-center">
      <button
        type="button"
        class="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-base-200/60 focus-visible:outline-2 focus-visible:outline-primary"
        :aria-label="`${label}: ${summary}`"
        :aria-expanded="open"
        :aria-controls="listId"
        @click="open = !open"
      >
        <span class="min-w-0 truncate">{{ summary }}</span>
        <SvgIcon :type="open ? 'chevron_up' : 'chevron_down'" class="shrink-0" />
      </button>
      <button
        v-if="clearLabel && modelValue.length"
        type="button"
        class="btn btn-ghost btn-sm shrink-0 px-2 kawaru-text-56 text-primary"
        @click="emit('update:modelValue', [])"
      >
        {{ clearLabel }}
      </button>
    </div>
    <fieldset
      v-show="open"
      :id="listId"
      :aria-label="label"
      class="max-h-48 min-w-0 space-y-1 overflow-y-auto overscroll-contain border-t border-base-content/20 p-2 scrollbar-thin"
      @keydown.esc="open = false"
    >
      <label
        v-for="option in options"
        :key="option.id"
        class="flex min-h-10 cursor-pointer items-center gap-2 rounded px-2 py-2 hover:bg-base-200/60"
        :class="{
          'text-primary': option.tone === 'primary',
          'text-secondary': option.tone === 'secondary',
          'text-base-content/50': option.tone === 'muted',
          'bg-primary/5': selected.has(option.id) && option.tone !== 'secondary',
          'bg-secondary/5': selected.has(option.id) && option.tone === 'secondary',
        }"
        :title="option.title"
      >
        <input
          type="checkbox"
          class="checkbox checkbox-xs shrink-0"
          :class="option.tone === 'secondary' ? 'checkbox-secondary' : 'checkbox-primary'"
          :checked="selected.has(option.id)"
          :aria-label="adductDisplay(option.id)"
          @change="toggle(option.id, $event)"
        />
        <span class="min-w-0 flex-1 break-words font-mono">{{ adductDisplay(option.id) }}</span>
        <span v-if="option.fit != null" class="shrink-0 font-mono kawaru-text-56 opacity-70">
          {{ option.fit.toFixed(1) }}
        </span>
      </label>
    </fieldset>
  </div>
</template>
