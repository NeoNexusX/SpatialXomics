<script setup lang="ts">
/**
 * 聊天视图。没有消息时字标和输入框居中；开始对话后消息列表占满，输入框落到底部。
 */
import { computed, shallowRef } from 'vue'
import { ArrowDownIcon } from '@lucide/vue'
import { useAssistant } from '../../composables/useAssistant'
import HistoryMarker from '../ai-elements/HistoryMarker.vue'
import HarnessWordmark from '../brand/HarnessWordmark.vue'
import { Button } from '../ui/button'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '../ui/message-scroller'
import AssistantTurn from './AssistantTurn.vue'
import ChatComposer from './ChatComposer.vue'
import UserTurn from './UserTurn.vue'

const emit = defineEmits<{ openConnection: [] }>()

const {
  messages,
  streaming,
  hasContext,
  skillButtons,
  skillLabels,
  earlierAvailable,
  loadEarlier,
  send,
  stop,
  retry,
} = useAssistant()

const isEmpty = computed(() => messages.value.length === 0)

/** 只有最后一条助手消息可以重试 */
const retryTargetId = computed(() => {
  const last = messages.value[messages.value.length - 1]
  return last?.role === 'assistant' && !last.compacted ? last.id : null
})

const loadingEarlier = shallowRef(false)
async function onLoadEarlier(): Promise<void> {
  if (loadingEarlier.value) return
  loadingEarlier.value = true
  try {
    await loadEarlier()
  } finally {
    loadingEarlier.value = false
  }
}

function ask(text: string, images?: string[]): void {
  if (!streaming.value) void send(text, images)
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" :class="{ 'justify-center pb-16': isEmpty }">
    <div v-if="isEmpty" class="kawaru-text-100 mb-6 flex justify-center">
      <HarnessWordmark class="scale-125" />
    </div>

    <MessageScrollerProvider v-else>
      <MessageScroller class="min-h-0 flex-1">
        <MessageScrollerViewport :aria-label="$t('common.assistant.title')">
          <MessageScrollerContent class="gap-4 px-4 pt-2 pb-6">
            <Button
              v-if="earlierAvailable"
              variant="ghost"
              size="xs"
              class="self-center rounded-full font-normal text-muted-foreground"
              :disabled="loadingEarlier"
              @click="onLoadEarlier"
            >
              {{ $t('common.assistant.loadEarlier') }}
            </Button>

            <MessageScrollerItem
              v-for="message in messages"
              :key="message.id"
              :message-id="message.id"
              :scroll-anchor="message.role === 'user'"
            >
              <HistoryMarker v-if="message.compacted" :text="message.content" />
              <UserTurn v-else-if="message.role === 'user'" :message="message" />
              <AssistantTurn
                v-else
                :message="message"
                :can-retry="message.id === retryTargetId && !streaming"
                @retry="retry"
              />
            </MessageScrollerItem>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton class="bottom-2 size-[34px] rounded-full shadow-md">
          <ArrowDownIcon />
          <span class="sr-only">{{ $t('common.assistant.scrollToLatest') }}</span>
        </MessageScrollerButton>
      </MessageScroller>
    </MessageScrollerProvider>

    <div class="shrink-0 px-3 pb-3">
      <ChatComposer
        :streaming="streaming"
        @send="ask"
        @stop="stop"
        @open-connection="emit('openConnection')"
      />
    </div>

    <div v-if="isEmpty" class="flex flex-wrap justify-center gap-1.5 px-3">
      <Button
        v-for="skill in skillButtons"
        :key="skill.name"
        variant="outline"
        size="xs"
        class="rounded-full font-normal text-(--sxo-label-2)"
        @click="ask(skill.text)"
      >
        {{ skillLabels[skill.name] ?? skill.name }}
      </Button>
    </div>
    <p v-if="isEmpty && hasContext" class="kawaru-text-56 mt-3 text-center text-(--sxo-label-3)">
      {{ $t('common.assistant.contextOn') }}
    </p>
  </div>
</template>
