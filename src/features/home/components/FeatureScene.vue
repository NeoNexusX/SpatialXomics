<script setup lang="ts">
import { computed, ref } from 'vue'
import BaseScene from './BaseScene.vue'
import FeatureGallery from './FeatureGallery.vue'
import VersionTimeline from './VersionTimeline.vue'
import { getContent } from '@/features/home/config/contentConfig'
import type { LocalizedText } from '@/shared/config/localizedText'

const { features, hero, timeline } = getContent()

/** 画廊项 = 配置项，但 image 已合并好回退、必为 string */
type FeatureCard = { word: LocalizedText; title?: LocalizedText; desc?: LocalizedText; image: string }

/** 合并图片回退：每项自带 image 优先，留空则取 hero.gallery 同序号图 */
const items = computed<FeatureCard[]>(() =>
  features.items.map((it, i) => ({
    ...it,
    image: it.image || hero.gallery?.[i] || '',
  })),
)

/** 联动状态 */
const activeIndex = ref(0)
</script>

<template>
  <BaseScene id="features" class="bg-base-200">
    <div
      v-if="items.length"
      v-reveal
      class="flex w-full flex-col gap-3 md:flex-row md:gap-10 md:items-center"
    >
      <!-- 左侧：画廊（小屏堆叠在时间线上方） -->
      <div class="min-w-0 flex-2 pt-5">
        <FeatureGallery :items="items" v-model:active="activeIndex" />
      </div>
      <!-- 右侧：版本时间线 -->
      <div v-if="timeline?.length" class="flex-3 pt-5">
        <VersionTimeline :items="timeline" />
      </div>
    </div>
  </BaseScene>
</template>
