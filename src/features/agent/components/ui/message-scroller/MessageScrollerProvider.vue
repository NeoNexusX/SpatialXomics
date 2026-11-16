<script setup lang="ts">
import { provideMessageScroller } from "./useMessageScroller"

provideMessageScroller()
</script>

<template>
  <slot />
</template>
