<template>
  <!-- 字号全部绝对，与 IconInput 同构：标签 95 档、控件文字 87 档、
       图标 kawaru-field-icon。内层 .select 需显式挂档位压过 daisyUI 死值。 -->
  <div class="form-control">
    <template v-if="!hideLabel && label">
      <label class="label">
        <span class="label-text kawaru-text-95 font-semibold">
          {{ label }}
        </span>
      </label>
    </template>

    <label
      class="select w-full flex items-center gap-2 kawaru-text-87"
      :class="[
        { validator: validator },
        size === 'xs' ? 'select-xs' : size === 'sm' ? 'select-sm' : size === 'lg' ? 'select-lg' : '',
      ]"
    >
      <SvgIcon
        v-if="iconType"
        :type="iconType"
        class="mr-2 ml-2 flex-shrink-0 kawaru-field-icon"
        aria-hidden="true"
      />
      <!-- 可见文本层：Chromium 对 <select> 强制 overflow:visible，text-overflow
           不生效，长选项（MALDI Matrix 等）会一路画到箭头下面。改为自绘文本并
           truncate（字重/字号/透明度与原 select 完全一致，只多了截断），
           原生 select 透明铺满整个控件，只负责交互与展开列表。 -->
      <span class="grow w-full truncate opacity-80 kawaru-text-87" :title="selectedTitle">
        {{ displayLabel }}
      </span>
      <!-- 原生 select 透明覆盖层只负责交互，字号必须与上面的 span 一致：
           展开列表由它渲染，字号不同会让选项看起来比闭合态更大更粗。 -->
      <select
        class="icon-select-native kawaru-text-87"
        :value="modelValue"
        :required="required"
        @change="onChange"
        @focus="emit('focus')"
        @blur="emit('blur')"
      >
        <option
          v-if="placeholderText"
          value=""
          :disabled="required || !placeholderSelectable"
          :hidden="!placeholderSelectable"
        >
          {{ placeholderText }}
        </option>
        <option
          v-for="(value, label) in normalizedOptions"
          :key="label"
          :value="value"
        >
          {{ label }}
        </option>
      </select>
    </label>

    <slot></slot>

    <label class="label" v-if="error">
      <span class="label-text-alt kawaru-text-87 text-error">{{ error }}</span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PropType } from 'vue'
import { t } from '@/i18n'

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: '',
  },
  options: {
    type: [String, Array, Object] as PropType<string | readonly string[] | Record<string, string>>,
    required: true,
  },
  label: {
    type: String,
    default: '',
  },
  hideLabel: {
    type: Boolean,
    default: false,
  },
  // 缺省（undefined）时显示当前语言的「请选择」；显式传 '' 表示不要占位项
  placeholder: {
    type: String,
    default: undefined,
  },
  // 占位项（提示文案）默认不是可选项：它只负责在未选时显示提示，
  // 不该出现在展开列表里被点成“空值”。需要“选回空值”语义的下拉
  // （如筛选器的 Any）显式打开此开关。
  placeholderSelectable: {
    type: Boolean,
    default: false,
  },
  iconType: {
    type: String,
    default: '',
  },
  error: {
    type: String,
    default: '',
  },
  validator: {
    type: Boolean,
    default: false,
  },
  size: {
    type: String as PropType<'xs' | 'sm' | 'md' | 'lg'>,
    default: 'md',
  },
  required: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
  (e: 'focus'): void
  (e: 'blur'): void
}>()

const placeholderText = computed(() => props.placeholder ?? t('common.input.selectPlaceholder'))

const normalizedOptions = computed(() => {
  if (typeof props.options === 'string') {
    return { [props.options]: props.options }
  }

  if (Array.isArray(props.options)) {
    // Deduplicate using Set, then reduce to { label: value } object
    const unique = [...new Set(props.options)]
    return unique.reduce<Record<string, string>>((options, option) => {
      options[option] = option
      return options
    }, {})
  }
  return props.options
})

// 闭合态显示的文本，对齐原生 select 的语义：空值显示 placeholder；
// 命中选项显示其 label；值不在选项里（如 SelectWithOther 的自由输入）显示空。
const displayLabel = computed(() => {
  const value = props.modelValue
  if (value === '' || value == null) return placeholderText.value
  const options = normalizedOptions.value as Record<string, string>
  return Object.keys(options).find((label) => options[label] === String(value)) ?? ''
})

// 被截断时的全文提示（占位文案不需要）
const selectedTitle = computed(() => {
  const value = props.modelValue
  if (value === '' || value == null) return undefined
  return displayLabel.value || undefined
})

const onChange = (e: Event) => {
  const value = (e.target as HTMLSelectElement).value
  emit('update:modelValue', value)
  emit('change', value)
}
</script>

<style scoped>
/* 原生 select 只负责交互（点击展开、键盘选择），可见文本由上面的 span 渲染。
   需覆盖 daisyUI `.select > select` 的溢出式宽度与负边距——scoped 样式不在
   Tailwind 的 layer 内，天然压过 daisyUI 的 utilities 层。 */
.icon-select-native {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border-style: none;
  opacity: 0;
  cursor: pointer;
}
</style>
