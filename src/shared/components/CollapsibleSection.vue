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
import { ref, useId } from 'vue'
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
const contentId = useId()
</script>

<template>
  <div class="pt-3 border-t border-base-content/40">
    <div class="relative flex items-center gap-1 pr-6">
      <h2 class="min-w-0 kawaru-text-87 font-semibold text-base-content">
        <button
          type="button"
          class="group block py-1 text-left cursor-pointer select-none after:absolute after:inset-0"
          :aria-expanded="open"
          :aria-controls="contentId"
          @click="open = !open"
        >
          {{ title }}
          <SvgIcon
            :type="open ? 'chevron_up' : 'chevron_down'"
            class="absolute right-0 top-1/2 -translate-y-1/2 w-[1.1em] h-[1.1em] text-base-content/60 group-hover:text-base-content"
          />
        </button>
      </h2>
      <span v-if="$slots['title-help']" class="relative z-10 flex shrink-0">
        <slot name="title-help" />
      </span>
    </div>
    <div v-show="open" :id="contentId" class="pb-1">
      <slot />
    </div>
  </div>
</template>
