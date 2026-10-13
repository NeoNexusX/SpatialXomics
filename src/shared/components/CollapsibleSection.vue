<script setup lang="ts">
/**
 * Collapsible titled section for the right-hand side panel.
 *
 * Collapsed, only the header row (chevron + title) remains. Open state is
 * uncontrolled: it starts at `defaultOpen` and is owned by this component, so
 * callers don't need to thread v-model through every section.
 *
 * Content uses v-show rather than v-if: a section may hold canvases with
 * ResizeObservers (e.g. the Statistic histogram), and unmounting those on
 * collapse would drop the observer/render state on reopen.
 */
import { ref } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'

const props = withDefaults(
  defineProps<{
    title: string
    /** Initial open state; ignored after mount. */
    defaultOpen?: boolean
  }>(),
  { defaultOpen: true },
)

const open = ref(props.defaultOpen)
</script>

<template>
  <div class="pt-3 border-t border-base-content/40">
    <button
      type="button"
      class="group flex w-full items-center justify-between gap-2 py-1 text-left cursor-pointer select-none kawaru-text-75"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="kawaru-text-75 font-semibold text-base-content">{{ title }}</span>
      <SvgIcon
        :type="open ? 'chevron_up' : 'chevron_down'"
        class="w-[1.1em] h-[1.1em] shrink-0 text-base-content/60 group-hover:text-base-content"
      />
    </button>
    <div v-show="open" class="pb-1">
      <slot />
    </div>
  </div>
</template>
