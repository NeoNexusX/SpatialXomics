<script setup lang="ts">
/** 面板标题栏：也是拖拽把手 */
import { ArrowLeftIcon, Settings2Icon, SquarePenIcon, XIcon } from '@lucide/vue'
import IconButton from './ai-elements/IconButton.vue'
import HarnessWordmark from './brand/HarnessWordmark.vue'
import ConversationMenu from './conversation/ConversationMenu.vue'

export type AgentViewName = 'chat' | 'connection'

defineProps<{ view: AgentViewName; canStartNew: boolean; busy: boolean }>()

const emit = defineEmits<{
  dragStart: [event: MouseEvent]
  switchView: [view: AgentViewName]
  newChat: []
  close: []
}>()
</script>

<template>
  <header
    class="flex h-12 shrink-0 cursor-grab items-center gap-2 pr-2 pl-4 select-none active:cursor-grabbing"
    @mousedown="emit('dragStart', $event)"
  >
    <template v-if="view === 'connection'">
      <IconButton
        class="-ml-2"
        :label="$t('common.agent.back')"
        @mousedown.stop
        @click="emit('switchView', 'chat')"
      >
        <ArrowLeftIcon />
      </IconButton>
      <h1 class="kawaru-text-75 font-medium">{{ $t('common.agent.connection.title') }}</h1>
    </template>
    <template v-else>
      <h1 class="kawaru-text-81 flex shrink-0"><HarnessWordmark /></h1>
      <div class="flex min-w-0" @mousedown.stop><ConversationMenu /></div>
    </template>

    <div class="ml-auto flex shrink-0 items-center gap-0.5" @mousedown.stop>
      <template v-if="view === 'chat'">
        <IconButton
          v-if="canStartNew"
          :label="$t('common.agent.newChat')"
          :disabled="busy"
          @click="emit('newChat')"
        >
          <SquarePenIcon />
        </IconButton>
        <IconButton
          :label="$t('common.agent.connection.title')"
          @click="emit('switchView', 'connection')"
        >
          <Settings2Icon />
        </IconButton>
      </template>
      <IconButton :label="$t('common.action.close')" @click="emit('close')">
        <XIcon />
      </IconButton>
    </div>
  </header>
</template>
