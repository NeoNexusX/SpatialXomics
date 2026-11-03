<script setup lang="ts">
/** 面板标题栏：也是拖拽把手 */
import { ArrowLeftIcon, Settings2Icon, SquarePenIcon, XIcon } from '@lucide/vue'
import IconButton from './ai-elements/IconButton.vue'
import HarnessWordmark from './brand/HarnessWordmark.vue'

export type AssistantViewName = 'chat' | 'connection'

defineProps<{ view: AssistantViewName; canClear: boolean }>()

const emit = defineEmits<{
  dragStart: [event: MouseEvent]
  switchView: [view: AssistantViewName]
  clear: []
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
        :label="$t('common.assistant.back')"
        @mousedown.stop
        @click="emit('switchView', 'chat')"
      >
        <ArrowLeftIcon />
      </IconButton>
      <h1 class="kawaru-text-75 font-medium">{{ $t('common.assistant.connection.title') }}</h1>
    </template>
    <h1 v-else class="kawaru-text-81 flex"><HarnessWordmark /></h1>

    <div class="ml-auto flex shrink-0 items-center gap-0.5" @mousedown.stop>
      <template v-if="view === 'chat'">
        <IconButton v-if="canClear" :label="$t('common.assistant.newChat')" @click="emit('clear')">
          <SquarePenIcon />
        </IconButton>
        <IconButton
          :label="$t('common.assistant.connection.title')"
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
