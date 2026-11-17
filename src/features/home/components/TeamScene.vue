<script setup lang="ts">
import HomeSection from './HomeSection.vue'
import DeveloperCarousel from './footer/DeveloperCarousel.vue'
import HomeFooter from './HomeFooter.vue'
</script>

<template>
  <!-- The final opaque panel owns the members, links and legal footer. -->
  <HomeSection id="team" class="team-panel">
    <h2 class="team-title">{{ $t('home.footer.team') }}</h2>
    <DeveloperCarousel class="w-full" />
    <HomeFooter />
  </HomeSection>
</template>

<style scoped>
.team-panel {
  min-height: 0;
}
.team-title {
  font-size: clamp(2.5rem, 4vw, 3.5rem);
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: -0.035em;
}
</style>
