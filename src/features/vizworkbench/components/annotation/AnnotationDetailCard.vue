<script setup lang="ts">
/**
 * 注释详情卡，从上到下按「先结论、后证据」排：
 *   名称（来源标签）· 加合物 · 分子式 → q / 总分 / ppm 三个关键数 → 分数及空间子项、实测结果 →
 *   同分子的其他加合离子（空间相关 r + 跳转）→ 同一峰上的其他注释（先按来源等级、再按排名）→
 *   候选名（各带来源标签）。
 * 原始分、权重和贡献列在评分表中，实测 / 理论 m/z 与强度紧接总分。
 *
 * 空间计算比例小于 100% 时，范围外的离子打开卡片后按需算它与兄弟离子的 r，只展示、
 * 不计入总分。
 */
import { computed, inject, watch } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import AnnotationScoreBreakdown from './AnnotationScoreBreakdown.vue'
import OriginBadge from './OriginBadge.vue'
import { ANNOTATION_KEY } from '@/features/vizworkbench/composables/useAnnotation'
import {
  adductDisplay,
  compoundUrl,
  fmtMz,
  fmtPpm,
  fmtQ,
  fmtScore,
  moleculeName,
  qLevelClass,
  samePeakIons,
  siblingIons,
} from '@/features/vizworkbench/utils/annotation/format'
import { moleculeOrigin } from '@/features/vizworkbench/utils/annotation/origin'
import { MIN_COLOC_CORRELATION } from '@/features/vizworkbench/utils/annotation/score'
import type { IonAnnotation } from '@/features/vizworkbench/types/annotation'
import { t } from '@/i18n'

const props = defineProps<{ ion: IonAnnotation; pinned: boolean }>()
const emit = defineEmits<{
  (e: 'jump', id: number): void
  (e: 'toggle-pin'): void
  (e: 'close'): void
  (e: 'pubchem', query: string): void
}>()

const ann = inject(ANNOTATION_KEY)!
const { molecules, ionById, pairRFor, computePairOnDemand, moleculeFilter, scoreWeights } = ann

const molecule = computed(() => molecules.value.get(props.ion.moleculeId))

const siblings = computed(() =>
  siblingIons(props.ion, molecules.value, ionById.value).map((sib) => ({
    sib,
    r: pairRFor(props.ion, sib),
  })),
)

// 尚未算出的相关保留加载状态；已算出但 r < 0.1 的离子行不展示。
const visibleSiblings = computed(() =>
  siblings.value.filter(({ r }) => r == null || r >= MIN_COLOC_CORRELATION),
)

const samePeak = computed(() => samePeakIons(props.ion, ionById.value, molecules.value))

/** 共定位 r 是否只是展示用（本行没有参加空间评分） */
const rDisplayOnly = computed(() => props.ion.scores.spatialState !== 'done')

const colocTitle = computed(() => {
  const hint = t('vizworkbench.annotation.colocHint', { minR: MIN_COLOC_CORRELATION })
  return rDisplayOnly.value ? `${hint}\n${t('vizworkbench.annotation.colocDisplayOnly')}` : hint
})

// 没算过的兄弟峰对按需计算；本行或兄弟还在空间评分队列里的，等评分结果
watch(
  () => props.ion.id,
  () => {
    if (props.ion.scores.spatialState === 'queued') return
    for (const { sib, r } of siblings.value) {
      if (r === undefined && sib.scores.spatialState !== 'queued') {
        void computePairOnDemand(props.ion, sib)
      }
    }
  },
  { immediate: true },
)

function rClass(r: number | null | undefined): string {
  if (r == null) return 'text-base-content/30'
  if (r >= 0.7) return 'text-success'
  return r < 0.4 ? 'text-base-content/40' : ''
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {})
}
</script>

