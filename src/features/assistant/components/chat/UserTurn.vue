<script setup lang="ts">
/** 用户的一条消息：图片、文字气泡，悬停时在左侧显示复制 */
import type { UiChatItem } from '../../agenttypes/assistant'
import CopyButton from '../ai-elements/CopyButton.vue'
import { Bubble, BubbleContent } from '../ui/bubble'
import { Message, MessageContent } from '../ui/message'

defineProps<{ message: UiChatItem }>()
</script>

<template>
  <Message align="end">
    <MessageContent class="gap-1.5">
      <div v-if="message.images?.length" class="flex flex-wrap justify-end gap-1.5 self-end">
        <img
          v-for="(image, index) in message.images"
          :key="index"
          :src="image"
          :alt="$t('common.assistant.imageAlt')"
          class="max-h-40 max-w-40 rounded-2xl border object-contain"
        />
      </div>
      <div v-if="message.content" class="relative max-w-[82%] self-end">
        <Bubble class="max-w-full">
          <BubbleContent class="rounded-[20px] px-4 py-2 whitespace-pre-wrap">{{
            message.content
          }}</BubbleContent>
        </Bubble>
        <CopyButton
          :text="message.content"
          class="absolute top-1.5 right-full mr-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100"
        />
      </div>
    </MessageContent>
  </Message>
</template>
