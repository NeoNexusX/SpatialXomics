<template>
  <!-- 集合学术元数据面板：由 metadataFields 定义表驱动（单一事实来源，
       只读展示与编辑表单同一张表）。按组分区渲染，**全部字段都展示**——未填写的
       显示「—」而不是隐藏，这样每张详情页的字段排布一致、可逐行对照；
       头部显示“已填写 N/M”概览。
       传 draft 即切到编辑态（Overview 原地编辑）：正文换成表驱动的表单，
       卡片外壳与头部保持不变；公开只读页不传 → 永远只读。 -->
  <section
    class="bg-base-100 dark:bg-slate-800 rounded-xl shadow-sm border border-base-300 p-4 sm:p-6"
  >
    <div class="flex items-center justify-between gap-3 mb-4">
      <h2 class="kawaru-text-125 font-bold text-base-content">{{ $t('collections.panel.title') }}</h2>
      <span
        class="badge badge-sm font-medium border border-base-300 bg-base-200 text-base-content/70 whitespace-nowrap kawaru-text-75"
      >
        {{ $t('collections.panel.fieldsCount', { filled: filledCount, total: METADATA_FIELDS.length }) }}
      </span>
    </div>

    <!-- 编辑态：18 字段表单（草稿由父级持有，上面的 N/M 计数读它，输入时实时更新） -->
    <CollectionMetadataForm v-if="draft" :draft="draft" />

    <template v-else>
      <template v-for="(group, index) in METADATA_GROUPS" :key="group.id">
        <h3
          class="kawaru-text-95 font-semibold uppercase tracking-wide text-base-content/50 border-b border-base-200 dark:border-slate-700 pb-1 mb-3"
        >
          {{ group.label() }}
        </h3>
        <dl
          class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3"
          :class="index === METADATA_GROUPS.length - 1 ? '' : 'mb-6'"
        >
          <div
            v-for="field in fieldsOf(group.id)"
            :key="field.key"
            class="flex flex-col gap-0.5 min-w-0"
            :class="field.type === 'long' ? 'md:col-span-2' : ''"
          >
            <dt class="kawaru-text-81 font-medium text-base-content/50">{{ field.label() }}</dt>
            <!-- 未填写：统一显示长破折号占位 -->
            <dd v-if="!hasValue(field)" class="kawaru-text-95 text-base-content/35">—</dd>
            <!-- list 字段渲染为 chips，text/long 直接展示文本 -->
            <dd v-else-if="field.type === 'list'" class="flex flex-wrap gap-1.5">
              <span
                v-for="item in asList(metadata[field.key])"
                :key="String(item)"
                class="inline-flex items-center rounded-full px-2.5 py-0.5 kawaru-text-81 font-medium bg-base-200/80 text-base-content/70 border border-base-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600"
              >
                {{ collectionVocabLabel(String(item)) }}
              </span>
            </dd>
            <!-- 引用 / 摘要可长达 16000 字符：默认折叠为几行，被截断时可展开全文 -->
            <dd
              v-else-if="field.collapsible"
              class="kawaru-text-95 leading-relaxed text-base-content/80"
            >
              <CollapsibleText :value="String(metadata[field.key] ?? '')" />
            </dd>
            <!-- 其余长文本（简介，上限 512）整段展示，保留换行 -->
            <dd
              v-else-if="field.type === 'long'"
              class="kawaru-text-95 leading-relaxed text-base-content/80 whitespace-pre-line"
            >
              {{ metadata[field.key] }}
            </dd>
            <!-- date 字段本地化展示，不裸显 ISO 串 -->
            <dd v-else-if="field.type === 'date'" class="kawaru-text-95 text-base-content/80">
              {{ formatDate(metadata[field.key] as string | null | undefined) }}
            </dd>
            <dd v-else class="kawaru-text-95 text-base-content/80 break-words">
              {{ metadata[field.key] }}
            </dd>
          </div>
        </dl>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PropType } from 'vue'
import CollapsibleText from './CollapsibleText.vue'
import CollectionMetadataForm from './CollectionMetadataForm.vue'
import { collectionVocabLabel } from '../constants/collectionVocab'
import { formatDate } from '@/shared/utils/format'
import {
  METADATA_FIELDS,
  METADATA_GROUPS,
  hasMetadataValue,
  type MetadataFieldDef,
  type MetadataGroupId,
} from '../constants/metadataFields'
import type { CollectionMetadata, CollectionMetadataDraft } from '../types/collection'

const props = defineProps({
  metadata: { type: Object as PropType<CollectionMetadata>, required: true },
  /** 传入草稿即编辑态：正文换成 CollectionMetadataForm，本组件不做提交 */
  draft: { type: Object as PropType<CollectionMetadataDraft | null>, default: null },
})

/** 该组的全部字段（不按值过滤——空字段也要占位显示） */
function fieldsOf(group: MetadataGroupId) {
  return METADATA_FIELDS.filter((f) => f.group === group)
}

/** 计数来源：编辑态读草稿（输入时实时更新），只读态读详情元数据 */
const source = computed(() => (props.draft ?? props.metadata) as CollectionMetadata)

function hasValue(field: MetadataFieldDef): boolean {
  return hasMetadataValue(source.value, field)
}

const filledCount = computed(
  () => METADATA_FIELDS.filter((f) => hasMetadataValue(source.value, f)).length,
)

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}
</script>
