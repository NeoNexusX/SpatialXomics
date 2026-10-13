<template>
  <!-- 全站统一的搜索输入框：左侧放大镜图标，右侧清除按钮（有内容时出现）。
       z-10 必须保留：daisyUI 的 .input 是 position:relative + 不透明背景，且
       在 DOM 中排在图标之后；不给图标一个正 z-index，输入框背景会盖住图标。 -->
  <!-- 外层也挂档位：左侧放大镜是 SvgIcon 默认的 1.125em，读本层字号。
       输入文字用 95 档，比 IconInput 的 87 档大一号——沿用既有差异。 -->
  <div class="relative w-full" :class="{ 'kawaru-text-95': fluid }">
    <SvgIcon
      type="search"
      class="absolute z-10 left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-base-content/40"
      aria-hidden="true"
    />
    <input
      :value="modelValue"
      type="text"
      :placeholder="placeholder ?? $t('common.action.search')"
      :autocomplete="autocomplete"
      :disabled="disabled"
      class="input input-bordered w-full pl-8"
      :class="[sizeClass, fluid && 'kawaru-text-100', clearable && modelValue ? 'pr-8' : 'pr-3']"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter.prevent="emit('search', ($event.target as HTMLInputElement).value)"
    />
    <button
      v-if="clearable && modelValue"
      type="button"
      class="absolute z-10 right-1.5 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle text-base-content/40 hover:text-base-content kawaru-text-68"
:title="$t('common.action.clear')"
      :aria-label="$t('common.action.clear')"
      @click="emit('update:modelValue', '')"
    >
      <SvgIcon type="close" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Shared search box used across list/filter toolbars.
 *
 * Emits `update:modelValue` on every keystroke (so callers can filter live)
 * and `search` when Enter is pressed (for callers that search on submit).
 * Clear button is opt-out via :clearable="false".
 *
 * `fluid` (default on) applies the global type tier `kawaru-text-95` so the field
 * scales with the viewport like the other fluid controls; pass :fluid="false" to
 * fall back to daisyUI's own `input-{size}` sizing inside a compact panel.
 */
import { computed } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'

type SearchSize = 'sm' | 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    size?: SearchSize
    /** Show the ✕ button while the field has text (default on). */
    clearable?: boolean
    /** Use the site-wide fluid font-size (default on). */
    fluid?: boolean
    disabled?: boolean
    autocomplete?: string
  }>(),
  {
    placeholder: undefined,
    size: 'md',
    clearable: true,
    fluid: true,
    disabled: false,
    autocomplete: 'off',
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'search', value: string): void
}>()

const sizeClass = computed(() => `input-${props.size}`)
</script>
