<script setup lang="ts">
import { computed, ref } from 'vue'
import TagInput from '@/shared/components/TagInput.vue'
import {
  ANALYZERS,
  CONDITIONS,
  EXPERIMENT_TYPES,
  ION_SOURCES,
  MALDI_MATRICES,
  MALDI_MATRIX_APPLICATIONS,
  ORGANISMS,
  ORGANISM_PARTS,
  POLARITIES,
  SAMPLE_GROWTH_CONDITIONS,
  SAMPLE_STABILIZATIONS,
  SOLVENTS,
  TISSUE_MODIFICATIONS,
} from '@/features/datasets/constants/datasetMetadata'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import { t } from '@/i18n'

/**
 * 筛选面板：枚举字段多值（TagInput，词表下拉可勾选 + 自由输入），
 * 文本字段保持单值模糊匹配。字段 key 与选项值是发给后端的筛选参数
 * （英文）；label / placeholder 随界面语言变化。
 * 多值 payload 走数组（同一字段多值 = OR）；useDatasetList.normalizeFilters
 * 会把空数组归一成 ''（= 该字段不筛选），后端兼容两种写法。
 */
const emit = defineEmits<{
  (e: 'apply', payload: Record<string, string | string[]>): void
  (e: 'close'): void
}>()

interface FilterField {
  key: string
  label: string
  /** text = 单值模糊匹配；multi = 词表多选（数组，OR 语义） */
  type: 'text' | 'multi'
  placeholder?: string
  options?: readonly string[]
}

// 字段 key 与选项值是发给后端的筛选参数（英文）；label / placeholder 随界面语言变化
const fields = computed<FilterField[]>(() => {
  const list: FilterField[] = [
    { key: 'filename', label: t('datasets.field.filename'), type: 'text', placeholder: t('datasets.field.filename') },
    { key: 'experiment_type', label: t('datasets.field.experimentType'), type: 'multi', options: EXPERIMENT_TYPES },
    { key: 'organism', label: t('common.meta.organism'), type: 'multi', options: ORGANISMS },
    { key: 'organism_part', label: t('common.meta.organismPart'), type: 'multi', options: ORGANISM_PARTS },
    { key: 'condition', label: t('common.meta.condition'), type: 'multi', options: CONDITIONS },
    { key: 'sample_stabilization', label: t('common.meta.sampleStabilization'), type: 'multi', options: SAMPLE_STABILIZATIONS },
    { key: 'sample_growth_conditions', label: t('common.meta.growthConditions'), type: 'multi', options: SAMPLE_GROWTH_CONDITIONS },
    { key: 'tissue_modification', label: t('common.meta.tissueModification'), type: 'multi', options: TISSUE_MODIFICATIONS },
    { key: 'maldi_matrix', label: t('common.meta.maldiMatrix'), type: 'multi', options: MALDI_MATRICES },
    { key: 'maldi_matrix_application', label: t('datasets.field.matrixApplication'), type: 'multi', options: MALDI_MATRIX_APPLICATIONS },
    { key: 'solvent', label: t('common.meta.solvent'), type: 'multi', options: SOLVENTS },
    { key: 'polarity', label: t('common.meta.polarity'), type: 'multi', options: POLARITIES },
    { key: 'ionisation_source', label: t('common.meta.ionisationSource'), type: 'multi', options: ION_SOURCES },
    { key: 'analyzer', label: t('common.meta.analyzer'), type: 'multi', options: ANALYZERS },
    { key: 'first_uploaded_by', label: t('datasets.field.submittedBy'), type: 'text', placeholder: t('datasets.filter.submitterPlaceholder') },
  ]
  return list
})

// text 字段存 ''，multi 字段存 string[]；reset/apply 都按 fields 全量重建
const filters = ref<Record<string, string | string[]>>(
  Object.fromEntries(fields.value.map((f) => [f.key, f.type === 'text' ? '' : []])),
)

const applyFilters = () => {
  emit('apply', { ...filters.value })
  emit('close')
}

const resetFilters = () => {
  for (const field of fields.value) {
    filters.value[field.key] = field.type === 'text' ? '' : []
  }
  emit('apply', { ...filters.value })
  emit('close')
}
</script>

<template>
  <div class="flex flex-wrap gap-4">
    <div
      v-for="field in fields"
      :key="field.key"
      class="kawaru-text-87 text-base-content/60 flex flex-col w-full sm:w-[calc(50%-8px)]"
    >
      {{ field.label }}
      <input
        v-if="field.type === 'text'"
        :value="filters[field.key] as string"
        class="w-full mt-1 p-2 rounded border border-base-300 bg-base-200 kawaru-text-87"
        :placeholder="field.placeholder"
        @input="filters[field.key] = ($event.target as HTMLInputElement).value"
      />
      <TagInput
        v-else
        :model-value="filters[field.key] as string[]"
        @update:model-value="filters[field.key] = $event"
        :options="field.options ?? []"
        :label-of="vocabLabel"
        :name="field.label"
        :placeholder="$t('datasets.filter.any')"
      />
    </div>
  </div>
  <!-- 本面板经 <teleport to="body"> 渲染，够不着页面外壳的字号，
       所以必须显式挂档位，不能靠继承。 -->
  <div class="mt-3 flex justify-end gap-2">
    <button
      @click="resetFilters"
      class="btn btn-outline kawaru-text-87 border border-base-300 hover:bg-base-300">{{ $t('common.action.reset') }}</button>
    <button
    @click="applyFilters"
    class="btn btn-primary kawaru-text-87 border border-base-300 hover:bg-base-300">{{ $t('common.action.apply') }}</button>
  </div>
</template>
