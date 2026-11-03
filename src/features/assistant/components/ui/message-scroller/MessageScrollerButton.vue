<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/features/assistant/utils/cn"
import { Button } from "@/features/assistant/components/ui/button"
import { useMessageScrollerContext } from "./useMessageScroller"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()

const { canScrollToEnd, scrollToEnd } = useMessageScrollerContext()

function onClick(event: MouseEvent) {
  if (!canScrollToEnd.value)
    return
  const target = event.currentTarget as HTMLElement | null
  target?.blur()
  scrollToEnd({ behavior: "smooth" })
}
</script>

<template>
  <Button
    data-slot="message-scroller-button"
    :data-active="canScrollToEnd ? 'true' : 'false'"
    variant="secondary"
    size="icon-sm"
    :inert="!canScrollToEnd"
    :tabindex="canScrollToEnd ? undefined : -1"
    :class="cn(
      'absolute start-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)]',
      props.class,
    )"
    @click="onClick"
  >
    <slot />
  </Button>
</template>
