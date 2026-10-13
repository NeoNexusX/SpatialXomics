<script setup lang="ts">
/**
 * 左侧注释面板。
 *
 * 点「开始注释」后，用数据集平均谱上的峰（去掉强度为 0 和强度最低的 n%）按采集条件
 * 选出的加合物与注释库匹配、打分、估计 FDR，后台默认对全部匹配项补空间评分。注释库由
 * 用户选择本地 CSV 提供，网站不提供数据库。一行 = 一个加合离子；同一分子的
 * 其他加合离子在行内和详情卡里关联、可跳转。
 *
 * 布局：桌面端是可收起的侧栏（细条 ↔ 展开）；小屏参与页面纵向流。
 */
import { computed, provide, ref, toRef } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import SearchInput from '@/shared/components/SearchInput.vue'
import AnnotationConditions from '@/features/vizworkbench/components/annotation/AnnotationConditions.vue'
import AdductMultiSelect from '@/features/vizworkbench/components/annotation/AdductMultiSelect.vue'
import AnnotationTable from '@/features/vizworkbench/components/annotation/AnnotationTable.vue'
import {
  ANNOTATION_KEY,
  useAnnotation,
  type AnnotationSortKey,
  type QLevel,
} from '@/features/vizworkbench/composables/useAnnotation'
import { moleculeName } from '@/features/vizworkbench/utils/annotation/format'
import type { Acquisition } from '@/features/vizworkbench/types/acquisition'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'

const props = defineProps<{
  expanded: boolean
  runId: string
  acquisition: Acquisition
  /** 结果页的 m/z 选择入口（离子图 + 谱图联动） */
  selectMzIndex: (idx: number) => void | Promise<void>
  /** 当前选中的 m/z 轴下标 */
  selectedMzIndex: number
}>()

const emit = defineEmits<{ (e: 'update:expanded', value: boolean): void }>()

const ann = useAnnotation({
  runId: toRef(props, 'runId'),
  acquisition: toRef(props, 'acquisition'),
  selectedMzIndex: toRef(props, 'selectedMzIndex'),
  selectMzIndex: (idx) => props.selectMzIndex(idx),
})
provide(ANNOTATION_KEY, ann)

const {
  available,
  meanState,
  importDbFile,
  importingDb,
  dbState,
  ensureDb,
  started,
  blockedReason,
  runState,
  runError,
  summary,
  ions,
  qLevel,
  adductFilter,
  adductOptions,
  siblingsOnly,
  moleculeFilter,
  molecules,
  search,
  sortKey,
  sortReverse,
  pendingResort,
  resortNow,
  exportCsv,
} = ann

/** q 档位，每档带行数（运行摘要给出），替代单独的摘要行 */
const qLevels = computed(() => {
  const s = summary.value
  return [
    { value: 0.05 as QLevel, label: '≤5%', count: s?.qCounts.q05 },
    { value: 0.1 as QLevel, label: '≤10%', count: s?.qCounts.q10 },
    { value: 0.2 as QLevel, label: '≤20%', count: s?.qCounts.q20 },
    { value: 'all' as QLevel, label: t('vizworkbench.annotation.qAll'), count: s?.ions },
  ]
})

const SORT_OPTIONS: { value: AnnotationSortKey; label: () => string }[] = [
  { value: 'total', label: () => t('vizworkbench.annotation.sort.total') },
  { value: 'q', label: () => t('vizworkbench.annotation.sort.q') },
  { value: 'spatial', label: () => t('vizworkbench.annotation.sort.spatial') },
  { value: 'error', label: () => t('vizworkbench.annotation.sort.error') },
  { value: 'mz', label: () => t('vizworkbench.annotation.sort.mz') },
  { value: 'intensity', label: () => t('vizworkbench.annotation.sort.intensity') },
]
const selectedSortLabel = computed(
  () => SORT_OPTIONS.find((option) => option.value === sortKey.value)?.label() ?? '',
)

const spatialProgress = computed(() => summary.value?.spatial ?? { total: 0, done: 0 })
const spatialRunning = computed(
  () => spatialProgress.value.total > 0 && spatialProgress.value.done < spatialProgress.value.total,
)

// 加合物、同分子离子、排序默认收起在「筛选」里；改过的项数显示在按钮上
const showFilters = ref(false)
const activeFilterCount = computed(
  () =>
    Number(adductFilter.value.length > 0) +
    Number(siblingsOnly.value) +
    Number(sortKey.value !== 'total' || sortReverse.value),
)
const filterAdductOptions = computed(() => adductOptions.value.map((id) => ({ id })))

