<script setup lang="ts">
/** SXO Harness Agent 字样：SXO 用字标，后面接文字。大小跟随外层字号 */
import SxoLogo from './SxoLogo.vue'

const SUFFIX = ' Harness Agent'
</script>

<template>
  <span
    class="inline-flex items-center font-semibold tracking-tight"
    role="img"
    :aria-label="$t('common.agent.title')"
  >
    <SxoLogo class="h-[0.74em] w-auto shrink-0" />
    <span aria-hidden="true" class="ml-[0.08em]">{{ SUFFIX }}</span>
  </span>
</template>
