<script setup lang="ts">
import StatCard from './StatCard.vue'
import RepoCommitHeatmap from './RepoCommitHeatmap.vue'
import type { GithubHeatmapConfig } from '../config/contentConfig'

defineProps<{ config: GithubHeatmapConfig }>()
</script>

<template>
  <StatCard id="activity" class="activity-card">
    <RepoCommitHeatmap
      :owner="config.owner"
      :repo="config.repo"
      :branch="config.branch"
      :days="config.days"
      :title="$t('home.activity.title')"
      :repo-url="config.repoUrl"
    />
  </StatCard>
</template>

<style scoped>
.activity-card {
  padding: clamp(1rem, 1.6vw, 1.5rem);
}
@media (min-width: 1024px) and (max-height: 780px) {
  .activity-card {
    padding: 0.75rem;
  }
}
</style>
