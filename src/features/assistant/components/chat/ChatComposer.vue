<script setup lang="ts">
/** 输入框：文字、图片（选择或粘贴）、模型选择器、发送 / 停止 */
import { computed, shallowRef } from 'vue'
import { ArrowUpIcon, ImagePlusIcon, SquareIcon, XIcon } from '@lucide/vue'
import { useFileDialog } from '@vueuse/core'
import { useImageAttachments } from '../../composables/useImageAttachments'
import { Attachment, AttachmentAction, AttachmentActions, AttachmentMedia } from '../ui/attachment'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '../ui/input-group'
import ModelPicker from './ModelPicker.vue'

const props = defineProps<{ streaming: boolean }>()

const emit = defineEmits<{
  send: [text: string, images: string[] | undefined]
  stop: []
  openConnection: []
}>()

const text = shallowRef('')
const { images, addFiles, remove, take } = useImageAttachments()

const canSend = computed(() => text.value.trim() !== '' || images.value.length > 0)

const fileDialog = useFileDialog({ accept: 'image/png,image/jpeg,image/webp', multiple: true })
fileDialog.onChange((files) => {
  if (files) void addFiles(Array.from(files))
  fileDialog.reset()
})

function submit(): void {
  if (!canSend.value || props.streaming) return
  const taken = take()
  emit('send', text.value.trim(), taken.length > 0 ? taken : undefined)
  text.value = ''
}

function onEnter(event: KeyboardEvent): void {
  // Shift+Enter 换行；输入法组词时的回车是确认候选词，不是发送
  if (event.shiftKey || event.isComposing) return
  event.preventDefault()
  submit()
}

/**
 * 粘贴截图。Excel、Word 这类图文混排会同时带文字和图片两种内容，
 * 文字并入输入框，不能被图片吞掉；纯文字粘贴走 textarea 默认行为。
 */
function onPaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  if (files.length === 0) return
  event.preventDefault()
  const pasted = event.clipboardData?.getData('text/plain') ?? ''
  if (pasted.trim()) text.value += pasted
  void addFiles(files)
}
</script>

<template>
  <InputGroup
    class="rounded-[20px] bg-base-100 shadow-sm has-[[data-slot=input-group-control]:focus-visible]:border-(--sxo-label-3) has-[[data-slot=input-group-control]:focus-visible]:ring-0"
  >
    <InputGroupAddon
      v-if="images.length > 0"
      align="block-start"
      class="flex-wrap gap-2 px-3.5 pt-3"
    >
      <Attachment
        v-for="(image, index) in images"
        :key="index"
        class="size-14 overflow-hidden rounded-2xl"
      >
        <AttachmentMedia class="size-14 rounded-none">
          <img :src="image" :alt="$t('common.assistant.imageAlt')" class="size-full object-cover" />
        </AttachmentMedia>
        <AttachmentActions class="top-1 right-1">
          <AttachmentAction
            variant="default"
            class="size-[18px] rounded-full bg-base-content/70 text-base-100 hover:bg-base-content"
            :aria-label="$t('common.assistant.removeImage')"
            @click="remove(index)"
          >
            <XIcon />
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
    </InputGroupAddon>

    <InputGroupTextarea
      v-model="text"
      rows="2"
      class="max-h-56 min-h-14 px-4 pt-3 pb-1 caret-(--sxo-accent)"
      :placeholder="$t('common.assistant.placeholder')"
      @keydown.enter="onEnter"
      @paste="onPaste"
    />

    <InputGroupAddon align="block-end" class="justify-between gap-2 px-2.5 pb-2.5">
      <div class="flex min-w-0 items-center gap-1">
        <InputGroupButton
          class="size-7 rounded-full"
          :title="$t('common.assistant.attachImage')"
          :aria-label="$t('common.assistant.attachImage')"
          @click="fileDialog.open()"
        >
          <ImagePlusIcon />
        </InputGroupButton>
        <ModelPicker @open-connection="emit('openConnection')" />
      </div>

      <InputGroupButton
        v-if="streaming"
        variant="default"
        class="size-8 rounded-full"
        :title="$t('common.assistant.stop')"
        :aria-label="$t('common.assistant.stop')"
        @click="emit('stop')"
      >
        <SquareIcon class="size-3 fill-current" />
      </InputGroupButton>
      <InputGroupButton
        v-else
        variant="default"
        class="size-8 rounded-full"
        :disabled="!canSend"
        :title="$t('common.assistant.send')"
        :aria-label="$t('common.assistant.send')"
        @click="submit"
      >
        <ArrowUpIcon />
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
