<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/features/agent/utils/cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="attachment-actions"
    :class="cn('absolute top-3 right-3 z-20 flex shrink-0 items-center gap-1', props.class)"
  >
    <slot />
  </div>
</template>
