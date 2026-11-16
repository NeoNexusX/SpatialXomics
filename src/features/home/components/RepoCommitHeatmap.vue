<script setup lang="ts">
import { computed } from 'vue'
import { I18nT } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { CalendarHeatmap } from 'vue3-calendar-heatmap'
import 'vue3-calendar-heatmap/dist/style.css'
import { useCommitHeatmap } from '../composables/useCommitHeatmap'
import { useMediaQuery } from '@/shared/composables/useMediaQuery'
import { localized, type LocalizedText } from '@/shared/config/localizedText'
import { t } from '@/i18n'

const props = withDefaults(
  defineProps<{
    owner: string
    repo: string
    /** 统计哪个分支的提交，默认 'dev' */
    branch?: string
    days?: number
    title?: LocalizedText
    /** 点击标题跳转的仓库地址；缺省时标题不可点击 */
    repoUrl?: string
    /**
     * 热力图朝向：
     * - 'horizontal' 始终横向（GitHub 经典样式，周从左到右）
     * - 'vertical'   始终纵向（周从上到下）
     * - 'auto'（默认）大屏（≥1024px）纵向、小屏横向
     */
    orientation?: 'auto' | 'horizontal' | 'vertical'
  }>(),
  { branch: 'dev', days: 365, orientation: 'auto' },
)

// 业务逻辑（取数 / 缓存 / 限流 / 配色 / tooltip）全部在 composable 里，组件只负责展示
const {
  loading,
  error,
  values,
  total,
  activeDays,
  maxCount,
  rangeColor,
  endDate,
  tooltipFormatter,
  heatmapLocale,
  isDark,
} = useCommitHeatmap(() => ({
  owner: props.owner,
  repo: props.repo,
  branch: props.branch,
  days: props.days,
}))

const displayTitle = computed(() =>
  props.title
    ? localized(props.title)
    : t('home.heatmap.defaultTitle', { owner: props.owner, repo: props.repo }),
)

// 朝向：auto 时按屏宽切换（大屏纵向 / 小屏横向），否则用显式值
const isLargeScreen = useMediaQuery('(min-width: 1024px)')
const vertical = computed(() =>
  props.orientation === 'auto' ? isLargeScreen.value : props.orientation === 'vertical',
)
</script>

<template>
  <div
    class="heatmap-card card w-full border border-base-300 bg-base-100 shadow-sm"
    :class="{ 'heatmap-card--vertical': vertical }"
  >
    <div class="card-body gap-[1em] p-[1.4em] kawaru-text-75">
      <!-- Header：有 repoUrl 时渲染成可点击的外链 <a>，否则退化为纯 <div> -->
      <component
        :is="repoUrl ? 'a' : 'div'"
        :href="repoUrl || undefined"
        :target="repoUrl ? '_blank' : undefined"
        :rel="repoUrl ? 'noopener noreferrer' : undefined"
        class="group flex min-w-0 max-w-full items-center gap-[0.5em]"
        :class="{ 'w-fit': repoUrl }"
      >
        <Icon icon="simple-icons:github" class="h-[1.35em] w-[1.35em] text-primary shrink-0" />
        <h3
          class="truncate kawaru-text-95 font-semibold text-base-content transition-colors"
          :class="{ 'group-hover:text-primary': repoUrl }"
        >
          {{ displayTitle }}
        </h3>
        <Icon
          v-if="repoUrl"
          icon="heroicons:arrow-top-right-on-square"
          class="h-[1em] w-[1em] text-base-content/40 group-hover:text-primary shrink-0 transition-colors"
        />
      </component>

      <!-- Loading -->
      <div
        v-if="loading"
        class="flex items-center justify-center gap-[0.5em] text-base-content/40 py-[2.2em]"
      >
        <span class="loading loading-spinner h-[1.35em] w-[1.35em]" />
        <span class="kawaru-text-75">{{ $t('common.state.loading') }}</span>
      </div>

      <!-- Error -->
      <div
        v-else-if="error"
        role="alert"
        class="alert alert-error kawaru-text-75 gap-[0.5em] p-[0.9em]"
      >
        <Icon icon="heroicons:exclamation-triangle" class="h-[1.35em] w-[1.35em] shrink-0" />
        <span>{{ error }}</span>
      </div>

      <!-- Heatmap + Summary -->
      <template v-else>
        <div class="heatmap-layout" :class="{ 'heatmap-layout--vertical': vertical }">
          <div
            class="heatmap-frame no-scrollbar"
            :class="vertical ? 'heatmap-frame--vertical' : 'heatmap-frame--horizontal'"
          >
            <CalendarHeatmap
              :values="values"
              :end-date="endDate"
              :range-color="rangeColor"
              :max="maxCount"
              :vertical="vertical"
              tooltip
              :tooltip-formatter="tooltipFormatter"
              :locale="heatmapLocale"
              :dark-mode="isDark"
              :round="2"
            />
            <!-- 图例：横向保留库原生底部图例；纵向用 SVG 内置的右侧纵向图例（外置图例由下方 CSS 隐藏）。 -->
          </div>

          <footer class="heatmap-summary kawaru-text-62" :aria-label="$t('home.heatmap.summary')">
            <div class="heatmap-metrics">
              <div class="heatmap-metric kawaru-text-68">
                <span>{{ $t('home.heatmap.total') }}</span>
                <strong class="kawaru-text-75">{{ total }}</strong>
                <span>{{ $t('home.heatmap.commits') }}</span>
              </div>
              <div class="heatmap-metric kawaru-text-68">
                <span>{{ $t('home.heatmap.activeDays') }}</span>
                <strong class="kawaru-text-75">{{ activeDays }}</strong>
              </div>
              <div class="heatmap-metric kawaru-text-68">
                <!-- 天数保持加粗：数字用插槽传入，译文里的位置由语言包决定 -->
                <I18nT keypath="home.heatmap.lastDays" tag="span" scope="global">
                  <template #days><strong class="kawaru-text-75">{{ days }}</strong></template>
                </I18nT>
              </div>
              <div class="heatmap-metric kawaru-text-68">
                <span>{{ $t('home.heatmap.branch') }}</span>
                <span class="badge badge-primary h-[1.7em] px-[0.7em] font-mono kawaru-text-81">
                  {{ branch }}
                </span>
              </div>
            </div>
          </footer>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.heatmap-card {
  container-type: inline-size;
}

