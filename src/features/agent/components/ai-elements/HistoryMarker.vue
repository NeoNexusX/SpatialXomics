<script setup lang="ts">
/** 消息流里的系统提示（如上下文已压缩）：居中的分隔行，和对话内容区分开。active 表示还在进行 */
import { Marker, MarkerContent } from '../ui/marker'
import { Spinner } from '../ui/spinner'

defineProps<{ text: string; active?: boolean }>()
</script>

<template>
  <Marker variant="separator" class="text-xs">
    <Spinner v-if="active" class="size-3" />
    <MarkerContent>{{ text }}</MarkerContent>
  </Marker>
</template>
