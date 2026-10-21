<script setup lang="ts">
/**
 * 注释条件卡：数据集采集条件、注释库（被匹配的对象，可导入自己的库）、峰（平均轴上
 * 参与匹配的点，滑动条去掉强度最低的 n%）、容差、空间计算比例、评分权重、加合物开关。
 * 第一次出结果后自动收起成一行摘要。
 */
import { computed, inject, ref, watch } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import AdductMultiSelect, { type AdductOption } from './AdductMultiSelect.vue'
import { ANNOTATION_KEY } from '@/features/vizworkbench/composables/useAnnotation'
import { DATABASE_SOURCES } from '@/features/databases/sources'
import { adductDisplay, fmtScoreRatio } from '@/features/vizworkbench/utils/annotation/format'
import { keptCount, MAX_CUT_PCT } from '@/features/vizworkbench/utils/annotation/peaks'
import {
  DEFAULT_SCORE_RATIO,
  MAX_SCORE_RATIO,
  MIN_SCORE_RATIO,
} from '@/features/vizworkbench/utils/annotation/score'
import {
  adductReasonText,
  adductRequirementText,
} from '@/features/vizworkbench/utils/annotation/adductRuleText'
import type {
  AdductId,
  ResolvedAdduct,
  ScoreWeights,
} from '@/features/vizworkbench/types/annotation'
import { t } from '@/i18n'

const emit = defineEmits<{ (e: 'import'): void }>()

const ann = inject(ANNOTATION_KEY)!
const {
  acquisition,
  context,
  metadataPolarityMissing,
  polarityOverride,
  tolerance,
  tolValue,
  tolUnit,
  spatialPct,
  setSpatialPct,
  scoreRatio,
  scoreRatioValid,
  hasCustomScoreRatio,
  setScoreRatio,
  resetScoreRatio,
  adducts,
  enabledAdducts,
  hasAdductOverrides,
  setAdductEnabled,
  resetAdducts,
  dbState,
  db,
  importingDb,
  importingKind,
  platformFetch,
  importPlatformDb,
  clearDb,
  cutPct,
  peakStats,
  meanState,
  runState,
  canStart,
  start,
} = ann

const open = ref(true)
// 第一次出结果后收起，把空间让给表格
const unwatchFirstRun = watch(runState, (s) => {
  if (s !== 'done') return
  open.value = false
  unwatchFirstRun()
})

const polarityLabel = computed(() =>
  context.value.polarity === 'positive'
    ? t('vizworkbench.annotation.positive')
    : context.value.polarity === 'negative'
      ? t('vizworkbench.annotation.negative')
      : '',
)

