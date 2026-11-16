<script setup lang="ts">
import { computed, shallowRef, watch, onScopeDispose } from 'vue'
import type { ResolvedEndpoint } from '../../plugins/connection'
import {
  DEFAULT_CONTEXT_WINDOW,
  MIN_CONTEXT_WINDOW,
  MAX_CONTEXT_WINDOW,
  getContextWindow,
  saveContextWindow,
  validContextWindow,
} from '../../plugins/llm'
import { whenAgentReady } from '../../bootstrap'
import { readBlobText } from '../../plugins/attachments'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

const props = defineProps<{ endpoint: ResolvedEndpoint | null; model: string }>()
const limit = shallowRef(String(DEFAULT_CONTEXT_WINDOW))
const error = shallowRef('')
const saved = shallowRef(false)
const instructionName = shallowRef('')
const busy = shallowRef(false)
const valid = computed(
  () => !!props.endpoint && !!props.model && validContextWindow(Number(limit.value)),
)

watch(
  () => [props.endpoint?.endpoint, props.endpoint?.baseUrl, props.model],
  () => {
    limit.value = String(
      props.endpoint && props.model
        ? getContextWindow(props.endpoint, props.model)
        : DEFAULT_CONTEXT_WINDOW,
    )
    saved.value = false
    error.value = ''
  },
  { immediate: true },
)

async function save(): Promise<void> {
  if (!props.endpoint || !valid.value) return
  try {
    saveContextWindow(props.endpoint, props.model, Number(limit.value))
    saved.value = true
    error.value = ''
  } catch (failure) {
    error.value = String(failure)
  }
}

async function importInstructions(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  busy.value = true
  try {
    const { agent } = await whenAgentReady()
    await agent.setInstructions(file.name, await readBlobText(file))
    instructionName.value = file.name
    error.value = ''
  } catch (failure) {
    error.value = String(failure)
  } finally {
    busy.value = false
    input.value = ''
  }
}

async function removeInstructions(): Promise<void> {
  try {
    await (await whenAgentReady()).agent.setInstructions('', '')
    instructionName.value = ''
  } catch (failure) {
    error.value = String(failure)
  }
}

let disposed = false
let unsubscribe: (() => void) | undefined
onScopeDispose(() => {
  disposed = true
  unsubscribe?.()
})
void whenAgentReady()
  .then(async ({ agent }) => {
    await agent.ready()
    if (disposed) return
    unsubscribe = agent.subscribe((snapshot) => {
      instructionName.value = snapshot.instructions?.name ?? ''
    })
  })
  .catch((failure) => {
    error.value = String(failure)
  })
</script>

<template>
  <section class="space-y-3 border-t pt-4">
    <div class="space-y-1.5">
      <label for="sxo-context-window" class="kawaru-text-62 font-medium text-(--sxo-label-2)">{{
        $t('common.agent.connection.contextWindow')
      }}</label>
      <p class="kawaru-text-56 break-all text-(--sxo-label-3)">
        {{ model || $t('common.agent.connection.chooseModel') }}
      </p>
      <div class="flex items-center gap-2">
        <Input
          id="sxo-context-window"
          v-model="limit"
          type="number"
          :min="MIN_CONTEXT_WINDOW"
          :max="MAX_CONTEXT_WINDOW"
          step="1"
          :disabled="!model || !endpoint"
          @input="saved = false"
        />
        <Button type="button" variant="outline" size="sm" :disabled="!valid" @click="save">{{
          $t('common.action.save')
        }}</Button>
      </div>
      <p class="kawaru-text-56 text-(--sxo-label-3)">
        {{ $t('common.agent.connection.contextWindowHint') }}
      </p>
      <p v-if="saved" role="status" class="kawaru-text-56 text-(--sxo-label-2)">
        {{ $t('common.agent.connection.contextWindowSaved') }}
      </p>
    </div>
    <div class="space-y-1.5">
      <label for="sxo-instructions" class="kawaru-text-62 font-medium text-(--sxo-label-2)">{{
        $t('common.agent.connection.instructions')
      }}</label>
      <input
        id="sxo-instructions"
        type="file"
        accept=".md,.txt,text/plain,text/markdown"
        class="kawaru-text-62 block w-full"
        :disabled="busy"
        @change="importInstructions"
      />
      <div v-if="instructionName" class="flex items-center justify-between gap-2">
        <span class="kawaru-text-56 truncate">{{ instructionName }}</span>
        <Button type="button" variant="ghost" size="xs" @click="removeInstructions">{{
          $t('common.action.clear')
        }}</Button>
      </div>
    </div>
    <p v-if="error" role="alert" class="kawaru-text-62 text-error">{{ error }}</p>
  </section>
</template>
