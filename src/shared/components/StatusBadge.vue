<template>
  <!-- 根节点不写死字号，否则会盖掉调用方传进来的档位（同为工具类，只看源码顺序）。
       每个调用点必须显式传 kawaru-text-*，否则落回 daisyUI .badge 的 .875rem。 -->
  <span class="badge font-medium rounded-md border-2 px-2 py-0.5 align-middle kawaru-text-87" :class="badgeClass">
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'

// key 是后端返回的状态值（保持英文）；label 是 getter，在 computed 里按当前界面语言取
const STATUS_MAP: Record<string, { label: () => string; cls: string }> = {
  processing: { label: () => t('common.status.running'), cls: 'badge-info badge-soft bg-info/10 text-info border-info/30' },
  running: { label: () => t('common.status.running'), cls: 'badge-info badge-soft bg-info/10 text-info border-info/30' },
  completed: { label: () => t('common.status.completed'), cls: 'badge-success badge-soft bg-success/10 text-success border-success/30' },
  ok: { label: () => t('common.status.completed'), cls: 'badge-success badge-soft bg-success/10 text-success border-success/30' },
  success: { label: () => t('common.status.completed'), cls: 'badge-success badge-soft bg-success/10 text-success border-success/30' },
  failed: { label: () => t('common.status.failed'), cls: 'badge-error badge-soft bg-error/10 text-error border-error/30' },
  error: { label: () => t('common.status.failed'), cls: 'badge-error badge-soft bg-error/10 text-error border-error/30' },
  uploading: { label: () => t('common.status.processing'), cls: 'badge-info badge-soft bg-info/10 text-info border-info/30' },
  active: { label: () => t('common.status.active'), cls: 'badge-success badge-soft bg-success/10 text-success border-success/30' },
  inactive: { label: () => t('common.status.inactive'), cls: 'badge-neutral badge-soft bg-base-200 text-base-content/60 border-base-300' },
}

const props = defineProps<{ status: string }>()

const entry = computed(() => STATUS_MAP[props.status.toLowerCase()])
const label = computed(() => entry.value?.label() ?? props.status)
const badgeClass = computed(() => entry.value?.cls ?? 'badge-ghost')
</script>