.heatmap-card--vertical {
  height: 100%;
  max-width: min(100%, 22rem);
}

.heatmap-card--vertical > .card-body {
  min-height: 0;
}

.heatmap-layout {
  display: flex;
  flex-direction: column;
  gap: 0.8em;
  min-width: 0;
}

.heatmap-layout--vertical {
  min-height: 0;
  flex: 1 1 auto;
}

.heatmap-frame {
  width: 100%;
  min-width: 0;
}

/* 纵向模式：隐藏库的外置底部图例（SVG 内已有右侧纵向图例，避免重复）。 */
.heatmap-frame--vertical :deep(.vch__container > .vch__legend) {
  display: none;
}

/* 横向模式：复用库原生底部图例，缩小字号并贴合卡片配色。 */
.heatmap-frame--horizontal :deep(.vch__container > .vch__legend) {
  margin-top: 0.4em;
  color: color-mix(in oklch, var(--color-base-content) 58%, transparent);
  /* 图例是库渲染的节点，挂不上档位类；字号直接按 50 档取值 */
  font-size: calc(var(--kawaru-fs) * 0.5);
}

/* 网格在小屏会横向溢出滚动；把图例钉在滚动视口右侧，避免要滚到最右才看得到。 */
.heatmap-frame--horizontal :deep(.vch__legend .vch__legend-right) {
  position: sticky;
  right: 0;
}

.heatmap-frame--horizontal {
  overflow-x: auto;
  padding-bottom: 0.25em;
}

.heatmap-frame--horizontal :deep(.vch__container) {
  min-width: 42rem;
}

.heatmap-frame--horizontal :deep(svg.vch__wrapper) {
  width: 100%;
  height: auto;
}

.heatmap-frame--vertical {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  align-items: flex-start;
  justify-content: center;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.heatmap-frame--vertical :deep(.vch__container) {
  display: block;
  width: 90%;
}

.heatmap-frame--vertical :deep(svg.vch__wrapper) {
  width: 100%;
  height: auto;
  overflow: visible;
}

/* summary / metric / strong 三级字号各自独立取档，改一处不影响另两处。 */
.heatmap-summary {
  border-top: 1px solid var(--color-base-300);
  padding-top: 1em;
  color: color-mix(in oklch, var(--color-base-content) 62%, transparent);
  /* 模板上挂 62 档；行高沿用原从 card-body 75 档继承的 1.45 */
  line-height: 1.45;
}

.heatmap-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65em 1em;
}

.heatmap-metric {
  display: flex;
  align-items: baseline;
  gap: 0.4em;
  white-space: normal;
}

.heatmap-metric:nth-child(even) {
  justify-self: end;
  text-align: right;
}

.heatmap-metric strong {
  color: var(--color-base-content);
  font-weight: 650;
}

@container (min-width: 46rem) {
  .heatmap-card:not(.heatmap-card--vertical) .heatmap-metrics {
    grid-template-columns: repeat(4, max-content);
    justify-content: space-between;
  }
}
</style>
