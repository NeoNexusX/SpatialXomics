<script setup lang="ts">
/** 消息流里的系统提示（如上下文已压缩）：居中的分隔行，和对话内容区分开 */
import { Marker, MarkerContent } from '../ui/marker'

defineProps<{ text: string }>()
</script>

<template>
  <Marker variant="separator" class="text-xs">
    <MarkerContent>{{ text }}</MarkerContent>
  </Marker>
</template>
