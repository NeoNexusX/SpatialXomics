<script setup lang="ts">
import HomeSection from './HomeSection.vue'
import DeveloperCarousel from './footer/DeveloperCarousel.vue'
import HomeFooter from './HomeFooter.vue'
</script>

<template>
  <HomeSection id="team">
    <h2 class="team-title">{{ $t('home.footer.team') }}</h2>
    <DeveloperCarousel class="w-full" />
    <template #footer><HomeFooter /></template>
  </HomeSection>
</template>

<style scoped>
.team-title {
  font-size: clamp(2.5rem, 4vw, 3.5rem);
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: -0.035em;
}
@media (min-width: 1024px) and (max-height: 900px) {
  .team-title {
    font-size: 2rem;
  }
}
</style>
