<script setup lang="ts">
/** Opaque surface shared by homepage stat modules; content and data stay in each module. */
</script>

<template>
  <article class="stat-card">
    <slot />
  </article>
</template>

<style scoped>
.stat-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  gap: 1rem;
  padding: clamp(1.25rem, 2vw, 2rem);
  border-radius: clamp(1.25rem, 2vw, 2rem);
  border: 1px solid var(--stat-line);
  background: var(--home-panel);
  box-shadow: 0 -2px 8px -4px var(--stat-contact);
}
</style>
