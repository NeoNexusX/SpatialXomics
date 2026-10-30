<!--
  消息复制按钮：ChatTDesign 里 user / assistant 两种消息共用。

  背景与放置方式：TDesign ChatItem 的 actions 区只对 role:"assistant" 渲染
  （chat-item.mjs 里 `role === "assistant" && showActions && …`），user 消息
  拿不到该槽位——所以助手消息挂 #actions 槽、用户消息由 ChatTDesign 直接
  放进 #content 槽尾部，两边复用本组件保证观感一致。
-->
<template>
  <button
    type="button"
    class="btn btn-xs btn-ghost btn-square kawaru-text-68 hover:text-base-content opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
    :title="$t('common.action.copy')"
    @click="copy(props.text)"
  >
    <svg-icon type="duplicate" class="w-4 h-4" />
  </button>
</template>

<script setup lang="ts">
import { useCopyToClipboard } from '@/shared/composables/useCopyToClipboard'

const props = defineProps<{ text: string }>()

const { copy } = useCopyToClipboard()
</script>
