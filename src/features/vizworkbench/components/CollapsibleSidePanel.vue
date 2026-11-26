<script setup lang="ts">
import { computed, useId } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'

const props = defineProps<{
  side: 'left' | 'right'
  title: string
  expandLabel: string
  collapseLabel: string
  contentClass?: string
}>()

defineSlots<{
  default(): unknown
  'header-actions'?(): unknown
}>()

const expanded = defineModel<boolean>('expanded', { required: true })
const contentId = useId()
const desktopChevron = computed(() => {
  const pointsLeft = expanded.value ? props.side === 'left' : props.side === 'right'
  return pointsLeft ? 'chevron_left' : 'chevron_right'
})
</script>

<template>
  <aside
    :aria-label="title"
    class="relative flex w-full flex-col overflow-hidden rounded-xl border-2 border-base-content/30 bg-base-100 shadow-sm lg:min-h-0 lg:min-w-0"
    :class="{ 'lg:w-11 lg:flex-none': !expanded }"
  >
    <div class="flex shrink-0 items-center" :class="{ 'lg:flex-1': !expanded }">
      <h2 class="flex min-w-0 flex-1 self-stretch kawaru-text-87 font-semibold">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left hover:bg-base-200/60 focus-visible:outline-2 focus-visible:-outline-offset-2"
          :class="{ 'lg:flex-col lg:justify-center lg:px-0': !expanded }"
          :aria-expanded="expanded"
          :aria-controls="contentId"
          :title="expanded ? collapseLabel : expandLabel"
          @click="expanded = !expanded"
        >
          <span :class="{ 'lg:[writing-mode:vertical-rl]': !expanded }">{{ title }}</span>
          <span class="shrink-0 lg:hidden">
            <SvgIcon :type="expanded ? 'chevron_up' : 'chevron_down'" />
          </span>
          <span class="hidden shrink-0 lg:block" :class="{ 'lg:order-first': !expanded }">
            <SvgIcon :type="desktopChevron" />
          </span>
        </button>
      </h2>
      <slot v-if="expanded" name="header-actions" />
    </div>

    <div
      v-show="expanded"
      :id="contentId"
      class="flex min-h-0 flex-1 flex-col"
      :class="contentClass"
    >
      <slot />
    </div>
  </aside>
</template>
