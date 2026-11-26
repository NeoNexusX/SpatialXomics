<template>
  <div class="flex flex-col gap-3 kawaru-text-68">
    <div class="space-y-2">
      <div class="flex items-center gap-1">
        <h3 class="kawaru-text-75 font-semibold">{{ $t('vizworkbench.roi.tools') }}</h3>
        <SectionHelp :label="$t('vizworkbench.roi.tools')">
          <dl class="space-y-1.5">
            <div v-for="type in tools" :key="type">
              <dt class="font-semibold">{{ labels[type] }}</dt>
              <dd>{{ toolHints[type] }}</dd>
            </div>
          </dl>
        </SectionHelp>
        <span
          v-if="editor.currentColor"
          role="img"
          data-testid="roi-current-color"
          class="ml-auto h-4 w-4 shrink-0 rounded-full border border-base-content/25"
          :style="{ backgroundColor: editor.currentColor }"
          :aria-label="$t('vizworkbench.roi.strokeColor')"
          :title="$t('vizworkbench.roi.strokeColor')"
        />
      </div>
      <div class="grid grid-cols-5 gap-1" role="group" :aria-label="$t('vizworkbench.roi.tools')">
        <button
          v-for="type in tools"
          :key="type"
          type="button"
          class="btn btn-sm min-w-0 px-0"
          :class="editor.tool === type ? 'btn-primary' : 'btn-ghost'"
          :aria-label="labels[type]"
          :title="toolTitle(type)"
          :aria-pressed="editor.tool === type"
          :disabled="toolDisabled(type)"
          @click="editor.selectTool(editor.tool === type ? null : type)"
        >
          <SvgIcon :type="toolIcons[type]" class="h-5 w-5" />
        </button>
      </div>

      <div
        v-if="editor.tool === 'collect'"
        class="space-y-1"
        role="group"
        :aria-label="labels.collect"
      >
        <p data-testid="roi-collect-source" class="truncate font-mono text-base-content/60">
          {{ collect.source }}
        </p>
        <div class="grid grid-cols-3 gap-1">
          <button
            v-for="kind in collectKinds"
            :key="kind"
            type="button"
            class="btn btn-sm h-auto min-w-0 flex-col gap-0 px-1 py-1 kawaru-text-68"
            :class="editor.pendingCollect === kind ? 'btn-primary' : 'btn-ghost'"
            :aria-pressed="editor.pendingCollect === kind"
            :disabled="collectDisabled(kind)"
            @click="collect.stage(kind)"
          >
            <span class="max-w-full truncate">{{ collectKindLabel(kind) }}</span>
            <span class="font-mono kawaru-text-62 opacity-70">{{ collectCount(kind) }}</span>
          </button>
        </div>
      </div>

      <div v-if="hasDraftControls || regions.length" class="space-y-2">
        <div class="flex items-center gap-1 border-t border-base-content/15 pt-2">
          <h3 class="kawaru-text-75 font-semibold">{{ $t('vizworkbench.roi.operation') }}</h3>
          <SectionHelp :label="$t('vizworkbench.roi.operation')">
            <p class="mb-2">{{ $t('vizworkbench.roi.operationHint') }}</p>
            <dl class="space-y-1.5">
              <div v-for="mode in modes" :key="mode">
                <dt class="font-semibold">{{ labels[mode] }}</dt>
                <dd>{{ operationHints[mode] }}</dd>
              </div>
            </dl>
          </SectionHelp>
        </div>
        <div
          class="grid grid-cols-3 gap-1"
          role="group"
          :aria-label="$t('vizworkbench.roi.operation')"
        >
          <button
            v-for="mode in modes"
            :key="mode"
            type="button"
            class="btn btn-sm min-w-0 kawaru-text-68"
            :class="editor.operation === mode ? 'btn-primary' : 'btn-ghost'"
            :aria-pressed="editor.operation === mode"
            :disabled="!editor.canSelectOperation(mode)"
            @click="editor.selectOperation(mode)"
          >
            {{ labels[mode] }}
          </button>
        </div>

        <select
          v-if="regions.length || editor.pendingRegion"
          class="select select-sm w-full kawaru-text-68"
          :aria-label="$t('vizworkbench.roi.useRegion')"
          :disabled="!editor.canSelectRegion"
          :value="editor.pendingRegion?.id ?? ''"
          @change="stageRegion"
        >
          <option value="" disabled>{{ $t('vizworkbench.roi.useRegion') }}</option>
          <option v-if="previousRegion" :value="previousRegion.id">
            {{ $t('vizworkbench.roi.previousRegion', { label: previousRegion.label }) }}
          </option>
          <optgroup v-if="roiRegions.length" :label="$t('vizworkbench.roi.rois')">
            <option v-for="region in roiRegions" :key="region.id" :value="region.id">
              {{ region.label }}
            </option>
          </optgroup>
          <optgroup v-if="clusterRegions.length" label="K-means">
            <option v-for="region in clusterRegions" :key="region.id" :value="region.id">
              {{ region.label }}
            </option>
          </optgroup>
        </select>

        <div v-if="editor.hasUnconfirmedShape" class="flex flex-nowrap gap-1">
          <button
            v-if="editor.hasPendingShape"
            key="confirm-shape"
            type="button"
            class="btn btn-xs btn-primary min-w-0 flex-1 px-1 whitespace-nowrap"
            @click="editor.confirmShape"
          >
            {{ $t('vizworkbench.roi.confirmShape') }}
          </button>
          <button
            v-else
            key="close-shape"
            type="button"
            class="btn btn-xs btn-outline min-w-0 flex-1 px-1 whitespace-nowrap"
            :disabled="!editor.canClosePath"
            @click="editor.closePath"
          >
            {{ $t('vizworkbench.roi.closePath') }}
          </button>
          <button
            type="button"
            class="btn btn-xs btn-ghost min-w-0 flex-1 px-1 whitespace-nowrap"
            @click="editor.discardShape"
          >
            {{ $t('vizworkbench.roi.discardPath') }}
          </button>
        </div>

        <div v-if="hasDraftControls" class="space-y-2 border-t border-base-content/15 pt-2">
          <p aria-live="polite" data-testid="roi-preview-count">
            {{
              $t('vizworkbench.roi.previewCount', { count: pixelCountLabel(editor.previewCount) })
            }}
          </p>
          <div class="flex flex-wrap gap-1">
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              :disabled="!editor.canUndo"
              @click="editor.undo"
            >
              {{ $t('vizworkbench.roi.undo') }}
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              :disabled="!editor.canRedo"
              @click="editor.redo"
            >
              {{ $t('vizworkbench.roi.redo') }}
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost ml-auto"
              @click="pendingAction = 'discardDraft'"
            >
              {{ $t('vizworkbench.roi.discardDraft') }}
            </button>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-primary w-full"
            :disabled="!editor.canSave"
            @click="state.saveDraft()"
          >
            {{ $t('vizworkbench.roi.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ROI List -->
    <div v-if="state.confirmedROIs.length">
      <div class="flex items-center justify-between mb-2">
        <!-- 总勾选框：全选 ⇄ 全不选，部分勾选时显示半选。勾选会显示主图填充并纳入导出掩膜 -->
        <div class="flex min-w-0 items-center gap-1">
          <h3 class="min-w-0 kawaru-text-75 font-semibold text-base-content">
            <label
              class="flex items-center gap-1.5 cursor-pointer select-none"
              :title="
                allSelected ? $t('vizworkbench.roi.deselectAll') : $t('vizworkbench.roi.selectAll')
              "
            >
              <input
                type="checkbox"
                class="checkbox checkbox-xs checkbox-primary shrink-0"
                :checked="allSelected"
                :indeterminate="selectedCount > 0 && !allSelected"
                @change="toggleAll"
              />
              {{ $t('vizworkbench.roi.rois') }}
              <span class="font-mono font-normal text-base-content/60"
                >{{ selectedCount }}/{{ state.confirmedROIs.length }}</span
              >
            </label>
          </h3>
          <SectionHelp :label="$t('vizworkbench.roi.rois')">
            {{ $t('vizworkbench.roi.selectionHint') }}
          </SectionHelp>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn btn-xs btn-ghost shrink-0"
            :aria-pressed="state.viewingROI"
            :title="
              state.viewingROI
                ? $t('vizworkbench.roi.viewingRoiHint')
                : $t('vizworkbench.roi.viewingAllHint')
            "
            @click="state.toggleViewingROI()"
          >
            {{ state.viewingROI ? $t('vizworkbench.roi.roiOnly') : $t('vizworkbench.roi.showAll') }}
          </button>
          <button
            type="button"
            class="text-error hover:underline"
            @click="pendingAction = 'clearAll'"
          >
            {{ $t('common.action.clearAll') }}
          </button>
        </div>
      </div>
      <div class="space-y-2 max-h-64 overflow-y-auto scrollbar-thin [scrollbar-gutter:stable]">
        <!-- 两行：身份（名字 · 形状 · 像素数）+ 强度统计条（标签在上、数值在下，
             多张卡片同列对齐便于比较） -->
        <RegionSummaryCard
          v-for="roi in state.confirmedROIs"
          :key="roi.id"
          :color="roi.color"
          :stats="roi.stats"
        >
          <div class="flex items-center gap-1.5">
            <label class="flex items-center gap-1.5 min-w-0 cursor-pointer select-none">
              <input
                type="checkbox"
                class="checkbox checkbox-xs checkbox-primary shrink-0"
                :checked="state.isRoiSelected(roi.id)"
                @change="state.toggleRoiSelection(roi.id)"
              />
              <span
                class="font-semibold truncate"
                :style="{ color: roi.color }"
                :title="roi.label"
                >{{ roi.label }}</span
              >
            </label>
            <span :class="TAG_CLASS">{{ labels[roi.type] }}</span>
            <span class="ml-auto shrink-0 font-mono kawaru-text-62 text-base-content/60">{{
              pixelCountLabel(roi.pixelCount)
            }}</span>
            <button
              class="shrink-0 text-base-content hover:text-error"
              :title="$t('common.action.delete')"
              @click="state.deleteROI(roi.id)"
            >
              <SvgIcon type="trash" />
            </button>
          </div>
          <template #controls>
            <label class="mt-1.5 flex items-center gap-2 kawaru-text-62">
              <span class="shrink-0">{{ $t('vizworkbench.roi.opacity') }}</span>
              <input
                type="range"
                class="range range-xs range-primary min-w-0 flex-1"
                min="0"
                max="1"
                step="0.01"
                :value="state.opacityOf(roi.id)"
                :aria-label="$t('vizworkbench.roi.opacityFor', { label: roi.label })"
                :aria-valuetext="`${Math.round(state.opacityOf(roi.id) * 100)}%`"
                @input="state.updateRoiOpacity(roi.id, +($event.target as HTMLInputElement).value)"
              />
              <span class="w-[3em] shrink-0 text-right font-mono"
                >{{ Math.round(state.opacityOf(roi.id) * 100) }}%</span
              >
            </label>
          </template>
        </RegionSummaryCard>
      </div>
    </div>

    <Teleport to="body">
      <ConfirmDialog
        v-if="pendingAction"
        open
        v-bind="confirmationLabels"
        danger
        @cancel="pendingAction = null"
        @confirm="confirmAction"
      />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import ConfirmDialog from '@/shared/components/ConfirmDialog.vue'
import SectionHelp from '@/features/vizworkbench/components/SectionHelp.vue'
import RegionSummaryCard from './RegionSummaryCard.vue'
import {
  collectKindLabel,
  type RoiCollect,
} from '@/features/vizworkbench/composables/useRoiCollect'
import type { RoiState } from '@/features/vizworkbench/composables/useROI'
import { t } from '@/i18n'
import type { Region } from '@/features/vizworkbench/utils/region'
import type { CollectKind, RoiTool } from '@/features/vizworkbench/utils/roiMask'

const props = defineProps<{
  /** Saved ROIs, their selection and opacity, and the editor that drafts new ones. */
  state: RoiState
  /** Collect tool source: the current ion image's signal and no-signal pixels. */
  collect: RoiCollect
  /** Regions a draft can start from or combine with: saved ROIs and KMeans clusters. */
  regions: Region[]
}>()

const editor = computed(() => props.state.editor)

const pendingAction = ref<'discardDraft' | 'clearAll' | null>(null)
const hasDraftControls = computed(() => {
  const { tool, hasDraft, hasUnconfirmedShape, canRedo } = editor.value
  return !!tool || hasDraft || hasUnconfirmedShape || canRedo
})
const confirmationLabels = computed(() =>
  pendingAction.value === 'clearAll'
    ? {
        title: t('vizworkbench.roi.clearAllTitle'),
        message: t('vizworkbench.roi.clearAllMessage'),
        confirmLabel: t('common.action.clearAll'),
      }
    : {
        title: t('vizworkbench.roi.discardDraftTitle'),
        message: t('vizworkbench.roi.discardDraftMessage'),
        confirmLabel: t('vizworkbench.roi.discardDraftConfirm'),
        cancelLabel: t('vizworkbench.roi.continueEditing'),
      },
)

function confirmAction() {
  const action = pendingAction.value
  pendingAction.value = null
  if (action === 'clearAll') props.state.clearAllROIs()
  else if (action === 'discardDraft') editor.value.reset()
}

const labels = computed(() => ({
  rectangle: t('vizworkbench.roi.rect'),
  freehand: t('vizworkbench.roi.lasso'),
  polygon: t('vizworkbench.roi.polygon'),
  ellipse: t('vizworkbench.roi.ellipse'),
  collect: t('vizworkbench.roi.collect'),
  imported: t('vizworkbench.roi.imported'),
  composite: t('vizworkbench.roi.composite'),
  union: t('vizworkbench.roi.add'),
  difference: t('vizworkbench.roi.difference'),
  intersection: t('vizworkbench.roi.intersection'),
}))

const modes = ['union', 'difference', 'intersection'] as const

const operationHints = computed(() => ({
  union: t('vizworkbench.roi.addHint'),
  difference: t('vizworkbench.roi.subtractHint'),
  intersection: t('vizworkbench.roi.intersectHint'),
}))

const tools = ['rectangle', 'ellipse', 'polygon', 'freehand', 'collect'] as const

const toolIcons = {
  rectangle: 'square',
  ellipse: 'ellipse',
  polygon: 'waypoints',
  freehand: 'lasso',
  collect: 'grid-2x2-check',
} as const

const toolHints = computed(() => ({
  rectangle: t('vizworkbench.roi.rectHint'),
  ellipse: t('vizworkbench.roi.ellipseHint'),
  polygon: t('vizworkbench.roi.polygonHint'),
  freehand: t('vizworkbench.roi.pathHint'),
  collect: t('vizworkbench.roi.collectHint'),
}))

function toolDisabled(type: RoiTool) {
  if (!editor.value.canSelectTool(type)) return true
  const { collect } = props
  return type === 'collect' && editor.value.tool !== type && (!collect.available || !collect.counts)
}

function toolTitle(type: RoiTool) {
  return type === 'collect' && !props.collect.available
    ? t('vizworkbench.roi.collectUnavailable')
    : labels.value[type]
}

const collectKinds = ['present', 'absent', 'all'] as const satisfies readonly CollectKind[]

function collectDisabled(kind: CollectKind) {
  const { collect } = props
  return !collect.ready || !editor.value.canSelectRegion || !collect.counts?.[kind]
}

function collectCount(kind: CollectKind) {
  return (props.collect.counts?.[kind] ?? 0).toLocaleString('en-US')
}

const roiRegions = computed(() => props.regions.filter((region) => region.kind === 'roi'))
const clusterRegions = computed(() => props.regions.filter((region) => region.kind === 'kmeans'))
const previousRegion = computed(() => {
  const pending = editor.value.pendingRegion
  return pending && !props.regions.some((region) => region.id === pending.id) ? pending : null
})

function stageRegion(event: Event) {
  const select = event.target as HTMLSelectElement
  const region = props.regions.find((item) => item.id === select.value)
  if (region) editor.value.stageRegion(region)
  select.value = editor.value.pendingRegion?.id ?? ''
}

// Count by filtering the ROIs (never Set.size), so a stale id cannot inflate it.
const selectedCount = computed(
  () => props.state.confirmedROIs.filter((roi) => props.state.isRoiSelected(roi.id)).length,
)

const allSelected = computed(
  () =>
    props.state.confirmedROIs.length > 0 &&
    selectedCount.value === props.state.confirmedROIs.length,
)

function toggleAll() {
  if (allSelected.value) props.state.clearRoiSelection()
  else props.state.selectAllRois()
}

/** ROI 形状标签。 */
const TAG_CLASS =
  'card-tag shrink-0 rounded border border-base-content/20 px-1 kawaru-text-56 text-base-content/60'

// 模板渲染时调用 t()，切换语言会随之重算。千分位固定用 en-US，不随浏览器区域变成「1.346」。
function pixelCountLabel(n: number): string {
  return t('vizworkbench.roi.pixelCount', { n: n.toLocaleString('en-US') })
}
</script>
