<template>
  <IconSelect
    :model-value="modelValue"
    :options="selectOptions"
    :placeholder="placeholder"
    :placeholder-selectable="placeholderSelectable"
    :icon-type="iconType"
    :label="label"
    :hide-label="hideLabel"
    :error="error"
    :validator="validator"
    :required="required"
    @update:model-value="onSelectChange"
    @change="$emit('change', $event)"
    @focus="$emit('focus')"
    @blur="$emit('blur')"
  >
    <div v-if="isOther" class="mt-1">
      <input
        :value="otherText"
        @input="onOtherInput"
        @blur="onOtherBlur"
        class="input input-bordered input-md w-full kawaru-text-87"
        :class="{ 'input-error': otherError }"
        :placeholder="otherPlaceholder"
        maxlength="50"
      />
      <span v-if="otherError" class="kawaru-text-87 text-error mt-1 block">{{ otherError }}</span>
    </div>
  </IconSelect>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { t } from '@/i18n'
import IconSelect from '@/shared/components/IconSelect.vue'
import { normalizeOtherInput, toTitleCase, validateOtherInput } from '@/shared/utils/normalizeOtherInput'

const props = defineProps<{
  modelValue: string
  options: readonly string[]
  /**
   * 选项的显示文字（如词表译文）。只影响显示：v-model 收发的始终是 options 里的原值，
   * 提交给后端的仍是英文。缺省时原样显示选项值。
   */
  labelOf?: (value: string) => string
  placeholder?: string
  placeholderSelectable?: boolean
  otherPlaceholder?: string
  iconType?: string
  label?: string
  hideLabel?: boolean
  error?: string
  validator?: boolean
  required?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'change', v: string): void
  (e: 'focus'): void
  (e: 'blur'): void
}>()

const selectOptions = computed(() =>
  props.labelOf
    ? Object.fromEntries(props.options.map((v) => [props.labelOf!(v), v]))
    : props.options,
)

const isOther = ref(false)
const otherText = ref('')
const otherError = ref('')

watch(() => props.modelValue, (val) => {
  if (val === 'Other') {
    isOther.value = true
    otherText.value = ''
    otherError.value = ''
  } else if (val === '' || props.options.includes(val)) {
    isOther.value = false
    otherText.value = ''
    otherError.value = ''
  } else {
    // User-typed value (not "Other" but also not in options)
    isOther.value = true
    otherText.value = val
  }
}, { immediate: true })

function onSelectChange(value: string) {
  otherText.value = ''
  otherError.value = ''
  emit('update:modelValue', value)
}

function onOtherInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  const normalized = normalizeOtherInput(raw)
  otherText.value = normalized
  otherError.value = ''
  // Only emit non-empty values — deleting all text should not collapse the input
  if (normalized.trim()) {
    emit('update:modelValue', normalized)
  }
}

function onOtherBlur() {
  if (!otherText.value.trim()) {
    otherError.value = t('common.input.otherRequired')
    return
  }

  const validationError = validateOtherInput(otherText.value)
  if (validationError) {
    otherError.value = validationError
    return
  }

  otherError.value = ''
  const sanitized = toTitleCase(otherText.value)
  otherText.value = sanitized
  emit('update:modelValue', sanitized)
}</script>
