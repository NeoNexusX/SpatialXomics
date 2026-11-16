<script setup lang="ts">
// 版本更新显示版本号（青），公告显示「公告」（黄），两种颜色都取自 viridis 色标
defineProps<{ version?: string }>()
</script>

<template>
  <span
    class="rounded-full px-[0.65em] leading-[1.75] font-semibold"
    :class="version ? 'tabular-nums bg-viridis-ink/15 text-viridis-ink' : 'bg-[#fde725] text-[#3b3500]'"
  >
    {{ version ? `v${version}` : $t('news.notice') }}
  </span>
</template>