const moleculeFilterLabel = computed(() =>
  moleculeName(
    moleculeFilter.value != null ? molecules.value.get(moleculeFilter.value) : undefined,
  ),
)

// ---- 导入数据库 CSV（条件卡里的按钮 + 拖进面板） ----
const fileInput = ref<HTMLInputElement | null>(null)
const { showToast } = useToast()

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await importDbFile(file)
  input.value = ''
}

// dragenter/dragleave 每进出一个子元素各触发一次，按深度计数，避免遮罩闪烁
const dragActive = ref(false)
let dragDepth = 0

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

function onDragEnter(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth++
  dragActive.value = true
}

function onDragOver(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(e: DragEvent) {
  if (!hasFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragActive.value = false
}

async function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  dragActive.value = false
  const file = Array.from(e.dataTransfer?.files ?? []).find(
    (f) => f.name.toLowerCase().endsWith('.csv') || f.type === 'text/csv',
  )
  if (file) await importDbFile(file)
  else showToast(t('vizworkbench.annotation.dropCsvOnly'), 'error')
}
</script>

<template>
  <aside
    :class="[
      'static flex w-full flex-col overflow-hidden rounded-xl border-2 border-base-content/30 bg-base-100 shadow-sm lg:h-full lg:max-w-none lg:shrink-0 lg:transition-[width] lg:duration-200 lg:ease-out',
      expanded ? 'lg:w-full' : 'lg:w-11 lg:min-w-11',
    ]"
  >
    <!-- 小屏收起：留在页面流里的一条按钮 -->
    <button
      v-show="!expanded"
      class="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-base-200/60 lg:hidden"
      :title="$t('vizworkbench.annotation.expand')"
      @click="emit('update:expanded', true)"
    >
      <span class="kawaru-text-68 font-semibold">{{ $t('vizworkbench.annotation.title') }}</span>
      <SvgIcon type="chevron_down" />
    </button>

    <!-- 桌面收起：细条 -->
    <div
      v-show="!expanded"
      class="hidden h-full w-full cursor-pointer flex-col items-center justify-center gap-2 py-3 hover:bg-base-200/60 lg:flex"
      :title="$t('vizworkbench.annotation.expand')"
      @click="emit('update:expanded', true)"
    >
      <SvgIcon type="chevron_right" />
      <span class="[writing-mode:vertical-rl] kawaru-text-62 font-medium tracking-wide">
        {{ $t('vizworkbench.annotation.title') }}
      </span>
    </div>

    <div
      v-show="expanded"
      class="relative flex h-auto min-h-0 min-w-0 flex-col gap-3 p-4 kawaru-text-62 lg:h-full"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- 标题栏 -->
      <div class="flex shrink-0 items-center justify-between gap-2">
        <h3 class="kawaru-text-62 font-semibold leading-tight text-base-content">
          {{ $t('vizworkbench.annotation.title') }}
        </h3>
        <div class="flex shrink-0 items-center gap-1">
          <button
            v-if="ions.length"
            class="btn btn-ghost btn-xs btn-square"
            :title="$t('vizworkbench.annotation.exportHint')"
            @click="exportCsv"
          >
            <SvgIcon type="download" />
          </button>
          <button
            class="btn btn-ghost btn-xs btn-square"
            :title="$t('vizworkbench.annotation.collapse')"
            @click="emit('update:expanded', false)"
          >
            <SvgIcon type="chevron_right" class="rotate-180" />
          </button>
        </div>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept=".csv,text/csv"
        class="hidden"
        @change="onFileChange"
      />

      <div v-if="!available" class="flex items-start gap-1.5 kawaru-text-56 text-warning">
        <SvgIcon type="warning" class="mt-0.5 shrink-0" />
        <span>{{ $t('vizworkbench.annotation.centroidOnly') }}</span>
      </div>

      <template v-else>
        <AnnotationConditions class="shrink-0" @import="fileInput?.click()" />

        <!-- 还没开始 -->
        <div
          v-if="!started"
          class="flex min-h-40 flex-1 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-base-content/20 px-4 text-center"
        >
          <p class="kawaru-text-62 text-base-content/70">
            {{ $t('vizworkbench.annotation.startHint') }}
          </p>
          <button
            v-if="dbState !== 'ready'"
            class="btn btn-primary btn-sm kawaru-text-62"
            :disabled="importingDb"
            @click="fileInput?.click()"
          >
            {{ $t('vizworkbench.annotation.importDb') }}
          </button>
        </div>

        <!-- 平均谱、注释库没就绪，或条件不全 -->
        <div
          v-else-if="meanState !== 'ready' || dbState !== 'ready' || blockedReason"
          class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center kawaru-text-62 text-base-content/60"
        >
          <template v-if="meanState === 'loading'">
            <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
            {{ $t('vizworkbench.annotation.meanLoading') }}
          </template>
          <template v-else-if="meanState === 'missing'">
            <SvgIcon type="warning" class="h-6 w-6 text-warning" />
            {{ $t('vizworkbench.annotation.meanMissing') }}
          </template>
          <template v-else-if="dbState === 'loading'">
            <span class="loading loading-spinner loading-md text-primary" aria-hidden="true"></span>
            {{ $t('vizworkbench.annotation.dbLoading') }}
          </template>
          <template v-else-if="dbState !== 'ready'">
            <SvgIcon type="warning" class="h-6 w-6 text-warning" />
            {{
              dbState === 'error'
                ? $t('vizworkbench.annotation.dbError')
                : $t('vizworkbench.annotation.dbMissing')
            }}
            <div class="flex gap-2">
              <button
                v-if="dbState === 'error'"
                class="btn btn-outline btn-xs kawaru-text-62"
                @click="ensureDb"
              >
                {{ $t('vizworkbench.annotation.retry') }}
              </button>
              <button class="btn btn-primary btn-xs kawaru-text-62" @click="fileInput?.click()">
                {{ $t('vizworkbench.annotation.importDb') }}
              </button>
            </div>
          </template>
          <template v-else>
            <SvgIcon type="info" class="h-6 w-6 text-base-content/40" />
            {{
              blockedReason === 'polarity'
                ? $t('vizworkbench.annotation.needPolarity')
                : $t('vizworkbench.annotation.needAdducts')
            }}
          </template>
        </div>

        <!-- 结果 -->
        <template v-else>
          <div class="min-w-0 shrink-0 space-y-3">
            <!-- 运行状态；完成后是 q 档位（每档的行数） -->
            <div
              v-if="runState === 'running'"
              class="flex items-center gap-1.5 kawaru-text-56 text-base-content/60"
            >
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
              {{ $t('vizworkbench.annotation.running') }}
            </div>
            <div
              v-else-if="runState === 'error'"
              class="kawaru-text-56 text-error"
              :title="runError ?? ''"
            >
              {{ $t('vizworkbench.annotation.runFailed') }}
            </div>
            <div v-else-if="summary" class="flex flex-wrap items-center gap-2">
              <span
                class="kawaru-text-56 text-base-content/50"
                :title="$t('vizworkbench.annotation.qLevelHint')"
              >
                {{ $t('vizworkbench.annotation.qLevelLabel') }}
              </span>
              <button
                v-for="lv in qLevels"
                :key="String(lv.value)"
                class="badge h-auto cursor-pointer gap-1 py-0.5 kawaru-text-56 transition-colors"
                :class="qLevel === lv.value ? 'badge-primary' : 'badge-ghost'"
                @click="qLevel = lv.value"
              >
                {{ lv.label }}
                <span class="font-mono opacity-60">{{ lv.count }}</span>
              </button>
            </div>
            <!-- 空间评分进度：细条，详情在悬停提示里 -->
            <progress
              v-if="spatialRunning"
              class="progress progress-primary block h-1 w-full"
              :value="spatialProgress.done"
              :max="spatialProgress.total"
              :title="
                $t('vizworkbench.annotation.spatialProgress', {
                  done: spatialProgress.done,
                  total: spatialProgress.total,
                }) +
                '\n' +
                $t('vizworkbench.annotation.spatialProgressHint')
              "
            ></progress>

            <!-- 搜索 + 筛选开关 -->
            <div class="flex items-center gap-2">
              <SearchInput
                v-model="search"
                class="annotation-search min-w-0 flex-1"
                size="sm"
                :fluid="false"
                :placeholder="$t('vizworkbench.annotation.searchPlaceholder')"
              />
              <button
                class="btn btn-sm shrink-0 gap-1 px-2 kawaru-text-62"
                :class="showFilters ? 'btn-active' : 'btn-ghost'"
                :aria-expanded="showFilters"
                @click="showFilters = !showFilters"
              >
                {{ $t('vizworkbench.annotation.filters') }}
                <span v-if="activeFilterCount" class="badge badge-primary badge-xs kawaru-text-56">
                  {{ activeFilterCount }}
                </span>
                <SvgIcon v-else :type="showFilters ? 'chevron_up' : 'chevron_down'" />
              </button>
            </div>

            <!-- 筛选与排序（默认收起） -->
            <div v-if="showFilters" class="space-y-3 rounded-lg bg-base-200/60 p-3 kawaru-text-62">
              <AdductMultiSelect
                v-model="adductFilter"
                :options="filterAdductOptions"
                :label="$t('vizworkbench.annotation.adducts')"
                :empty-label="$t('vizworkbench.annotation.allAdducts')"
                :clear-label="$t('vizworkbench.annotation.allAdducts')"
              />
              <div class="flex min-w-0 flex-wrap items-center gap-3">
                <label class="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap">
                  <input v-model="siblingsOnly" type="checkbox" class="checkbox checkbox-xs" />
                  {{ $t('vizworkbench.annotation.siblingsOnly') }}
                </label>
                <div class="annotation-sort-controls flex items-center gap-2">
                  <span class="shrink-0 whitespace-nowrap">{{
                    $t('vizworkbench.annotation.sortBy')
                  }}</span>
                  <label
                    class="annotation-sort select select-bordered select-sm min-w-0 flex-1 pr-8 kawaru-text-62"
                    :title="selectedSortLabel"
                  >
                    <span class="min-w-0 flex-1 truncate" aria-hidden="true">{{
                      selectedSortLabel
                    }}</span>
                    <select
                      v-model="sortKey"
                      class="annotation-sort-native kawaru-text-62"
                      :aria-label="$t('vizworkbench.annotation.sortBy')"
                    >
                      <option v-for="opt in SORT_OPTIONS" :key="opt.value" :value="opt.value">
                        {{ opt.label() }}
                      </option>
                    </select>
                  </label>
                  <button
                    class="btn btn-outline btn-sm btn-square shrink-0"
                    :title="$t('vizworkbench.annotation.reverseSort')"
                    @click="sortReverse = !sortReverse"
                  >
                    <SvgIcon :type="sortReverse ? 'chevron_up' : 'chevron_down'" />
                  </button>
                </div>
              </div>
            </div>

            <!-- 只看某个分子 -->
            <div v-if="moleculeFilter != null" class="flex items-center gap-1 kawaru-text-56">
              <span class="text-base-content/50">{{
                $t('vizworkbench.annotation.moleculeFilter')
              }}</span>
              <button
                class="badge badge-primary badge-sm gap-1 kawaru-text-56"
                @click="moleculeFilter = null"
              >
                {{ moleculeFilterLabel }}
                <SvgIcon type="close" class="h-3 w-3" />
              </button>
            </div>

            <!-- 空间分已更新、排名未刷新 -->
            <button
              v-if="pendingResort > 0 && sortKey === 'total'"
              class="btn btn-xs btn-ghost w-full kawaru-text-56 text-primary"
              @click="resortNow"
            >
              <SvgIcon type="refresh" class="h-3 w-3" />
              {{ $t('vizworkbench.annotation.resortNow', { count: pendingResort }) }}
            </button>
          </div>

          <AnnotationTable v-if="ions.length" />
          <p
            v-else-if="runState === 'done'"
            class="p-4 text-center kawaru-text-56 text-base-content/50"
          >
            {{ $t('vizworkbench.annotation.noMatches') }}
          </p>
        </template>
      </template>

      <!-- 拖放遮罩 -->
      <div
        v-if="dragActive"
        class="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-primary/15"
      >
        <SvgIcon type="upload" class="h-8 w-8 text-primary" />
        <p class="kawaru-text-62 font-medium text-primary">
          {{ $t('vizworkbench.annotation.dropHint') }}
        </p>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 空间不足时整组排序换到下一行，组内控件保持单行。 */
.annotation-sort-controls {
  flex: 1 1 14rem;
  min-width: min(100%, 14rem);
}

/* 原生 select 负责交互，可见文字独立截断，避免绘制到箭头下面。 */
.annotation-sort-native {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border-style: none;
  opacity: 0;
  cursor: pointer;
}
</style>
