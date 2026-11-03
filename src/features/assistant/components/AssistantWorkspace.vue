<script setup lang="ts">
/**
 * 面板的内容：标题栏 + 聊天 / 连接设置。
 * 还没有可用连接时直接落到连接设置。聊天视图切走时用 v-show 保留，草稿和滚动位置都不丢。
 */
import { onMounted, shallowRef } from 'vue'
import { useAssistant } from '../composables/useAssistant'
import { useConnection } from '../composables/useConnection'
import { useModelCatalog } from '../composables/useModelCatalog'
import AssistantHeader, { type AssistantViewName } from './AssistantHeader.vue'
import ChatView from './chat/ChatView.vue'
import ConnectionView from './connection/ConnectionView.vue'

const emit = defineEmits<{ dragStart: [event: MouseEvent]; close: [] }>()

const { messages, clear, refreshContext } = useAssistant()
const { active, formEndpoint } = useConnection()
const { open: openCatalog } = useModelCatalog()

const view = shallowRef<AssistantViewName>(active.value ? 'chat' : 'connection')

onMounted(() => {
  refreshContext()
  // 恢复测试结果；上次没测完的在这里接着测
  void openCatalog(formEndpoint.value)
})
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <AssistantHeader
      :view="view"
      :can-clear="messages.length > 0"
      @drag-start="emit('dragStart', $event)"
      @switch-view="view = $event"
      @clear="clear"
      @close="emit('close')"
    />
    <ChatView v-show="view === 'chat'" @open-connection="view = 'connection'" />
    <ConnectionView v-if="view === 'connection'" @done="view = 'chat'" />
  </div>
</template>
