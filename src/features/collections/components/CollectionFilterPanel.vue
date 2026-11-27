<script setup lang="ts">
import { computed, ref } from 'vue'
import TagInput from '@/shared/components/TagInput.vue'
import {
  COLLECTION_TYPES,
  MEMBER_TYPES,
  collectionVocabLabel,
} from '../constants/collectionVocab'
import {
  ANALYZERS,
  ION_SOURCES,
  ORGANISMS,
  ORGANISM_PARTS,
  POLARITIES,
  SAMPLE_GROWTH_CONDITIONS,
  SAMPLE_STABILIZATIONS,
  TISSUE_MODIFICATIONS,
} from '@/features/datasets/constants/datasetMetadata'
import { t } from '@/i18n'

/**
 * 集合列表筛选面板：POST /collections/list(_all) 的筛选体（后端 §4.3）。
 * 与 DatasetFilterPanel 同构（枚举 TagInput 多选、文本单值模糊），但语义有差：
 * member_type / collection_type 与集合上的数组做交集匹配（大小写不敏感）；organism 等
 * 词表字段是「集合内包含该值」——集合这些字段是成员文件取值的汇总数组，不是「等于」。
 * 多值 payload 走数组（同字段多值 = OR，字段间 AND）；空数组后端视为不筛选。
 * doi / access 不参与筛选（后端未开放）。
 */
const props = withDefaults(
  defineProps<{
    /** 显示 owner_username 筛选：仅 /list_all（浏览全部）有意义，我的集合 owner 恒为当前用户 */
    showOwner?: boolean
  }>(),
  { showOwner: false },
)

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

// 字段 key 是发给后端的筛选参数；label / placeholder 随界面语言变化
const fields = computed<FilterField[]>(() => {
  const list: FilterField[] = [
    { key: 'name', label: t('common.field.name'), type: 'text', placeholder: t('collections.filter.placeholder.name') },
    { key: 'title', label: t('collections.meta.title'), type: 'text', placeholder: t('collections.filter.placeholder.title') },
    { key: 'member_type', label: t('collections.meta.memberType'), type: 'multi', options: MEMBER_TYPES },
    { key: 'collection_type', label: t('collections.meta.collectionType'), type: 'multi', options: COLLECTION_TYPES },
    { key: 'organism', label: t('common.meta.organism'), type: 'multi', options: ORGANISMS },
    { key: 'organism_part', label: t('common.meta.organismPart'), type: 'multi', options: ORGANISM_PARTS },
    { key: 'sample_stabilization', label: t('common.meta.sampleStabilization'), type: 'multi', options: SAMPLE_STABILIZATIONS },
    { key: 'sample_growth_conditions', label: t('common.meta.growthConditions'), type: 'multi', options: SAMPLE_GROWTH_CONDITIONS },
    { key: 'tissue_modification', label: t('common.meta.tissueModification'), type: 'multi', options: TISSUE_MODIFICATIONS },
    { key: 'polarity', label: t('common.meta.polarity'), type: 'multi', options: POLARITIES },
    { key: 'ionisation_source', label: t('common.meta.ionisationSource'), type: 'multi', options: ION_SOURCES },
    { key: 'analyzer', label: t('common.meta.analyzer'), type: 'multi', options: ANALYZERS },
    { key: 'journal_name', label: t('collections.meta.journal'), type: 'text', placeholder: t('collections.filter.placeholder.journal') },
  ]
  if (props.showOwner)
    list.push({ key: 'owner_username', label: t('common.field.username'), type: 'text', placeholder: t('collections.filter.placeholder.owner') })
  return list
})

// text 字段存 ''，multi 字段存 string[]；reset/apply 都按 fields 全量重建
const filters = ref<Record<string, string | string[]>>(
  Object.fromEntries(fields.value.map((f) => [f.key, f.type === 'text' ? '' : []])),
)

/**
 * 提交前移除动态隐藏字段的键（如切到 Mine only 后的 owner_username）：
 * 它们用户无法编辑，留着会以两种方式作恶——随 payload 发出成为隐藏筛选，
 * 或切回浏览全部时显示有值但实际未生效。删除后两种状态都与列表一致。
 */
function dropHiddenFields() {
  for (const key of Object.keys(filters.value)) {
    if (!fields.value.some((f) => f.key === key)) delete filters.value[key]
  }
}

const applyFilters = () => {
  dropHiddenFields()
  emit('apply', { ...filters.value })
  emit('close')
}

const resetFilters = () => {
  dropHiddenFields()
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
        :label-of="collectionVocabLabel"
        :name="field.label"
        :placeholder="$t('collections.filter.any')"
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
