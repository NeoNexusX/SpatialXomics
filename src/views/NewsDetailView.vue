<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { computedAsync } from '@vueuse/core'
import { MarkdownDocument } from '@comark/vue'
import NewsTag from '@/features/news/components/NewsTag.vue'
import { NEWS, VIRIDIS_BAR, formatNewsDate, loadNewsBody, newsColor } from '@/features/news/config/newsContent'
import { localized } from '@/shared/config/localizedText'

const route = useRoute()
const { t } = useI18n()
const index = computed(() => NEWS.findIndex((n) => n.id === route.params.id))
const item = computed(() => NEWS[index.value])
// 切换语言时换成那个语言的正文
const doc = computedAsync(() => {
  const file = item.value && localized(item.value.file)
  return file ? loadNewsBody(file) : undefined
})
// 列表里的上一篇（更新）和下一篇（更早）
const pager = computed(() =>
  [
    { item: NEWS[index.value - 1], label: t('news.newer'), class: '' },
    { item: NEWS[index.value + 1], label: t('news.older'), class: 'md:col-start-2 md:text-right' },
  ].flatMap((link) => (link.item ? [{ ...link, item: link.item }] : [])),
)

watch(() => route.params.id, () => window.scrollTo(0, 0), { immediate: true })
</script>

<template>
  <div class="min-h-screen bg-base-200">
    <div class="max-w-3xl mx-auto px-5 py-10 md:px-8 md:py-16 kawaru-text-100">
      <router-link
        to="/news"
        class="inline-flex items-center gap-1.5 kawaru-text-87 text-base-content/55 transition-colors hover:text-viridis-ink"
      >
        <SvgIcon type="back" class="w-[0.9em] h-[0.9em]" />
        {{ $t('news.title') }}
      </router-link>

      <article v-if="item" class="mt-10">
        <header>
          <div class="flex flex-wrap items-center gap-3 kawaru-text-87">
            <span class="size-[0.7em] rounded-[3px]" :style="{ background: newsColor(index) }" aria-hidden="true" />
            <time :datetime="item.date" class="tabular-nums text-base-content/60">
              {{ formatNewsDate(item, { dateStyle: 'long' }) }}
            </time>
            <NewsTag :version="item.version" class="kawaru-text-81" />
          </div>
          <h1 class="mt-4 kawaru-text-page-title leading-[1.15] font-bold text-balance text-base-content">
            {{ localized(item.title) }}
          </h1>
          <p class="mt-5 kawaru-text-112 text-pretty text-base-content/65">{{ localized(item.summary) }}</p>
        </header>

        <div class="my-10 h-[3px] rounded-full" :style="{ background: VIRIDIS_BAR }" aria-hidden="true" />

        <!-- MarkdownDocument 的 setup 是异步的，要放在 Suspense 里才会渲染 -->
        <Suspense>
          <MarkdownDocument
            v-if="doc"
            :value="doc"
            class="prose max-w-none kawaru-text-100 prose-headings:font-semibold prose-a:text-viridis-ink prose-a:underline-offset-[0.25em]"
            :style="{ '--tw-prose-bullets': 'var(--viridis-ink)' }"
          />
        </Suspense>

        <nav v-if="pager.length" class="mt-16 grid gap-6 border-t border-base-300 pt-8 md:grid-cols-2">
          <router-link
            v-for="link in pager"
            :key="link.item.id"
            :to="{ name: 'NewsDetail', params: { id: link.item.id } }"
            class="group block"
            :class="link.class"
          >
            <span class="kawaru-text-81 text-base-content/50">{{ link.label }}</span>
            <span class="mt-1 block font-semibold text-base-content transition-colors group-hover:text-viridis-ink">
              {{ localized(link.item.title) }}
            </span>
          </router-link>
        </nav>
      </article>

      <div v-else class="mt-16 text-center">
        <p class="text-base-content/60">{{ $t('news.notFound') }}</p>
        <router-link to="/news" class="btn btn-primary mt-6 kawaru-text-95">{{ $t('news.title') }}</router-link>
      </div>
    </div>
  </div>
</template>