<template>
  <div
    class="max-h-[70vh] w-max overflow-auto rounded-lg border border-base-300 bg-base-100 p-4 shadow-xl select-text kawaru-text-75"
  >
    <!-- 标题：名称 / 加合物 · 分子式 -->
    <div class="flex items-start gap-2">
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <div
            class="truncate kawaru-text-81 font-semibold text-base-content"
            :title="moleculeName(molecule)"
          >
            {{ moleculeName(molecule) }}
          </div>
          <OriginBadge :origin="moleculeOrigin(molecule)" molecule />
        </div>
        <div class="mt-1 flex items-center gap-2 font-mono text-base-content/60">
          <span class="annotation-adduct badge badge-sm shrink-0">{{
            adductDisplay(ion.adduct)
          }}</span>
          <span
            class="truncate"
            :title="
              $t('vizworkbench.annotation.neutralMass', {
                mass: molecule?.neutralMass.toFixed(4),
              })
            "
          >
            {{ molecule?.formula }}
          </span>
        </div>
      </div>
      <button
        class="btn btn-ghost btn-square size-9 shrink-0"
        :title="$t('vizworkbench.annotation.copyName')"
        @click="copy(moleculeName(molecule))"
      >
        <SvgIcon type="duplicate" class="h-5! w-5!" />
      </button>
      <button
        class="btn btn-ghost btn-square size-9 shrink-0"
        :class="{ 'text-primary': pinned }"
        :title="pinned ? $t('vizworkbench.annotation.unpin') : $t('vizworkbench.annotation.pin')"
        @click="emit('toggle-pin')"
      >
        <SvgIcon type="position" class="h-5! w-5!" />
      </button>
      <button
        v-if="pinned"
        class="btn btn-ghost btn-square size-9 shrink-0"
        :title="$t('vizworkbench.annotation.close')"
        @click="emit('close')"
      >
        <SvgIcon type="close" class="h-5! w-5!" />
      </button>
    </div>

    <!-- 关键数：q / 总分 / 质量误差 -->
    <div class="mt-3 grid grid-cols-3 gap-2 rounded-md bg-base-200/60 py-2 text-center">
      <div :title="$t('vizworkbench.annotation.qLevelHint')">
        <div class="font-mono kawaru-text-95" :class="qLevelClass(ion.q)">{{ fmtQ(ion.q) }}</div>
        <div class="kawaru-text-68 text-base-content/50">
          {{ $t('vizworkbench.annotation.qLevelLabel') }}
        </div>
      </div>
      <div>
        <div class="font-mono kawaru-text-95 font-semibold">{{ fmtScore(ion.scores.total) }}</div>
        <div class="kawaru-text-68 text-base-content/50">
          {{ $t('vizworkbench.annotation.totalScore') }} #{{ ion.rank }}
        </div>
      </div>
      <div>
        <div class="font-mono kawaru-text-95">{{ fmtPpm(ion.errPpm) }}</div>
        <div class="kawaru-text-68 text-base-content/50">ppm</div>
      </div>
    </div>

    <AnnotationScoreBreakdown :ion="ion" :weights="scoreWeights" />

    <!-- 同分子的其他加合离子 -->
    <div v-if="visibleSiblings.length" class="mt-3 border-t border-base-content/15 pt-3">
      <div class="mb-2 flex items-center gap-2 text-base-content/50">
        <span class="shrink-0">{{ $t('vizworkbench.annotation.siblings') }}</span>
        <button
          class="btn btn-primary btn-xs shrink-0 px-2 kawaru-text-68"
          :title="$t('vizworkbench.annotation.onlyThisMolecule')"
          :aria-label="$t('vizworkbench.annotation.onlyThisMolecule')"
          @click="moleculeFilter = ion.moleculeId"
        >
          {{ $t('vizworkbench.annotation.onlyThisMoleculeShort') }}
        </button>
      </div>
      <!-- 窄卡片中加合物与 m/z 可换行，完整保留质量小数位。 -->
      <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-2">
        <template v-for="{ sib, r } in visibleSiblings" :key="sib.id">
          <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 font-mono">
            <span class="whitespace-nowrap">{{ adductDisplay(sib.adduct) }}</span>
            <span class="whitespace-nowrap text-base-content/60">{{ fmtMz(sib.obsMz) }}</span>
          </div>
          <span
            class="inline-flex cursor-help items-center justify-end gap-1 whitespace-nowrap font-mono"
            :class="rClass(r)"
            :title="colocTitle"
          >
            <span>{{ $t('vizworkbench.annotation.colocR') }}</span>
            <span v-if="r === undefined" class="loading loading-dots loading-xs"></span>
            <template v-else>{{ fmtScore(r) }}</template>
          </span>
          <button
            class="btn btn-ghost btn-square size-9 shrink-0"
            :title="$t('vizworkbench.annotation.jump')"
            @click="emit('jump', sib.id)"
          >
            <SvgIcon type="jump" class="h-5! w-5!" />
          </button>
        </template>
      </div>
    </div>

    <!-- 同一峰上的其他注释 -->
    <div v-if="samePeak.length" class="mt-3 border-t border-base-content/15 pt-3">
      <div
        class="mb-2 flex cursor-help items-center gap-1 text-base-content/60"
        :title="$t('vizworkbench.annotation.samePeakNote')"
      >
        <SvgIcon type="layers" class="h-4 w-4" />
        {{ $t('vizworkbench.annotation.samePeakTitle') }}
      </div>
      <ul class="space-y-1.5">
        <li v-for="other in samePeak" :key="other.id" class="flex items-center gap-3">
          <span class="min-w-0 flex-1 truncate">
            {{ moleculeName(molecules.get(other.moleculeId)) }}
            <span class="font-mono text-base-content/60">{{ adductDisplay(other.adduct) }}</span>
          </span>
          <OriginBadge :origin="moleculeOrigin(molecules.get(other.moleculeId))" molecule />
          <span class="shrink-0 font-mono" :class="qLevelClass(other.q)">
            {{ $t('vizworkbench.annotation.qValue', { value: fmtQ(other.q) }) }}
          </span>
          <button
            class="btn btn-ghost btn-square size-9 shrink-0"
            :title="$t('vizworkbench.annotation.jump')"
            @click="emit('jump', other.id)"
          >
            <SvgIcon type="jump" class="h-5! w-5!" />
          </button>
        </li>
      </ul>
    </div>

    <!-- 候选化合物（同分子式的异构体） -->
    <div v-if="molecule?.candidates.length" class="mt-3 border-t border-base-content/15 pt-3">
      <div class="mb-2 text-base-content/50">
        {{ $t('vizworkbench.annotation.candidates', { count: molecule.candidates.length }) }}
      </div>
      <ul class="space-y-2">
        <li v-for="c in molecule.candidates" :key="c.id || c.name" class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate" :title="c.name">{{ c.name }}</span>
              <OriginBadge :origin="c.origin" />
            </div>
            <div v-if="c.id" class="font-mono kawaru-text-56 text-base-content/50">
              <a
                v-if="compoundUrl(c.id)"
                :href="compoundUrl(c.id)!"
                target="_blank"
                rel="noopener noreferrer"
                class="link link-hover"
                :title="$t('vizworkbench.annotation.openInDatabase')"
                >{{ c.id }}</a
              >
              <template v-else>{{ c.id }}</template>
            </div>
          </div>
          <button
            v-if="c.inchi"
            class="btn btn-ghost btn-square size-9 shrink-0"
            :title="$t('vizworkbench.annotation.copyInchi')"
            @click="copy(c.inchi)"
          >
            <SvgIcon type="duplicate" class="h-5! w-5!" />
          </button>
          <button
            class="btn btn-ghost btn-square size-9 shrink-0 text-primary"
            :title="$t('vizworkbench.annotation.searchPubchem')"
            @click="emit('pubchem', c.name)"
          >
            <SvgIcon type="search" class="h-5! w-5!" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* badge-sm 与详情卡中的辅助文字保持同一字号。 */
.annotation-adduct {
  font-size: 0.6875rem;
}
</style>
