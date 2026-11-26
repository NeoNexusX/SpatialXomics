<template>
  <div class="flex flex-col gap-3 kawaru-text-68">
    <!-- ROI Tools -->
    <div>
      <h3 class="kawaru-text-75 font-semibold text-base-content mb-2">
        {{ $t('vizworkbench.roi.tools') }}
      </h3>
      <!-- 画选区工具和「显示全部 ⇄ 仅 ROI」过滤开关同排；栏宽不够时开关整颗换到下一行 -->
      <div class="flex flex-wrap gap-1.5">
        <button
          class="btn btn-sm flex-1 whitespace-nowrap kawaru-text-68"
          :class="selectedTool === 'rectangle' ? 'btn-primary' : 'btn-ghost'"
          @click="$emit('update:selectedTool', selectedTool === 'rectangle' ? null : 'rectangle')"
        >
          <SvgIcon type="square" /> {{ $t('vizworkbench.roi.rect') }}
        </button>
        <button
          class="btn btn-sm flex-1 whitespace-nowrap kawaru-text-68"
          :class="selectedTool === 'freehand' ? 'btn-primary' : 'btn-ghost'"
          @click="$emit('update:selectedTool', selectedTool === 'freehand' ? null : 'freehand')"
        >
          <SvgIcon type="lasso" /> {{ $t('vizworkbench.roi.lasso') }}
        </button>
        <button
          v-if="rois.length"
          class="btn btn-sm flex-1 whitespace-nowrap kawaru-text-68"
          :class="viewingRoi ? 'btn-primary' : 'btn-ghost'"
          :title="
            viewingRoi
              ? $t('vizworkbench.roi.viewingRoiHint')
              : $t('vizworkbench.roi.viewingAllHint')
          "
          @click="$emit('update:viewingRoi', !viewingRoi)"
        >
          {{ viewingRoi ? $t('vizworkbench.roi.roiOnly') : $t('vizworkbench.roi.showAll') }}
        </button>
      </div>
      <div v-if="draftReady" class="flex gap-1.5 mt-1.5">
        <button class="btn btn-sm btn-success flex-1 kawaru-text-68" @click="$emit('confirm')">
          <SvgIcon type="check" /> {{ $t('common.action.confirm') }}
        </button>
        <button
          class="btn btn-sm btn-ghost flex-1 text-error kawaru-text-68"
          @click="$emit('cancel')"
        >
          <SvgIcon type="close" /> {{ $t('common.action.cancel') }}
        </button>
      </div>
      <div v-if="draftReady" class="text-base-content mt-1">
        {{
          selectedTool === 'freehand'
            ? $t('vizworkbench.roi.readyLasso')
            : $t('vizworkbench.roi.readyRect')
        }}
      </div>
      <div v-else-if="selectedTool === 'rectangle'" class="text-base-content mt-1">
        {{ $t('vizworkbench.roi.rectHint') }}
      </div>
      <div v-else-if="selectedTool === 'freehand'" class="text-base-content mt-1">
        {{ $t('vizworkbench.roi.lassoHint') }}
      </div>
    </div>

    <!-- ROI List -->
    <div v-if="rois.length">
      <div class="flex items-center justify-between mb-2">
        <!-- 总勾选框：全选 ⇄ 全不选，部分勾选时显示半选。勾选 = 主图描边 + 纳入导出掩膜（不过滤图像） -->
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
                >{{ selectedCount }}/{{ rois.length }}</span
              >
            </label>
          </h3>
          <SectionHelp :label="$t('vizworkbench.roi.rois')">
            {{ $t('vizworkbench.roi.selectionHint') }}
          </SectionHelp>
        </div>
        <button class="text-error hover:underline" @click="$emit('clearAll')">
          {{ $t('common.action.clearAll') }}
        </button>
      </div>
      <div class="stat-list space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
        <!-- 两行：身份（名字 · 形状 · 像素数）+ 强度统计条（标签在上、数值在下，
             多张卡片同列对齐便于比较） -->
        <div
          v-for="roi in rois"
          :key="roi.id"
          class="stat-card rounded-lg border px-2 py-1.5"
          :style="{
            borderColor: cssWithAlpha(roi.color, 0.25),
            background: cssWithAlpha(roi.color, 0.03),
          }"
        >
          <div class="flex items-center gap-1.5">
            <label class="flex items-center gap-1.5 min-w-0 cursor-pointer select-none">
              <input
                type="checkbox"
                class="checkbox checkbox-xs checkbox-primary shrink-0"
                :checked="isSelected(roi.id)"
                @change="$emit('toggle-selection', roi.id)"
              />
              <span class="font-semibold truncate" :style="{ color: roi.color }">{{
                roi.label
              }}</span>
            </label>
            <!-- 形状写成小标签（与导入掩膜的格式标签同款）；方框图标放在名字旁像个未勾选的复选框 -->
            <span :class="TAG_CLASS">{{
              roi.type === 'freehand' ? $t('vizworkbench.roi.lasso') : $t('vizworkbench.roi.rect')
            }}</span>
            <span
              v-if="roi.stats"
              class="ml-auto shrink-0 font-mono kawaru-text-62 text-base-content/60"
              >{{ pixelCountLabel(roi.stats.pixelCount) }}</span
            >
            <button
              class="shrink-0 text-base-content hover:text-error"
              :class="{ 'ml-auto': !roi.stats }"
              :title="$t('common.action.delete')"
              @click="$emit('delete', roi.id)"
            >
              <SvgIcon type="trash" />
            </button>
          </div>
          <dl v-if="roi.stats" class="stat-strip mt-1">
            <div v-for="cell in statCells(roi.stats)" :key="cell.key" class="min-w-0">
              <dt class="truncate kawaru-text-62 text-base-content/50">{{ cell.label }}</dt>
              <dd class="truncate font-mono" :title="cell.value">{{ cell.value }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>

    <!-- Imported masks（文件导入：独立于手绘 ROI，虚线边框区分；勾选 = 应用过滤，
         trash = 移除该导入；每个掩膜同时也是比较面板里的可选区域） -->
    <div v-if="importedMasks?.length">
      <h3 class="kawaru-text-75 font-semibold text-base-content mb-2">
        {{ $t('vizworkbench.roi.importedMask') }}
        <span class="font-mono font-normal text-base-content/60"
          >{{ activeCount }}/{{ importedMasks.length }}</span
        >
      </h3>
      <div class="stat-list space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
        <div
          v-for="m in importedMasks"
          :key="m.id"
          class="stat-card rounded-lg border border-dashed px-2 py-1.5"
          :style="{
            borderColor: cssWithAlpha(m.color, 0.4),
            background: cssWithAlpha(m.color, 0.03),
          }"
        >
          <div class="flex items-center gap-1.5">
            <label
              class="flex items-center gap-1.5 min-w-0 cursor-pointer select-none"
              :title="
                m.active
                  ? $t('vizworkbench.mask.showOriginalHint')
                  : $t('vizworkbench.mask.applyMaskHint')
              "
            >
              <input
                type="checkbox"
                class="checkbox checkbox-xs checkbox-primary shrink-0"
                :checked="m.active"
                @change="$emit('toggle-imported-mask', m.id)"
              />
              <span class="font-semibold truncate" :style="{ color: m.color }" :title="m.name">
                {{ m.name }}
              </span>
            </label>
            <span :class="[TAG_CLASS, 'uppercase', { 'opacity-50': !m.active }]">{{
              m.format
            }}</span>
            <span class="ml-auto shrink-0 font-mono kawaru-text-62 text-base-content/60">{{
              pixelCountLabel(m.summary.pixelCount)
            }}</span>
            <button
              class="shrink-0 text-base-content hover:text-error"
              :title="$t('vizworkbench.mask.removeImport')"
              @click="$emit('remove-imported-mask', m.id)"
            >
              <SvgIcon type="trash" />
            </button>
          </div>
          <dl v-if="m.summary.stats" class="stat-strip mt-1">
            <div v-for="cell in statCells(m.summary.stats)" :key="cell.key" class="min-w-0">
              <dt class="truncate kawaru-text-62 text-base-content/50">{{ cell.label }}</dt>
              <dd class="truncate font-mono" :title="cell.value">{{ cell.value }}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>

    <div v-if="!rois.length && !importedMasks?.length && !selectedTool" class="text-base-content">
      {{ $t('vizworkbench.roi.empty') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import SectionHelp from '@/features/vizworkbench/components/SectionHelp.vue'
import { cssWithAlpha } from '@/features/vizworkbench/utils/regionPalette'
import type { ConfirmedROI } from '@/features/vizworkbench/composables/useROI'
import type { ImportedMask } from '@/features/vizworkbench/composables/useImportedMasks'
import { t } from '@/i18n'

const props = defineProps<{
  selectedTool: string | null
  draftReady: boolean
  rois: ConfirmedROI[]
  /** When true, the ion image is filtered to the ROI union ("ROI only"). */
  viewingRoi: boolean
  /** 共享选中集（null = 全选）：勾选驱动主图高亮 + 导出掩膜 */
  selectedRoiIds: Set<string> | null
  /** 文件导入的掩膜列表（独立于 rois；勾选 = 应用过滤，trash = 移除导入） */
  importedMasks?: ImportedMask[]
}>()

const emit = defineEmits<{
  (e: 'update:selectedTool', v: string | null): void
  (e: 'confirm'): void
  (e: 'cancel'): void
  (e: 'delete', id: string): void
  (e: 'clearAll'): void
  (e: 'remove-imported-mask', id: string): void
  (e: 'toggle-imported-mask', id: string): void
  (e: 'update:viewingRoi', v: boolean): void
  (e: 'toggle-selection', id: string): void
  (e: 'select-all'): void
  (e: 'deselect-all'): void
}>()

function isSelected(id: string): boolean {
  return props.selectedRoiIds === null || props.selectedRoiIds.has(id)
}

// Count by filtering rois (never Set.size) — the set can hold ids of deleted
// ROIs, which must not inflate the count.
const selectedCount = computed(() => props.rois.filter((r) => isSelected(r.id)).length)

const allSelected = computed(
  () => props.rois.length > 0 && selectedCount.value === props.rois.length,
)

function toggleAll() {
  if (allSelected.value) emit('deselect-all')
  else emit('select-all')
}

// 正在应用过滤（active）的导入掩膜数，用于「x/y」计数展示。
const activeCount = computed(() => props.importedMasks?.filter((m) => m.active).length ?? 0)

function fmt(v: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1e6) return v.toExponential(1)
  if (Math.abs(v) >= 1e3) return v.toExponential(1)
  if (Math.abs(v) < 0.01) return v.toExponential(2)
  return v.toFixed(2)
}

/** 卡片标题行里的小标签：ROI 的形状、导入掩膜的文件格式 */
const TAG_CLASS =
  'card-tag shrink-0 rounded border border-base-content/20 px-1 kawaru-text-56 text-base-content/60'

// 模板渲染时调用 t()，切换语言会随之重算。千分位固定用 en-US，不随浏览器区域变成「1.346」。
function pixelCountLabel(n: number): string {
  return t('vizworkbench.roi.pixelCount', { n: n.toLocaleString('en-US') })
}

/** 卡片第二行的强度统计条：均值 / 标准差 / 最小 / 最大 */
function statCells(s: { mean: number; std: number; min: number; max: number }) {
  return [
    { key: 'mean', label: t('vizworkbench.roi.mean'), value: fmt(s.mean) },
    { key: 'std', label: t('vizworkbench.roi.std'), value: fmt(s.std) },
    { key: 'min', label: t('vizworkbench.roi.min'), value: fmt(s.min) },
    { key: 'max', label: t('vizworkbench.roi.max'), value: fmt(s.max) },
  ]
}
</script>

<style scoped>
/* 统计条按卡片自身宽度（容器查询）排版，不看视口：
   - 够宽：一行四个等宽列，首列靠左、末列靠右、中间居中，左右两端与标题行对齐，列跨卡片对齐；
   - 窄（左侧注释栏展开后右栏只剩约 225px）：两行两列，左列靠左、右列靠右，
     免得 7.85e-3 这类 7 位数值被截断。 */
/* 列表一直预留滚动条位置：否则两行两列让列表变高、出现滚动条、卡片变窄，
   会把卡片卡在两列（容器查询看的是当前宽度）。悬浮式滚动条下没有影响。 */
.stat-list {
  scrollbar-gutter: stable;
}

.stat-card {
  container-type: inline-size;
}

.stat-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem 0.5rem;
}

.stat-strip > :nth-child(odd) {
  text-align: left;
}

.stat-strip > :nth-child(even) {
  text-align: right;
}

/* 18em ≈ 四个 7 位等宽数值（每个约 4.2em）加三道 0.25rem 列间距；em 取卡片字号，
   随站点字号档位缩放。四列靠首尾对齐拉开间距，列间距只防止数值贴在一起。 */
@container (min-width: 18em) {
  .stat-strip {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0 0.25rem;
  }

  .stat-strip > :nth-child(n) {
    text-align: center;
  }

  .stat-strip > :first-child {
    text-align: left;
  }

  .stat-strip > :last-child {
    text-align: right;
  }
}

/* 卡片极窄时标题行放不下名字 + 标签 + 像素数：标签让位，保证名字完整
   （ROI 形状在图上的轮廓里看得到，导入掩膜的格式在文件名后缀里） */
@container (max-width: 15em) {
  .card-tag {
    display: none;
  }
}
</style>
