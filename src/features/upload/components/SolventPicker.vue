<template>
  <div class="flex flex-col gap-2">
    <!-- 标签 + 比例 + 溶剂 + 添加同一行；窄屏标签单独占一行。
         items-start：选 Other 时下拉下方会多出输入框，居中对齐会把整行拉偏；
         标签 h-10 与控件同高，文字才与输入框居中。
         字号与下拉一致（87），标签取 81，不大过外层字段名。 -->
    <div class="flex flex-wrap items-start gap-2">
      <label :for="percentageId" class="label kawaru-text-81 basis-full sm:basis-auto sm:h-10">
        {{ $t('upload.solvent.percentage') }}
      </label>

      <div class="flex flex-col flex-1 min-w-0">
        <input
          :id="percentageId"
          v-model="percentageStr"
          type="text"
          inputmode="decimal"
          class="input input-bordered w-full kawaru-text-87"
          :class="{ 'input-error': percentageError }"
          :placeholder="$t('common.input.example', { value: 50 })"
          @keyup.enter="addSolvent"
        />
        <span v-if="percentageError" class="kawaru-text-75 text-error mt-0.5">{{ percentageError }}</span>
      </div>

      <div class="flex-[2] min-w-0">
        <SelectWithOther
          v-model="selectedSolvent"
          :options="solventOptions"
          :label-of="vocabLabel"
          :placeholder="$t('common.input.selectShort')"
          :other-placeholder="$t('common.input.specifyOther')"
          hide-label
        />
      </div>

      <button
        class="btn btn-primary btn-square shrink-0 kawaru-text-87"
        :disabled="!canAdd"
        :title="$t('upload.solvent.add')"
        @click="addSolvent"
      >
        <SvgIcon type="plus" class="h-5 w-5" />
      </button>
    </div>

    <!-- Error -->
    <span v-if="error" class="kawaru-text-87 text-error">{{ error }}</span>

    <!-- Solvent list -->
    <div v-if="solventEntries.length > 0" class="flex flex-col gap-1">
      <div
        v-for="(entry, index) in solventEntries"
        :key="index"
        class="flex items-center justify-between bg-base-200 rounded-lg px-3 py-1.5"
      >
        <span class="kawaru-text-87">{{ entryLabel(entry) }}</span>
        <button
          class="btn btn-ghost btn-xs text-error kawaru-text-68"
          @click="removeSolvent(index)"
:title="$t('common.action.remove')"
        >
          <SvgIcon type="close" class="h-4 w-4" />
        </button>
      </div>
    </div>

    <!-- Clear all -->
    <div v-if="solventEntries.length > 0" class="flex justify-end">
      <button class="btn btn-ghost btn-sm text-error kawaru-text-75" @click="clearAll">
        {{ $t('common.action.clearAll') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, useId } from 'vue'
import SelectWithOther from '@/shared/components/SelectWithOther.vue'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import { t } from '@/i18n'

const props = defineProps<{
  modelValue: string
  solventOptions: readonly string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

const percentageId = useId()

// Local state
const percentageStr = ref('')
const selectedSolvent = ref('')
const error = ref('')

// Parse percentage string to number (null if invalid)
const percentage = computed(() => {
  const val = parseFloat(percentageStr.value)
  if (isNaN(val)) return null
  return val
})

const percentageError = computed(() => {
  if (!percentageStr.value) return ''
  const val = percentage.value
  if (val === null || val < 1 || val > 100) return t('upload.solvent.percentageError')
  return ''
})

// Parse existing solvent string into entries
const solventEntries = computed(() => {
  if (!props.modelValue) return []
  return props.modelValue.split(',').map(s => s.trim()).filter(Boolean)
})

/** 条目形如 "50% Water"：提交的仍是这个英文串，只把溶剂名部分换成显示文字 */
function entryLabel(entry: string): string {
  const m = /^(\S+%)\s+(.+)$/.exec(entry)
  return m ? `${m[1]} ${vocabLabel(m[2])}` : entry
}

// Can add check
const canAdd = computed(() => {
  return percentage.value !== null && percentage.value >= 1 && percentage.value <= 100 && selectedSolvent.value.trim() !== ''
})

// Add solvent
function addSolvent() {
  error.value = ''

  if (percentage.value === null || percentage.value < 1 || percentage.value > 100) {
    error.value = t('upload.solvent.invalidPercentage')
    return
  }

  if (!selectedSolvent.value.trim()) {
    error.value = t('upload.solvent.selectSolvent')
    return
  }

  const newEntry = `${percentage.value}% ${selectedSolvent.value.trim()}`
  const currentEntries = solventEntries.value.length > 0
    ? [...solventEntries.value, newEntry]
    : [newEntry]

  emit('update:modelValue', currentEntries.join(', '))

  // Reset
  percentageStr.value = ''
  selectedSolvent.value = ''
}

// Remove single entry
function removeSolvent(index: number) {
  const entries = [...solventEntries.value]
  entries.splice(index, 1)
  emit('update:modelValue', entries.join(', '))
}

// Clear all
function clearAll() {
  emit('update:modelValue', '')
  error.value = ''
}
</script>
