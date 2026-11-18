<template>
  <div class="flex flex-col gap-2">
    <!-- 标签 + 用量 + 单位 + 溶剂 + 添加同一行；窄屏标签单独占一行。
         items-start：选 Other 时下拉下方会多出输入框，居中对齐会把整行拉偏；
         标签 h-10 与控件同高，文字才与输入框居中。
         字号与下拉一致（87），标签取 81，不大过外层字段名。 -->
    <div class="flex flex-wrap items-start gap-2">
      <label :for="amountId" class="label kawaru-text-81 basis-full sm:basis-auto sm:h-10">
        {{ $t('upload.solvent.amount') }}
      </label>

      <div class="flex flex-col flex-1 min-w-0">
        <input
          :id="amountId"
          v-model="amountStr"
          type="text"
          inputmode="decimal"
          class="input input-bordered w-full kawaru-text-87"
          :class="{ 'input-error': amountError }"
          :placeholder="$t('common.input.example', { value: 50 })"
          @keyup.enter="addSolvent"
        />
        <span v-if="amountError" class="kawaru-text-75 text-error mt-0.5">{{ amountError }}</span>
      </div>

      <!-- 单位：% 是组成比例，其余是浓度；词表没有时选 Other 自填 -->
      <div class="flex flex-col shrink-0">
        <select
          v-model="unitSelection"
          class="select select-bordered h-10 w-24 kawaru-text-87"
          :aria-label="$t('upload.solvent.unit')"
        >
          <option v-for="u in SOLVENT_UNITS" :key="u" :value="u">{{ u }}</option>
          <option :value="CUSTOM_UNIT">{{ $t('common.input.other') }}</option>
        </select>
        <input
          v-if="unitSelection === CUSTOM_UNIT"
          v-model="customUnit"
          type="text"
          class="input input-bordered w-24 mt-1 kawaru-text-87"
          :class="{ 'input-error': customUnitError }"
          :placeholder="$t('upload.solvent.customUnitPlaceholder')"
          :aria-label="$t('upload.solvent.unit')"
        />
        <span v-if="customUnitError" class="kawaru-text-75 text-error mt-0.5 w-24">{{ customUnitError }}</span>
      </div>

      <div class="flex-[2] min-w-0">
        <SelectWithOther
          v-model="selectedSolvent"
          :options="solventOptions"
          :label-of="vocabLabel"
          :placeholder="$t('common.input.selectShort')"
          :other-placeholder="$t('common.input.specifyOther')"
          :custom-input-mode="customInputMode"
          :max-length="maxLength"
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
import {
  SOLVENT_UNITS,
  formatSolventEntry,
  parseSolventEntry,
  type SolventUnit,
} from '@/features/datasets/utils/solventEntry'
import { t } from '@/i18n'

const props = defineProps<{
  modelValue: string
  solventOptions: readonly string[]
  customInputMode?: 'normalized' | 'verbatim'
  maxLength?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
}>()

const amountId = useId()

/** 单位下拉里触发自填输入的哨兵值，避免与真实单位值冲突 */
const CUSTOM_UNIT = '__custom__'

// Local state
const amountStr = ref('')
const unitSelection = ref<SolventUnit | typeof CUSTOM_UNIT>('%')
const customUnit = ref('')
const selectedSolvent = ref('')
const error = ref('')

// Parse amount string to number (null if invalid)
const amount = computed(() => {
  const val = parseFloat(amountStr.value)
  if (isNaN(val)) return null
  return val
})

// 实际单位：下拉选了 Other 时取自填值
const effectiveUnit = computed(() => {
  return unitSelection.value === CUSTOM_UNIT ? customUnit.value.trim() : unitSelection.value
})

// 百分比是组成比例（0 < x ≤ 100，0.1% TFA 这类小比例也合法）；浓度只要求 > 0
function amountMessage(): string {
  return effectiveUnit.value === '%'
    ? t('upload.solvent.percentageError')
    : t('upload.solvent.concentrationError')
}

const customUnitError = computed(() => {
  if (unitSelection.value !== CUSTOM_UNIT || customUnit.value.trim()) return ''
  return t('upload.solvent.customUnitRequired')
})

const isValidAmount = computed(() => {
  const val = amount.value
  if (val === null || val <= 0) return false
  // 自填单位填成 % 时同样按比例上限校验
  return effectiveUnit.value === '%' ? val <= 100 : true
})

const amountError = computed(() => {
  if (!amountStr.value) return ''
  // 单位还没填时只提示单位错误，避免同时报两条
  if (customUnitError.value) return ''
  return isValidAmount.value ? '' : amountMessage()
})

// Parse existing solvent string into entries
const solventEntries = computed(() => {
  if (!props.modelValue) return []
  return props.modelValue
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
})

/** 条目形如 "50% Water" / "1 mM Acetic acid"：提交的仍是英文串，只把组分名换成显示文字 */
function entryLabel(entry: string): string {
  const parsed = parseSolventEntry(entry)
  if (!parsed) return entry
  return formatSolventEntry(parsed.value, parsed.unit, vocabLabel(parsed.name))
}

// Can add check
const canAdd = computed(() => {
  return isValidAmount.value && effectiveUnit.value !== '' && selectedSolvent.value.trim() !== ''
})

// Add solvent
function addSolvent() {
  error.value = ''

  if (customUnitError.value) {
    error.value = customUnitError.value
    return
  }

  if (!isValidAmount.value) {
    error.value = amountError.value || amountMessage()
    return
  }

  if (!selectedSolvent.value.trim()) {
    error.value = t('upload.solvent.selectSolvent')
    return
  }

  const newEntry = formatSolventEntry(amount.value!, effectiveUnit.value, selectedSolvent.value.trim())
  const currentEntries = solventEntries.value.length > 0
    ? [...solventEntries.value, newEntry]
    : [newEntry]

  emit('update:modelValue', currentEntries.join(', '))

  // Reset (单位保留：连续添加同类添加剂时不用重复切换)
  amountStr.value = ''
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
