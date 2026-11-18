<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'

const props = defineProps<{
  stats: {
    total: number
    admin: number
    regularUsers: number
    instCount: number
  }
}>()

// 数据驱动 + daisyUI stats。
// 标题在此用静态 key 取译文（no-dynamic-keys 要求 key 为字面量）；
// t() 读取 locale ref，切换语言时 computed 自动重算。
const items = computed(() => [
  { title: t('common.stat.totalUsers'), value: props.stats.total, color: 'text-base-content' },
  { title: t('users.stats.admin'), value: props.stats.admin, color: 'text-info' },
  { title: t('users.stats.users'), value: props.stats.regularUsers, color: 'text-success' },
  { title: t('users.stats.institutions'), value: props.stats.instCount, color: 'text-base-content' },
])
</script>

<template>
  <!-- stat-value 自带固定字号，显式挂 kawaru-text-240 覆盖它（与 StatusBadge 同约定） -->
  <div class="stats stats-vertical w-full border border-base-200/60 shadow-sm sm:stats-horizontal">
    <div v-for="item in items" :key="item.title" class="stat place-items-center">
      <div class="stat-title kawaru-text-100">{{ item.title }}</div>
      <div class="stat-value kawaru-text-240 font-bold" :class="item.color">{{ item.value }}</div>
    </div>
  </div>
</template>
