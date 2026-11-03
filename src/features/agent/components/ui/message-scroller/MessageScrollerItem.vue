<script setup lang="ts">
defineProps<{
  messageId: string
  scrollAnchor?: boolean
}>()
</script>

<template>
  <div
    data-slot="message-scroller-item"
    :data-message-id="messageId"
    :data-scroll-anchor="scrollAnchor ? 'true' : 'false'"
    class="min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]"
  >
    <slot />
  </div>
</template>