/** 'DHB (2,5-Dihydroxybenzoic acid)' → 'DHB'；'NEDC(N-(1-naphthyl)…)' → 'NEDC' */
function shortName(s: string): string {
  return s.match(/^([^(]+?)\s*\(/)?.[1]?.trim() || s
}

const datasetParts = computed(() =>
  [
    polarityLabel.value,
    acquisition.value.ionSource,
    acquisition.value.maldiMatrix ? shortName(acquisition.value.maldiMatrix) : '',
    acquisition.value.analyzer,
  ].filter(Boolean),
)

const datasetLine = computed(() =>
  [
    ...datasetParts.value,
    acquisition.value.solvent
      ? `${t('vizworkbench.annotation.solvent')} ${acquisition.value.solvent}`
      : '',
  ]
    .filter(Boolean)
    .join(' · '),
)

const dbLabel = computed(() => db.value?.label ?? '')

// ---- 平台库导入（/database 页注册了 csvImport 的库，当前只有 HMDB） ----

/** 可导入的平台库：来源即数据库页的 tab 注册表，新库注册后这里自动出现 */
const platformDbs = DATABASE_SOURCES.filter((s) => s.csvImport)

/** 下载百分比；拉取未开始 / 结束后为 null，按钮文字随它切换（封顶 99，解析阶段还没结束） */
const platformPct = computed(() => {
  const p = platformFetch.value
  return p && p.total > 0 ? Math.min(99, Math.round((p.loaded / p.total) * 100)) : null
})

function pickPlatformDb(id: string): void {
  const source = platformDbs.find((s) => s.id === id)
  // daisyUI 的 focus 下拉不随菜单项点击收起，选完手动失焦关掉。
  // label 在点击时按当前语言取，作为导入后的库名；id 用于按库记住已保存的文件句柄
  ;(document.activeElement as HTMLElement | null)?.blur()
  if (source?.csvImport) void importPlatformDb(source.csvImport, source.label(), source.id)
}

// 滑动条拖动时只更新预览，松手才更新条件，等待用户点击开始。
const cutDraft = ref(cutPct.value)
watch(cutPct, (v) => (cutDraft.value = v))
const keptDraft = computed(() => keptCount(peakStats.value.nonZero, cutDraft.value))
const cutLabel = computed(() =>
  cutDraft.value === 0
    ? t('vizworkbench.annotation.intensityCutNone')
    : t('vizworkbench.annotation.intensityCut', { pct: cutDraft.value }),
)

const selectedAdducts = computed({
  get: () => enabledAdducts.value.map((a) => a.def.id),
  set: (ids: AdductId[]) => {
    const selected = new Set(ids)
    for (const adduct of adducts.value) {
      if (adduct.enabled !== selected.has(adduct.def.id)) {
        setAdductEnabled(adduct.def.id, selected.has(adduct.def.id))
      }
    }
  },
})
const adductOptions = computed<AdductOption[]>(() =>
  adducts.value.map((a) => ({
    id: a.def.id,
    tone: a.enabled ? (a.origin === 'user' ? 'secondary' : 'primary') : 'muted',
    fit: a.fit,
    title: a.enabled
      ? reasonText(a)
      : a.fit > 0
        ? `${shiftText(a)}\n${t('vizworkbench.annotation.adductTurnedOff')}`
        : requiresText(a),
  })),
)

const toleranceHint = computed(() => {
  const tol = tolerance.value
  if (tol.origin === 'user') return ''
  return tol.origin === 'analyzer'
    ? t('vizworkbench.annotation.toleranceDefault', {
        value: tol.value,
        analyzer: acquisition.value.analyzer,
      })
    : t('vizworkbench.annotation.toleranceFallback', { value: tol.value })
})

/** 折叠时的一行摘要 */
const summaryLine = computed(() =>
  [
    ...datasetParts.value,
    dbLabel.value,
    meanState.value === 'ready'
      ? t('vizworkbench.annotation.peaksShort', { count: peakStats.value.kept })
      : '',
    `${tolerance.value.value} ${tolerance.value.unit}`,
    hasCustomScoreRatio.value
      ? t('vizworkbench.annotation.scoreWeightsSummary', {
          ratio: fmtScoreRatio(scoreRatio.value),
        })
      : '',
    enabledAdducts.value.map((a) => adductDisplay(a.def.id)).join(' '),
  ]
    .filter(Boolean)
    .join(' · '),
)

function reasonText(a: ResolvedAdduct): string {
  return `${shiftText(a)}\n${adductReasonText(a)}`
}

function shiftText(a: ResolvedAdduct): string {
  return t('vizworkbench.annotation.adductShift', {
    shift: `${a.def.shift >= 0 ? '+' : ''}${a.def.shift.toFixed(6)}`,
  })
}

function requiresText(a: ResolvedAdduct): string {
  return `${shiftText(a)}\n${adductRequirementText(a)}`
}

function onTolInput(e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value)
  tolValue.value = Number.isFinite(v) && v > 0 ? v : null
}

function onSpatialPctInput(e: Event): void {
  const input = e.target as HTMLInputElement
  if (input.value === '') setSpatialPct(null)
  else if (input.validity.valid) setSpatialPct(input.valueAsNumber)
  input.value = String(spatialPct.value)
}

/** 评分权重的三个输入框，顺序即比例顺序；名称只放在悬停提示和无障碍标签里 */
const weightParts = computed(() =>
  (
    [
      { key: 'mass', part: t('vizworkbench.annotation.massScore') },
      { key: 'adduct', part: t('vizworkbench.annotation.adductFit') },
      { key: 'spatial', part: t('vizworkbench.annotation.spatialScore') },
    ] as const
  ).map(({ key, part }) => ({
    key,
    inputLabel: t('vizworkbench.annotation.scoreWeightInput', { part }),
  })),
)

/** 清空 = 这一项恢复默认；超出 0.1–9.8 时保持原值。三项之和不为 10 时由 blockedReason 拦住开始 */
function onScoreRatioInput(key: keyof ScoreWeights, e: Event): void {
  const input = e.target as HTMLInputElement
  if (input.value === '') setScoreRatio(key, null)
  else if (input.validity.valid) setScoreRatio(key, input.valueAsNumber)
  input.value = String(scoreRatio.value[key])
}
</script>

<template>
  <section class="min-w-0 rounded-lg border border-base-content/20 kawaru-text-68">
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-base-200/60"
      @click="open = !open"
    >
      <SvgIcon
        type="chevron_down"
        class="h-3.5 w-3.5 shrink-0 transition-transform"
        :class="{ '-rotate-90': !open }"
      />
      <span class="shrink-0 font-medium">{{ $t('vizworkbench.annotation.conditions') }}</span>
      <span v-if="!open" class="min-w-0 truncate text-base-content/50" :title="summaryLine">
        {{ summaryLine }}
      </span>
    </button>

    <div v-show="open" class="flex min-w-0 flex-col gap-3 border-t border-base-content/20 p-3">
      <!-- 数据集采集条件 -->
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
        <span class="min-w-24 w-[28%] shrink-0 whitespace-nowrap text-base-content/50">{{
          $t('vizworkbench.annotation.dataset')
        }}</span>
        <div class="flex min-w-0 flex-1 basis-40 flex-col gap-2">
          <div v-if="datasetLine" class="min-w-0 truncate" :title="datasetLine">
            {{ datasetLine }}
          </div>
          <!-- 元数据没有极性时让用户选 -->
          <div v-if="metadataPolarityMissing" class="flex flex-wrap items-baseline gap-1.5">
            <span class="text-warning">{{ $t('vizworkbench.annotation.polarityMissing') }}</span>
            <select
              v-model="polarityOverride"
              class="select select-bordered select-sm max-w-full kawaru-text-62"
            >
              <option :value="null" disabled>{{ $t('vizworkbench.annotation.choose') }}</option>
              <option value="positive">{{ $t('vizworkbench.annotation.positive') }}</option>
              <option value="negative">{{ $t('vizworkbench.annotation.negative') }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 注释库：被匹配的对象 -->
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
        <span class="min-w-24 w-[28%] shrink-0 whitespace-nowrap text-base-content/50">{{
          $t('vizworkbench.annotation.database')
        }}</span>
        <div class="flex min-w-0 flex-1 basis-40 flex-col gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <span
              class="min-w-0 flex-1 basis-16 truncate"
              :title="dbState === 'ready' ? dbLabel : ''"
            >
              <template v-if="dbState === 'ready' && db">
                {{ $t('vizworkbench.annotation.dbInfo', { label: dbLabel, count: db.count }) }}
              </template>
              <span v-else-if="dbState === 'loading'" class="kawaru-text-62 text-base-content/50">
                {{ $t('vizworkbench.annotation.dbLoading') }}
              </span>
              <span v-else-if="dbState === 'idle'" class="kawaru-text-62 text-base-content/50">
                {{ $t('vizworkbench.annotation.dbIdle') }}
              </span>
              <span v-else class="text-warning">{{ $t('vizworkbench.annotation.dbError') }}</span>
            </span>
            <button
              v-if="dbState === 'ready'"
              class="btn btn-ghost btn-sm btn-square shrink-0 self-center"
              :title="$t('vizworkbench.annotation.dbClear')"
              @click="clearDb"
            >
              <SvgIcon type="close" class="h-4 w-4" />
            </button>
          </div>
          <div class="flex min-w-0 flex-wrap items-center gap-2 self-start">
            <button
              class="btn btn-outline btn-sm min-w-0 max-w-full shrink-0 gap-1 px-2 kawaru-text-62"
              :disabled="importingDb"
              :title="`${$t('vizworkbench.annotation.importDb')}\n${$t('vizworkbench.annotation.dbFormat')}`"
              @click="emit('import')"
            >
              <span
                v-if="importingKind === 'file'"
                class="loading loading-spinner loading-xs"
                aria-hidden="true"
              ></span>
              <SvgIcon v-else type="upload" class="shrink-0" />
              <span class="min-w-0 truncate">{{ $t('vizworkbench.annotation.importDb') }}</span>
            </button>
            <!-- 平台库导入：点开列出本站的数据库（当前 HMDB），选中即拉整库 CSV 注入。
                 触发器必须是原生 <button>：div 上的 :disabled="false" 会被 Vue 渲染成
                 disabled="false" 属性字符串，daisyUI 的 .btn[disabled] 只看属性存在与否，
                 会把按钮永久置灰且 pointer-events:none（点不了）。 -->
            <div v-if="platformDbs.length" class="dropdown shrink-0">
              <button
                type="button"
                class="btn btn-outline btn-sm min-w-0 gap-1 px-2 kawaru-text-62"
                :disabled="importingDb"
                :title="$t('vizworkbench.annotation.importFromPlatform')"
                :aria-label="$t('vizworkbench.annotation.importFromPlatform')"
              >
                <span
                  v-if="importingKind === 'platform'"
                  class="loading loading-spinner loading-xs"
                  aria-hidden="true"
                ></span>
                <SvgIcon v-else type="circle_stack" class="shrink-0" />
                <span class="min-w-0 truncate">{{
                  platformPct != null
                    ? $t('vizworkbench.annotation.platformFetching', { pct: platformPct })
                    : $t('vizworkbench.annotation.importFromPlatform')
                }}</span>
              </button>
              <ul
                tabindex="0"
                class="menu dropdown-content z-[1] mt-1 w-52 rounded-box bg-base-100 p-1 shadow-lg kawaru-text-62"
              >
                <li v-for="s in platformDbs" :key="s.id">
                  <button type="button" @click="pickPlatformDb(s.id)">
                    <SvgIcon type="circle_stack" class="h-4 w-4 shrink-0" />
                    <span class="min-w-0 truncate" :title="s.label()">{{ s.label() }}</span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- 峰：平均轴上参与匹配的点 -->
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
        <span class="min-w-24 w-[28%] shrink-0 whitespace-nowrap text-base-content/50">{{
          $t('vizworkbench.annotation.peaks')
        }}</span>
        <div class="flex min-w-0 flex-1 basis-40 flex-col gap-2">
          <template v-if="meanState === 'ready'">
            <div
              class="cursor-help"
              :title="
                $t('vizworkbench.annotation.peaksHint', {
                  axis: peakStats.axis,
                  zero: peakStats.axis - peakStats.nonZero,
                })
              "
            >
              {{
                $t('vizworkbench.annotation.peaksKept', {
                  kept: keptDraft,
                  total: peakStats.nonZero,
                })
              }}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <input
                type="range"
                min="0"
                :max="MAX_CUT_PCT"
                step="1"
                :value="cutDraft"
                class="range range-primary range-xs min-w-16 flex-1"
                :aria-label="$t('vizworkbench.annotation.intensityCutLabel')"
                :title="$t('vizworkbench.annotation.intensityCutLabel')"
                @input="cutDraft = Number(($event.target as HTMLInputElement).value)"
                @change="cutPct = cutDraft"
              />
              <span class="max-w-full break-words kawaru-text-62 text-base-content/60">{{
                cutLabel
              }}</span>
            </div>
          </template>
          <span v-else-if="meanState === 'loading'" class="kawaru-text-62 text-base-content/50">
            {{ $t('vizworkbench.annotation.meanLoading') }}
          </span>
          <span v-else class="text-warning">{{ $t('vizworkbench.annotation.meanMissing') }}</span>
        </div>
      </div>

      <!-- 容差 -->
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
        <span class="min-w-24 w-[28%] shrink-0 whitespace-nowrap text-base-content/50">{{
          $t('vizworkbench.annotation.tolerance')
        }}</span>
        <div class="flex min-w-0 flex-1 basis-44 flex-col gap-2">
          <div class="flex min-w-0 items-baseline gap-2">
            <input
              :value="tolValue ?? ''"
              type="number"
              min="0"
              :step="tolUnit === 'ppm' ? 0.1 : 0.0001"
              :placeholder="String(tolerance.value)"
              class="input input-bordered input-sm min-w-12 w-0 flex-1 kawaru-text-62"
              @change="onTolInput"
            />
            <select
              v-model="tolUnit"
              class="select select-bordered select-sm w-20 shrink-0 pr-8 kawaru-text-62"
            >
              <option value="ppm">ppm</option>
              <option value="Da">Da</option>
            </select>
            <button
              v-if="tolValue != null"
              class="btn btn-ghost btn-sm btn-square shrink-0 self-center"
              :title="$t('vizworkbench.annotation.toleranceReset')"
              @click="tolValue = null"
            >
              <SvgIcon type="refresh" class="h-4 w-4" />
            </button>
          </div>
          <div v-if="toleranceHint" class="w-full break-words kawaru-text-62 text-base-content/50">
            {{ toleranceHint }}
          </div>
        </div>
      </div>

      <!-- 空间计算：100% 覆盖全部匹配项 -->
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
        <span class="min-w-24 w-[28%] shrink-0 whitespace-nowrap text-base-content/50">{{
          $t('vizworkbench.annotation.spatialCalculation')
        }}</span>
        <div class="flex min-w-0 flex-1 basis-44 items-baseline gap-2">
          <input
            :value="spatialPct"
            type="number"
            min="0"
            max="100"
            step="0.1"
            :aria-label="$t('vizworkbench.annotation.spatialCalculation')"
            class="input input-bordered input-sm min-w-12 w-0 flex-1 kawaru-text-62"
            @change="onSpatialPctInput"
          />
          <span class="shrink-0 kawaru-text-62 text-base-content/60">%</span>
          <button
            v-if="spatialPct !== 100"
            class="btn btn-ghost btn-sm btn-square shrink-0 self-center"
            :title="$t('vizworkbench.annotation.spatialReset')"
            @click="setSpatialPct(null)"
          >
            <SvgIcon type="refresh" class="h-4 w-4" />
          </button>
          <button
            class="btn btn-primary btn-sm ml-auto shrink-0 self-center gap-1 px-2 kawaru-text-62"
            :disabled="!canStart"
            :title="$t('vizworkbench.annotation.start')"
            :aria-label="$t('vizworkbench.annotation.start')"
            @click="start"
          >
            <span
              v-if="runState === 'running'"
              class="loading loading-spinner loading-xs"
              aria-hidden="true"
            ></span>
            {{ $t('vizworkbench.annotation.startShort') }}
          </button>
        </div>
      </div>

      <!-- 评分权重：质量 : 加合适配度 : 空间三个比例数（各不小于 0.1，和为 10），除以 10 即总分权重 -->
      <div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-2">
        <span class="min-w-24 w-[28%] shrink-0 whitespace-nowrap text-base-content/50">{{
          $t('vizworkbench.annotation.scoreWeights')
        }}</span>
        <div class="flex min-w-0 flex-1 basis-44 flex-col gap-2">
          <div class="flex min-w-0 items-baseline gap-1">
            <template v-for="(part, i) in weightParts" :key="part.key">
              <span v-if="i > 0" class="shrink-0 text-base-content/40" aria-hidden="true">:</span>
              <input
                :value="scoreRatio[part.key]"
                type="number"
                :min="MIN_SCORE_RATIO"
                :max="MAX_SCORE_RATIO"
                step="any"
                :aria-label="part.inputLabel"
                :aria-invalid="!scoreRatioValid"
                :title="part.inputLabel"
                class="input input-bordered input-sm min-w-10 w-0 flex-1 kawaru-text-62"
                :class="{ 'input-error': !scoreRatioValid }"
                @change="onScoreRatioInput(part.key, $event)"
              />
            </template>
            <button
              v-if="hasCustomScoreRatio"
              class="btn btn-ghost btn-sm btn-square shrink-0 self-center"
              :title="
                $t('vizworkbench.annotation.scoreWeightsReset', {
                  ratio: fmtScoreRatio(DEFAULT_SCORE_RATIO),
                })
              "
              @click="resetScoreRatio"
            >
              <SvgIcon type="refresh" class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- 加合物：栏宽够（≥19rem，列表不换行）时三者同行；否则下拉框换到第二行占满宽度，
           重置留在标题行。重置常驻显示，勾选时不会突然出现、挤窄下拉框。 -->
      <div class="@container min-w-0">
        <div class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1">
          <span class="flex h-10 items-center whitespace-nowrap text-base-content/50">
            {{ $t('vizworkbench.annotation.adducts') }}
          </span>
          <div
            v-if="!context.polarity"
            class="col-span-2 min-w-0 kawaru-text-62 text-base-content/50"
          >
            {{ $t('vizworkbench.annotation.adductNeedPolarity') }}
          </div>
          <template v-else>
            <AdductMultiSelect
              class="col-span-full row-2 min-w-0 @min-[19rem]:col-2 @min-[19rem]:row-1"
              v-model="selectedAdducts"
              :options="adductOptions"
              :label="$t('vizworkbench.annotation.adducts')"
              :empty-label="$t('vizworkbench.annotation.noAdductsSelected')"
            />
            <button
              class="btn btn-ghost btn-sm col-3 row-1 mt-1 whitespace-nowrap px-2 kawaru-text-62"
              :disabled="!hasAdductOverrides"
              @click="resetAdducts"
            >
              {{ $t('vizworkbench.annotation.adductReset') }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>
