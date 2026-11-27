<template>
  <ConfirmDialog
    :open="changes.length > 0"
    :title="$t('collections.summarySync.title')"
    :confirm-label="$t('collections.summarySync.confirm')"
    :loading="updating"
    @confirm="emit('confirm')"
    @cancel="emit('cancel')"
  >
    <span class="block">{{ $t('collections.summarySync.message') }}</span>
    <!-- ConfirmDialog 把这段插槽放在 <p> 里，所以列表用 span + flex 搭，不用 ul / li -->
    <span v-if="changes.length" class="flex flex-col gap-3 mt-4">
      <span v-for="change in changes" :key="change.key" class="flex flex-col gap-1">
        <span class="font-semibold text-base-content">{{ labelOf(change.key) }}</span>
        <span class="flex flex-wrap items-center gap-1.5">
          <template v-if="change.before.length">
            <span
              v-for="value in change.before"
              :key="value"
              :class="[
                CHIP,
                'bg-base-200/80 text-base-content/55 border-base-300 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600',
              ]"
            >
              {{ collectionVocabLabel(value) }}
            </span>
          </template>
          <span v-else class="kawaru-text-87 text-base-content/45">
            {{ $t('collections.summarySync.empty') }}
          </span>
          <span aria-hidden="true" class="text-base-content/40">→</span>
          <template v-if="change.after.length">
            <span
              v-for="value in change.after"
              :key="value"
              :class="[
                CHIP,
                isNew(change, value)
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'bg-base-200/80 text-base-content/70 border-base-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600',
              ]"
            >
              {{ collectionVocabLabel(value) }}
            </span>
          </template>
          <span v-else class="kawaru-text-87 text-base-content/45">
            {{ $t('collections.summarySync.empty') }}
          </span>
        </span>
      </span>
    </span>
  </ConfirmDialog>
</template>

<script setup lang="ts">
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import { collectionVocabLabel } from '../constants/collectionVocab'
import { METADATA_FIELDS } from '../constants/metadataFields'
import type { DerivedMetadataChange } from '../utils/deriveCollectionMetadata'

/** 标签的固定样式；配色由使用处按「原有 / 新增」叠加 */
const CHIP = 'inline-flex items-center rounded-full px-2.5 py-0.5 kawaru-text-81 font-medium border'

/**
 * 增删成员后的「样本 / 采集字段」更新确认：逐项列出这次成员变化影响到的字段，
 * 以及它的当前值 → 建议值。确认后由 useCollectionMembers 提交，取消则保持原值。
 * changes 为空时不显示。
 */
defineProps<{
  changes: DerivedMetadataChange[]
  /** 提交中：按钮禁用并显示 loading */
  updating: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

/** 字段显示名：取字段定义表里的，随界面语言变化 */
function labelOf(key: DerivedMetadataChange['key']): string {
  return METADATA_FIELDS.find((field) => field.key === key)?.label() ?? key
}

/** 这次变化新带来的取值（当前值里没有的），在建议值里高亮 */
function isNew(change: DerivedMetadataChange, value: string): boolean {
  return !change.before.includes(value)
}
</script>
