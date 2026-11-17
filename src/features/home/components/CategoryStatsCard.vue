<script setup lang="ts">
/** A category module owns its request, title and retry; the stack only knows its key. */
import { computed } from 'vue'
import { t } from '@/i18n'
import DistributionCard from './DistributionCard.vue'
import {
  useAnalyzerStats,
  useDatasetCategoryStats,
  useDatasetIonSourceStats,
  useOrganismStats,
} from '../composables/useHomeStats'

const props = defineProps<{ category: 'organism' | 'tissue' | 'ion-source' | 'analyzer' }>()
// Each module keeps its own gradient family: green for life, H&E purple-pink for tissue,
// amber for ionisation, the brand blue for instruments.
const categories = {
  organism: { title: () => t('common.meta.organism'), load: useOrganismStats, palette: 'green' },
  tissue: {
    title: () => t('home.stats.organismParts'),
    load: useDatasetCategoryStats,
    palette: 'berry',
  },
  'ion-source': {
    title: () => t('home.stats.ionSourceTypes'),
    load: useDatasetIonSourceStats,
    palette: 'amber',
  },
  analyzer: { title: () => t('common.meta.analyzer'), load: useAnalyzerStats, palette: 'blue' },
} as const
const state = categories[props.category].load()
const title = computed(() => categories[props.category].title())
</script>

<template>
  <DistributionCard
    :title="title"
    :palette="categories[category].palette"
    :scientific-names="category === 'organism'"
    :total="state.total.value"
    :items="state.items.value"
    :loading="state.loading.value"
    :error="state.error.value"
    :is-empty="state.isEmpty.value"
    @reload="state.reload"
  />
</template>
