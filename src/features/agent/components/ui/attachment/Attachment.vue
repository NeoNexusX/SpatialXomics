<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/features/agent/utils/cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="attachment"
    :class="cn('rounded-xl focus-within:ring-1 focus-within:ring-ring/50 relative flex w-24 max-w-full min-w-0 shrink-0 flex-col border transition-colors', props.class)"
  >
    <slot />
  </div>
</template>
