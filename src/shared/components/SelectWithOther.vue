<template>
  <IconSelect
    :model-value="isOther ? 'Other' : modelValue"
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
        :class="{ 'input-error': error || otherError }"
        :placeholder="otherPlaceholder"
        :maxlength="customInputMode === 'verbatim' ? undefined : maxLength"
        :aria-label="label || undefined"
        :aria-invalid="!!(error || otherError)"
      />
      <span v-if="otherError" class="kawaru-text-87 text-error mt-1 block">{{ otherError }}</span>
    </div>
  </IconSelect>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { t } from '@/i18n'
import IconSelect from '@/shared/components/IconSelect.vue'
import {
  normalizeOtherInput,
  toTitleCase,
  validateOtherInput,
} from '@/shared/utils/normalizeOtherInput'

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
  /** 自由输入的最大长度；默认沿用注册/上传表单的 50，编辑弹窗传 128 以对齐后端 */
  maxLength?: number
  /** 元信息编辑保留原始文本；校验交由父表单，避免改写大小写或限制 Unicode。 */
  customInputMode?: 'normalized' | 'verbatim'
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

const maxLength = computed(() => props.maxLength ?? 50)

const isOther = ref(false)
const otherText = ref('')
const otherError = ref('')

watch(
  () => props.modelValue,
  (val) => {
    // 自定义输入清空后仍保留输入框；只跳过本控件刚发出的值。
    if (props.customInputMode === 'verbatim' && isOther.value && val === otherText.value) return
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
  },
  { immediate: true },
)

function onSelectChange(value: string) {
  otherText.value = ''
  otherError.value = ''
  isOther.value = value === 'Other'
  emit('update:modelValue', props.customInputMode === 'verbatim' && isOther.value ? '' : value)
}

function onOtherInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  if (props.customInputMode === 'verbatim') {
    otherText.value = raw
    otherError.value = ''
    emit('update:modelValue', raw)
    return
  }
  const normalized = normalizeOtherInput(raw)
  otherText.value = normalized
  otherError.value = ''
  // Only emit non-empty values — deleting all text should not collapse the input
  if (normalized.trim()) {
    emit('update:modelValue', normalized)
  }
}

function onOtherBlur() {
  if (props.customInputMode === 'verbatim') {
    emit('blur')
    return
  }
  if (!otherText.value.trim()) {
    otherError.value = t('common.input.otherRequired')
    return
  }

  const validationError = validateOtherInput(otherText.value, maxLength.value)
  if (validationError) {
    otherError.value = validationError
    return
  }

  otherError.value = ''
  const sanitized = toTitleCase(otherText.value)
  otherText.value = sanitized
  emit('update:modelValue', sanitized)
}
</script>
