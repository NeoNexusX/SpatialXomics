<script setup lang="ts">
/**
 * 模型选择：获取列表、测试多模态、只列出通过的模型。
 * 测试状态在 ctx.models 里，这个组件只负责显示和发指令。
 */
import { computed, shallowRef, watch } from 'vue'
import { CheckIcon } from '@lucide/vue'
import { useModelCatalog } from '../../composables/useModelCatalog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Spinner } from '../ui/spinner'

defineProps<{ endpointReady: boolean }>()
const emit = defineEmits<{ fetch: [] }>()

const selected = defineModel<string>({ required: true })

const {
  snapshot,
  models,
  available,
  allowedCount,
  testedCount,
  remainingCount,
  isTesting,
  unsupportedCount,
  unavailableCount,
  testMore,
  retest,
  addModel,
} = useModelCatalog()

const progress = computed(() =>
  allowedCount.value > 0 ? Math.round((testedCount.value / allowedCount.value) * 100) : 0,
)

// 第一个通过测试的模型自动选中，省一次点击
watch(available, (ids) => {
  if (!selected.value && ids[0]) selected.value = ids[0]
})

// ---- 手动输入 ----

const manualId = shallowRef('')
const lastManualId = shallowRef('')
const lastManualStatus = computed(
  () => models.value.find((model) => model.id === lastManualId.value)?.status,
)
const lastManualFailed = computed(
  () =>
    lastManualStatus.value === 'no-vision' ||
    lastManualStatus.value === 'unavailable' ||
    lastManualStatus.value === 'no-response',
)

function onAddManual(): void {
  const id = manualId.value.trim()
  if (!id) return
  lastManualId.value = id
  manualId.value = ''
  void addModel(id)
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <span class="kawaru-text-62 font-medium text-(--sxo-label-2)">
        {{ $t('common.assistant.connection.model') }}
      </span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        class="rounded-full font-normal"
        :disabled="!endpointReady || snapshot.listing"
        @click="emit('fetch')"
      >
        <Spinner v-if="snapshot.listing" class="size-3" />
        {{ $t('common.assistant.connection.fetchModels') }}
      </Button>
    </div>

    <p v-if="snapshot.listError" class="kawaru-text-62 wrap-anywhere text-error">
      {{ snapshot.listError }}
    </p>
    <p v-else-if="models.length === 0" class="kawaru-text-62 text-(--sxo-label-3)">
      {{ $t('common.assistant.connection.visionOnly') }}
    </p>

    <template v-if="models.length > 0">
      <div class="flex items-center justify-between gap-3">
        <span class="kawaru-text-56 text-(--sxo-label-3) tabular-nums">
          {{
            $t('common.assistant.connection.progress', {
              available: available.length,
              tested: testedCount,
              total: models.length,
            })
          }}
          <template v-if="unsupportedCount > 0">
            · {{ $t('common.assistant.connection.unsupported', { count: unsupportedCount }) }}
          </template>
          <template v-if="unavailableCount > 0">
            · {{ $t('common.assistant.connection.unavailable', { count: unavailableCount }) }}
          </template>
        </span>
        <Spinner v-if="isTesting" class="size-3 shrink-0 text-(--sxo-label-3)" />
      </div>
      <div v-if="isTesting" class="h-0.5 overflow-hidden rounded-full bg-muted">
        <div
          class="h-full rounded-full bg-(--sxo-accent) transition-[width] duration-300"
          :style="{ width: `${progress}%` }"
        ></div>
      </div>

      <div role="radiogroup" class="space-y-0.5">
        <label
          v-for="id in available"
          :key="id"
          class="kawaru-text-68 flex min-h-9 cursor-pointer items-center gap-2 rounded-[10px] px-2.5 transition-colors hover:bg-accent has-checked:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring/50"
        >
          <input v-model="selected" type="radio" :value="id" class="sr-only" />
          <span class="min-w-0 flex-1 truncate">{{ id }}</span>
          <CheckIcon v-if="selected === id" class="size-4 shrink-0" />
        </label>
      </div>
      <p v-if="available.length === 0 && !isTesting" class="kawaru-text-62 text-(--sxo-label-3)">
        {{ $t('common.assistant.connection.noVisionModels') }}
      </p>

      <div class="flex flex-wrap gap-1.5 pt-0.5">
        <Button
          v-if="remainingCount > 0"
          type="button"
          variant="outline"
          size="xs"
          class="rounded-full font-normal"
          :disabled="isTesting"
          @click="testMore"
        >
          {{ $t('common.assistant.connection.testMore', { count: remainingCount }) }}
        </Button>
        <Button
          v-if="!isTesting && testedCount > 0"
          type="button"
          variant="ghost"
          size="xs"
          class="rounded-full font-normal text-(--sxo-label-2)"
          @click="retest"
        >
          {{ $t('common.assistant.connection.retest') }}
        </Button>
      </div>
    </template>

    <div class="flex items-center gap-1.5 pt-1">
      <Input
        v-model="manualId"
        autocomplete="off"
        spellcheck="false"
        class="h-8"
        :disabled="!endpointReady"
        :placeholder="$t('common.assistant.connection.manualPlaceholder')"
        @keydown.enter.prevent="onAddManual"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="rounded-full font-normal"
        :disabled="!endpointReady || !manualId.trim()"
        @click="onAddManual"
      >
        {{ $t('common.assistant.connection.test') }}
      </Button>
    </div>
    <p v-if="lastManualFailed" class="kawaru-text-56 wrap-anywhere text-error">
      {{ lastManualId }}:
      {{
        lastManualStatus === 'no-vision'
          ? $t('common.assistant.connection.manualUnsupported')
          : $t('common.assistant.connection.manualUnavailable')
      }}
    </p>
  </section>
</template>
