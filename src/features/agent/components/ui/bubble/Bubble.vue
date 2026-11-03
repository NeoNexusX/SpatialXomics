<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/features/agent/utils/cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="bubble"
    :class="cn(
      'gap-1 max-w-[80%] relative flex w-fit min-w-0 flex-col *:data-[slot=bubble-content]:bg-[oklch(from_var(--primary)_0.93_calc(c*0.4)_h)] dark:*:data-[slot=bubble-content]:bg-[oklch(from_var(--primary)_0.3_calc(c*0.4)_h)] *:data-[slot=bubble-content]:text-foreground',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
