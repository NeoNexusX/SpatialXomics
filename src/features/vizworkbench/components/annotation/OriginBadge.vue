<script setup lang="ts">
/**
 * 化合物来源标签：内源 / 预期 / 未定 / 外源（来自注释库的 Origin 列）。没有标签时不显示。
 * molecule：标在分子上（= 第一个候选的等级）；候选按等级排过，分子是外源说明全部候选都是外源。
 */
import { computed } from 'vue'
import type { CandidateOrigin } from '@/features/vizworkbench/types/annotation'
import { t } from '@/i18n'

const props = defineProps<{
  origin: CandidateOrigin | undefined
  molecule?: boolean
  /** 不显示「未定」（表格里减少干扰） */
  hideUnknown?: boolean
}>()

const STYLE: Record<CandidateOrigin, { cls: string; label: () => string; hint: () => string }> = {
  endogenous: {
    cls: 'badge-success badge-soft',
    label: () => t('vizworkbench.annotation.origin.endogenous'),
    hint: () => t('vizworkbench.annotation.originHint.endogenous'),
  },
  expected: {
    cls: 'badge-success badge-outline',
    label: () => t('vizworkbench.annotation.origin.expected'),
    hint: () => t('vizworkbench.annotation.originHint.expected'),
  },
  unknown: {
    cls: 'badge-ghost text-base-content/60',
    label: () => t('vizworkbench.annotation.origin.unknown'),
    hint: () => t('vizworkbench.annotation.originHint.unknown'),
  },
  exogenous: {
    cls: 'badge-warning badge-soft',
    label: () => t('vizworkbench.annotation.origin.exogenous'),
    hint: () => t('vizworkbench.annotation.originHint.exogenous'),
  },
}

const style = computed(() =>
  props.origin && !(props.hideUnknown && props.origin === 'unknown') ? STYLE[props.origin] : null,
)
const title = computed(() =>
  props.molecule && props.origin === 'exogenous'
    ? t('vizworkbench.annotation.originHint.allExogenous')
    : (style.value?.hint() ?? ''),
)
</script>

<template>
  <span
    v-if="style"
    class="badge badge-xs shrink-0 cursor-help whitespace-nowrap kawaru-text-56"
    :class="style.cls"
    :title="title"
  >
    {{ style.label() }}
  </span>
</template>
