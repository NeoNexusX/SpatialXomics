<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/features/assistant/utils/cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="bubble-content"
    :class="cn('rounded-xl border border-transparent px-3 py-2 text-sm leading-relaxed w-fit max-w-full min-w-0 overflow-hidden wrap-break-word', props.class)"
  >
    <slot />
  </div>
</template>
