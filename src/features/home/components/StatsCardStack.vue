<script setup lang="ts">
import CategoryStatsCard from './CategoryStatsCard.vue'
import ScrollCardStack from './ScrollCardStack.vue'

// Add any card component here. Each module owns its data; the stack owns only geometry.
// Keep keys stable when adding or reordering modules.
const cards = [
  { key: 'organism', component: CategoryStatsCard, props: { category: 'organism' } },
  { key: 'tissue', component: CategoryStatsCard, props: { category: 'tissue' } },
  { key: 'ion-source', component: CategoryStatsCard, props: { category: 'ion-source' } },
  { key: 'analyzer', component: CategoryStatsCard, props: { category: 'analyzer' } },
] as const
</script>

<template>
  <ScrollCardStack :items="cards" :aria-label="$t('home.stats.distribution')">
    <template #default="{ item }">
      <component :is="item.component" v-bind="item.props" />
    </template>
  </ScrollCardStack>
</template>
