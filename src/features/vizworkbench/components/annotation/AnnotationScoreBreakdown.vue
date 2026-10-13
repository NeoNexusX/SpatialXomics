<script setup lang="ts">
/** 原始分、总分权重与贡献；空间子项只在空间评分完成后显示实测值。 */
import { computed } from 'vue'
import { t } from '@/i18n'
import { fmtIntensity, fmtMz } from '@/features/vizworkbench/utils/annotation/format'
import { colocScore, DEFAULT_ENGINE_CONFIG } from '@/features/vizworkbench/utils/annotation/score'
import type { IonAnnotation } from '@/features/vizworkbench/types/annotation'

const props = defineProps<{
  ion: IonAnnotation
}>()

const W = DEFAULT_ENGINE_CONFIG.weights
const SW = DEFAULT_ENGINE_CONFIG.spatialWeights
const hasSpatial = computed(() => props.ion.scores.spatial != null)

function numberText(value: number | null): string {
  return value != null && Number.isFinite(value) ? value.toFixed(3) : '–'
}

const rows = computed(() => {
  const s = props.ion.scores
  const spatial = s.spatial ?? 0
  const coloc = hasSpatial.value ? colocScore(s.coloc) : null
  return [
    {
      key: 'mass',
      label: t('vizworkbench.annotation.massScore'),
      value: s.mass,
      weight: W.mass,
      contribution: W.mass * s.mass,
      sub: false,
    },
    {
      key: 'adduct',
      label: t('vizworkbench.annotation.adductFit'),
      value: s.adduct,
      weight: W.adduct,
      contribution: W.adduct * s.adduct,
      sub: false,
    },
    {
      key: 'spatial',
      label: t('vizworkbench.annotation.spatialScore'),
      value: spatial,
      weight: W.spatial,
      contribution: W.spatial * spatial,
      sub: false,
    },
    {
      key: 'chaos',
      label: t('vizworkbench.annotation.chaosScore'),
      value: s.chaos,
      weight: W.spatial * SW.chaos,
      contribution: hasSpatial.value && s.chaos != null ? W.spatial * SW.chaos * s.chaos : null,
      sub: true,
    },
    {
      key: 'coloc',
      label: t('vizworkbench.annotation.colocScore'),
      value: coloc,
      weight: W.spatial * SW.coloc,
      contribution: coloc != null ? W.spatial * SW.coloc * coloc : null,
      sub: true,
    },
  ]
})
</script>

<template>
  <div class="mt-3">
    <table
      class="w-full border-collapse"
      :aria-label="$t('vizworkbench.annotation.scoreBreakdown')"
    >
      <thead class="kawaru-text-56 text-base-content/50">
        <tr class="border-b border-base-content/15">
          <th class="pb-2 text-left font-normal">{{ $t('vizworkbench.annotation.scoreItem') }}</th>
          <th class="pb-2 pl-2 text-right font-normal">
            {{ $t('vizworkbench.annotation.rawScore') }}
          </th>
          <th class="pb-2 pl-2 text-right font-normal">
            {{ $t('vizworkbench.annotation.totalWeight') }}
          </th>
          <th class="pb-2 pl-2 text-right font-normal">
            {{ $t('vizworkbench.annotation.scoreContribution') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.key"
          :class="row.sub ? 'kawaru-text-56 text-base-content/60' : ''"
        >
          <td class="py-1.5" :class="row.sub ? 'pl-3' : ''">{{ row.label }}</td>
          <td class="py-1.5 pl-2 text-right font-mono">
            {{ numberText(row.value) }}
          </td>
          <td class="py-1.5 pl-2 text-right font-mono">{{ Math.round(row.weight * 100) }}%</td>
          <td class="py-1.5 pl-2 text-right font-mono">
            {{ numberText(row.contribution) }}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="border-t border-base-content/15 font-semibold">
          <td colspan="3" class="pt-2">{{ $t('vizworkbench.annotation.totalScore') }}</td>
          <td class="pt-2 pl-2 text-right font-mono">{{ numberText(ion.scores.total) }}</td>
        </tr>
        <tr>
          <td colspan="4" class="pt-2">
            <div
              class="flex flex-wrap gap-x-4 gap-y-1 font-mono kawaru-text-56 text-base-content/50"
            >
              <span>{{ $t('vizworkbench.annotation.measured', { mz: fmtMz(ion.obsMz) }) }}</span>
              <span>{{
                $t('vizworkbench.annotation.theoretical', { mz: fmtMz(ion.theoMz) })
              }}</span>
              <span v-if="Number.isFinite(ion.intensity)">
                {{ $t('vizworkbench.annotation.intensity') }} {{ fmtIntensity(ion.intensity) }}
              </span>
            </div>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
