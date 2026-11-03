<script setup lang="ts">
/** 标题栏里的对话切换器：当前数据集的对话，可以切换、新建、导入、导出和删除。运行中只能导出 */
import { useTemplateRef, watch } from 'vue'
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from '@lucide/vue'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import { useConfirmDelete } from '@/shared/composables/useConfirmDelete'
import { formatDateTime } from '@/shared/utils/format'
import { useConversations } from '../../composables/useConversations'
import CopyButton from '../ai-elements/CopyButton.vue'
import IconButton from '../ai-elements/IconButton.vue'
import { Button } from '../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

const {
  conversations,
  menuOpen,
  notice,
  locked,
  working,
  atLimit,
  available,
  sessionId,
  streaming,
  currentTitle,
  maxConversations,
  refresh,
  dismissFailure,
  startNew,
  open,
  remove,
  exportOne,
  importFile,
} = useConversations()

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const deleteConfirm = useConfirmDelete({ onDelete: remove })

function askDelete(id: string): void {
  menuOpen.value = false
  deleteConfirm.open(id)
}

function onFileChosen(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void importFile(file)
}

watch([sessionId, streaming], () => void refresh(), { immediate: true })
watch(menuOpen, (isOpen) => {
  if (isOpen) void refresh()
  else dismissFailure()
})
</script>

<template>
  <template v-if="available">
    <Popover v-model:open="menuOpen">
      <PopoverTrigger
        class="kawaru-text-62 flex h-7 max-w-44 min-w-0 cursor-pointer items-center gap-1 rounded-full pr-1 pl-2 font-medium text-(--sxo-label-2) outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        :aria-label="$t('common.agent.conversations.title')"
      >
        <span class="truncate">{{ currentTitle }}</span>
        <ChevronDownIcon class="size-3.5 shrink-0 text-(--sxo-label-3)" />
      </PopoverTrigger>
      <PopoverContent align="start" :collision-padding="8" class="agent-scope z-[10001] w-80 p-2">
        <div class="flex items-center gap-1 pb-1 pl-1">
          <span class="kawaru-text-62 font-medium text-(--sxo-label-2)">
            {{ $t('common.agent.conversations.title') }}
          </span>
          <span class="kawaru-text-56 text-(--sxo-label-3)">
            {{ conversations.length }}/{{ maxConversations }}
          </span>
          <Button
            class="ml-auto font-normal"
            variant="ghost"
            size="xs"
            :disabled="locked || atLimit"
            @click="fileInput?.click()"
          >
            <UploadIcon />
            {{ $t('common.agent.conversations.import') }}
          </Button>
          <Button
            class="font-normal"
            variant="ghost"
            size="xs"
            :disabled="locked || atLimit"
            @click="startNew"
          >
            <PlusIcon />
            {{ $t('common.agent.newChat') }}
          </Button>
        </div>
        <p v-if="notice" role="status" class="kawaru-text-56 px-1 pb-1 text-(--sxo-label-3)">
          {{ notice }}
        </p>
        <ul class="space-y-0.5">
          <li
            v-for="item in conversations"
            :key="item.id"
            class="flex items-center gap-0.5 rounded-[10px] pr-1 transition-colors hover:bg-accent"
          >
            <button
              type="button"
              class="min-w-0 flex-1 cursor-pointer rounded-[10px] px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default"
              :aria-current="item.id === sessionId ? 'true' : undefined"
              :disabled="locked"
              @click="open(item.id)"
            >
              <span class="kawaru-text-62 flex items-center gap-1">
                <CheckIcon v-if="item.id === sessionId" class="size-3.5 shrink-0" />
                <span class="truncate">{{
                  item.title || $t('common.agent.conversations.untitled')
                }}</span>
              </span>
              <span class="kawaru-text-56 block truncate text-(--sxo-label-3)">
                #{{ item.id.slice(0, 8) }} · {{ formatDateTime(item.updatedAt) }}
              </span>
            </button>
            <CopyButton :text="item.id" />
            <IconButton
              size="icon-xs"
              :label="$t('common.agent.conversations.export')"
              :disabled="working"
              @click="exportOne(item.id)"
            >
              <DownloadIcon />
            </IconButton>
            <IconButton
              size="icon-xs"
              :label="$t('common.action.delete')"
              :disabled="locked"
              @click="askDelete(item.id)"
            >
              <Trash2Icon />
            </IconButton>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
    <!-- 放在浮层外面：选文件时浮层可能关闭，input 不能跟着卸载 -->
    <input
      ref="fileInput"
      type="file"
      accept=".zip,application/zip"
      class="hidden"
      @change="onFileChosen"
    />
    <Teleport to="body">
      <ConfirmDialog
        class="z-[10002]"
        :open="deleteConfirm.isOpen"
        :title="$t('common.agent.conversations.deleteTitle')"
        :message="$t('common.agent.conversations.deleteMessage')"
        :confirm-label="$t('common.action.delete')"
        danger
        @confirm="deleteConfirm.confirm"
        @cancel="deleteConfirm.cancel"
      />
    </Teleport>
  </template>
</template>
