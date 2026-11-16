<script setup lang="ts">
/** 连接设置：地址、密钥，选一个通过多模态测试的模型 */
import { computed, shallowRef, watch } from 'vue'
import { EyeIcon, EyeOffIcon } from '@lucide/vue'
import { endpointKey, ENDPOINT_PROFILES, ENDPOINT_TYPES } from '../../plugins/connection'
import { useConnection } from '../../composables/useConnection'
import { useModelCatalog } from '../../composables/useModelCatalog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group'
import ModelList from './ModelList.vue'
import ContextSettings from './ContextSettings.vue'

const emit = defineEmits<{ done: [] }>()

const { settings, form, formEndpoint, saveForm, clear } = useConnection()
const { available, open: openCatalog, refresh } = useModelCatalog()

const profile = computed(() => ENDPOINT_PROFILES[form.endpoint])
const showKey = shallowRef(false)

// 地址或密钥变了就换一份测试结果，原来选的模型不一定属于新端点。
// 进行中的测试只属于原来的端点
watch(
  () => (formEndpoint.value ? endpointKey(formEndpoint.value) : null),
  () => {
    form.model = ''
    void openCatalog(formEndpoint.value)
  },
)

/** 开始测试前先存下地址和密钥：刷新页面后才能接着测 */
async function onFetchModels(): Promise<void> {
  await saveForm()
  await refresh()
}

// 只能保存通过了多模态测试的模型
const canSave = computed(() => available.value.includes(form.model))

async function onSave(): Promise<void> {
  if (!canSave.value) return
  await saveForm()
  emit('done')
}

/** 清除要点两次：第一次亮起，3 秒内再点才执行 */
const clearArmed = shallowRef(false)
let clearTimer: ReturnType<typeof setTimeout> | undefined

async function onClear(): Promise<void> {
  clearTimeout(clearTimer)
  if (!clearArmed.value) {
    clearArmed.value = true
    clearTimer = setTimeout(() => (clearArmed.value = false), 3000)
    return
  }
  clearArmed.value = false
  await clear()
}

const hasSavedSettings = computed(
  () => !!(settings.value.baseUrl || settings.value.apiKey || settings.value.model),
)
</script>

<template>
  <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="onSave">
    <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-1 pb-4">
      <div v-if="ENDPOINT_TYPES.length > 1" class="flex flex-wrap gap-1.5">
        <label
          v-for="endpoint in ENDPOINT_TYPES"
          :key="endpoint"
          class="kawaru-text-68 cursor-pointer rounded-full border px-3 py-1 has-checked:border-(--sxo-accent) has-checked:text-(--sxo-accent)"
        >
          <input v-model="form.endpoint" type="radio" :value="endpoint" class="sr-only" />
          {{ ENDPOINT_PROFILES[endpoint].label }}
        </label>
      </div>

      <div class="space-y-1.5">
        <label for="sxo-base-url" class="kawaru-text-62 font-medium text-(--sxo-label-2)">
          {{ $t('common.agent.connection.baseUrl') }}
        </label>
        <Input
          id="sxo-base-url"
          v-model="form.baseUrl"
          autocomplete="off"
          spellcheck="false"
          :placeholder="profile.baseUrl"
        />
        <p v-if="formEndpoint" class="kawaru-text-56 font-mono wrap-anywhere text-(--sxo-label-3)">
          {{ formEndpoint.baseUrl }}{{ profile.requestPath }}
        </p>
      </div>

      <div class="space-y-1.5">
        <label for="sxo-api-key" class="kawaru-text-62 font-medium text-(--sxo-label-2)">
          {{ $t('common.agent.connection.apiKey') }}
        </label>
        <InputGroup>
          <InputGroupInput
            id="sxo-api-key"
            v-model="form.apiKey"
            :type="showKey ? 'text' : 'password'"
            autocomplete="off"
            spellcheck="false"
            :placeholder="$t('common.agent.connection.apiKeyPlaceholder')"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              class="rounded-full"
              :aria-label="
                showKey
                  ? $t('common.agent.connection.hideKey')
                  : $t('common.agent.connection.showKey')
              "
              @click="showKey = !showKey"
            >
              <EyeOffIcon v-if="showKey" />
              <EyeIcon v-else />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <p class="kawaru-text-56 text-(--sxo-label-3)">
          {{ $t('common.agent.connection.apiKeyHint') }}
        </p>
      </div>

      <ModelList v-model="form.model" :endpoint-ready="!!formEndpoint" @fetch="onFetchModels" />
      <ContextSettings :endpoint="formEndpoint" :model="form.model" />
    </div>

    <div class="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
      <Button
        v-if="hasSavedSettings"
        type="button"
        variant="ghost"
        size="sm"
        class="mr-auto rounded-full font-normal text-error hover:text-error"
        @click="onClear"
      >
        {{
          clearArmed ? $t('common.agent.connection.clearConfirm') : $t('common.action.clear')
        }}
      </Button>
      <Button type="submit" size="sm" class="rounded-full px-5" :disabled="!canSave">
        {{ $t('common.action.save') }}
      </Button>
    </div>
  </form>
</template>
