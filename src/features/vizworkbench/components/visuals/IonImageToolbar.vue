<template>
  <div class="flex flex-wrap items-center gap-3 mb-1 pt-1">
    <h3 class="kawaru-text-100 font-semibold">{{ title }}</h3>
    <!-- 右侧控件组统一 kawaru-text-81；daisyUI 的 select/btn 自带 font-size，
         不继承，仍需各自显式挂档位。 -->
    <div class="ml-auto flex flex-wrap items-center gap-2 kawaru-text-81">
      <!-- m/z 搜索（continuous 模式）：可填写目标值，Search/回车命中最近的峰；
           悬停显示更高精度的当前值 -->
      <template v-if="dataMode === 'continuous'">
        <div
          class="bg-base-100 border border-base-300 rounded-lg px-3 py-1 h-8 flex items-center"
          :title="`m/z ${selectedMz.toFixed(8)}`"
        >
          <span class="text-base-content/50 pr-[0.5em]"><i>m/z</i></span>
          <input
            data-testid="selected-mz"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            spellcheck="false"
            class="bg-transparent outline-none w-28 font-mono font-semibold"
            :value="mzInput"
            @input="onMzInput"
            @blur="onMzBlur"
            @keydown.enter.prevent="onSearchMz"
          />
        </div>
        <button
          class="btn btn-fluid btn-ghost"
          :title="$t('vizworkbench.toolbar.searchHint')"
          @click="onSearchMz"
        >
          {{ $t('common.action.search') }}
        </button>
      </template>
      <!-- 像素坐标显示（processed 模式） -->
      <div
        v-if="dataMode === 'processed' && pixelCoord"
        class="bg-base-100 border border-base-300 rounded-lg px-3 py-1 h-8 flex items-center"
      >
        <span class="text-base-content/50 pr-[0.25em]">{{
          $t('vizworkbench.spectrum.pixel')
        }}</span>
        <span class="font-mono font-semibold">({{ pixelCoord.x }}, {{ pixelCoord.y }})</span>
      </div>
      <!-- m/z 容差（仅 continuous 模式） -->
      <div v-if="dataMode === 'continuous'" class="flex items-center gap-1">
        <span class="text-base-content/50">{{ $t('vizworkbench.toolbar.tolerance') }}</span>
        <input
          type="text"
          inputmode="decimal"
          autocomplete="off"
          spellcheck="false"
          class="input input-sm input-bordered w-24 font-mono kawaru-text-81"
          :value="mzTolerance"
          @input="onToleranceInput"
          @blur="onToleranceBlur"
        />
      </div>
      <!-- Colormap（两种模式都可用；多离子叠加时置灰，颜色由通道决定）。
           紧凑宽度随字号缩放，并为色图名称和箭头保留空间。 -->
      <select
        data-testid="colormap-select"
        class="select select-fluid select-bordered w-[7em]"
        :class="{ 'opacity-50': channelsMode }"
        :disabled="channelsMode"
        :title="channelsMode ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
        :value="colormap"
        @change="$emit('update:colormap', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="c in COLORMAPS" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
      <!-- 强度标度：TIC 归一化仅 continuous 模式（processed 本身就是 TIC 图） -->
      <div class="flex items-center gap-1.5">
        <span v-if="normalizationLoading" class="loading loading-spinner loading-xs"></span>
        <!-- TIC 使用简短标签，宽度仍容纳英文 Linear 和下拉箭头。 -->
        <select
          data-testid="intensity-scale-select"
          class="select select-fluid select-bordered w-[6.5em]"
          :class="[normalizationError ? 'select-error' : '', channelsMode ? 'opacity-50' : '']"
          :disabled="channelsMode"
          :title="
            channelsMode
              ? $t('vizworkbench.ionImage.rangeDisabled')
              : normalizationError
                ? $t('vizworkbench.toolbar.normalizationFailed', { error: normalizationError })
                : undefined
          "
          :value="intensityScale"
          @change="$emit('update:intensityScale', ($event.target as HTMLSelectElement).value)"
        >
          <option value="linear">{{ $t('vizworkbench.toolbar.linear') }}</option>
          <option value="log">{{ $t('vizworkbench.toolbar.log') }}</option>
          <option
            v-if="dataMode === 'continuous' && hasTic"
            value="tic"
            :title="$t('vizworkbench.toolbar.ticNormHint')"
          >
            {{ $t('vizworkbench.toolbar.ticNorm') }}
          </option>
        </select>
      </div>
      <button
        class="btn btn-fluid btn-ghost"
        :class="{ 'opacity-50': channelsMode }"
        :disabled="channelsMode"
        :title="channelsMode ? $t('vizworkbench.ionImage.rangeDisabled') : undefined"
        @click="$emit('reset')"
      >
        {{ $t('common.action.reset') }}
      </button>
      <button
        class="btn btn-fluid btn-ghost"
        :title="$t('vizworkbench.toolbar.exportPng')"
        @click="$emit('download')"
      >
        <SvgIcon type="download" />
        PNG
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { DataMode } from '@/services/zarr/types/zarr'
import { ZARR_STORE } from '@/shared/config/defaults'
import SvgIcon from '@/shared/components/SvgIcon.vue'

/** 可选色图：value 传给 zarr 渲染，label 用于展示（色图是专有名称，各语言都显示英文原名） */
const COLORMAPS = [
  { value: 'viridis', label: 'Viridis' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'magma', label: 'Magma' },
  { value: 'hot', label: 'Hot' },
  { value: 'gray', label: 'Gray' },
] as const
const props = defineProps<{
  selectedMz: number
  mzTolerance: number
  colormap: string
  intensityScale: string
  /** 数据模式 */
  dataMode?: DataMode | null
  /** 当前选中像素坐标（processed 模式） */
  pixelCoord?: { x: number; y: number } | null
  /** TIC 归一化计算中（读取 stats/tic，通常很快） */
  normalizationLoading?: boolean
  /** 归一化计算失败的原因（保留原图并提示） */
  normalizationError?: string | null
  /** zarr 是否预存 stats/tic（TIC 归一化的唯一数据源） */
  hasTic?: boolean
  /** 多离子叠加模式：colormap / 强度标度 / Reset 不适用，置灰但保留 */
  channelsMode?: boolean
  /** 工具栏标题 */
  title?: string
}>()

const emit = defineEmits<{
  (e: 'update:mzTolerance', v: number): void
  (e: 'update:colormap', v: string): void
  (e: 'update:intensityScale', v: string): void
  (e: 'search-mz', v: string): void
  (e: 'reset'): void
  (e: 'download'): void
}>()

// ---- m/z 搜索框 ----

/** 输入框内容：默认随 selectedMz 同步（谱图点击/搜索命中后刷新），
 *  用户键入的值保留为待搜索内容。 */
const mzInput = ref(props.selectedMz.toFixed(6))

watch(
  () => props.selectedMz,
  (v) => {
    mzInput.value = v.toFixed(6)
  },
)

function onMzInput(e: Event) {
  mzInput.value = (e.target as HTMLInputElement).value
}

/** 失焦时仅修正空/非法输入（含 Number('') === 0 的清空场景）：
 *  合法数值保留，避免 blur 先于 Search 的 click 触发把待搜索值冲掉。 */
function onMzBlur() {
  const raw = Number(mzInput.value)
  if (!(raw > 0)) mzInput.value = props.selectedMz.toFixed(6)
}

/** 发起搜索：解析、最近峰命中与容差判定在父级完成（需要 m/z 轴与 tolerance）。
 *  emit 后父级会同步更新 selectedMz（loadForMzIndex 在首个 await 前赋值索引），
 *  nextTick 强制回显实际命中值——命中的就是当前峰时 selectedMz 不变、
 *  watch 不触发，输入框会停留在用户的查询文本（如搜 445.0497 命中
 *  445.0494）；命中其他峰时 watch 也会同步，两种情况都收敛到实际值。 */
function onSearchMz() {
  emit('search-mz', mzInput.value)
  void nextTick(() => {
    mzInput.value = props.selectedMz.toFixed(6)
  })
}

/** 容差钳位到 [min, max] 的公共逻辑 */
function clampTolerance(raw: number) {
  return Math.min(ZARR_STORE.maxMzTolerance, Math.max(ZARR_STORE.minMzTolerance, raw))
}

/**
 * 容差输入钳位到 [min, max]。
 * 注意 Number('') === 0（不是 NaN），若直接 clamp 会把清空输入误判为 0 而跳到 min；
 * 因此非正数（空、'0'、'0.'、负数、NaN）一律不 emit，保持上一次有效值，
 * 避免输入过程中触发不必要的图像重载。
 */
function onToleranceInput(e: Event) {
  const raw = Number((e.target as HTMLInputElement).value)
  if (!(raw > 0)) return
  emit('update:mzTolerance', clampTolerance(raw))
}

/** 失焦时校验：清空/非法输入回退到默认容差（0.0001），合法值则钳位后同步显示 */
function onToleranceBlur(e: Event) {
  const el = e.target as HTMLInputElement
  const raw = Number(el.value)
  const v = raw > 0 ? clampTolerance(raw) : ZARR_STORE.defaultMzTolerance
  el.value = String(v)
  emit('update:mzTolerance', v)
}
</script>

<style scoped>
/* daisyUI 的 btn-xs…btn-xl 用 rem 推导高度与内边距（--size-field），字号变了尺寸不跟。
   这里把尺寸全改成 em，让按钮随自身字号等比缩放；比例沿用 btn-sm（2 / 0.75）。
   与 .btn 并用（它仍提供配色/圆角/交互），但不要再叠加 btn-sm 等档位类。 */
.btn-fluid {
  height: 2em;
  min-height: 1rem;
  padding-inline: 0.75em;
  font-size: calc(var(--kawaru-fs) * 0.8125);
  gap: 0.1em;
}

/* select 版的流体尺寸，高度与 .btn-fluid 对齐。
   .select 的下拉箭头是 background-image，靠右侧内边距让位、靠 background-position
   定位（默认 .75rem/1.75rem 与 20px/16.1px 都是绝对值），所以这三项要一并改成 em，
   否则缩放时文字会顶到箭头上。
   换算基准是 .select 自带的 .875rem = 14px，四个值都要除以它——注意右内边距
   1.75rem ÷ 14px = 2em（不是 1.75em）。写成 1.75em 会让文字右界落在 1.75em，
   而箭头左端在 1.4286 + 0.2857 = 1.7143em，仅剩 0.036em 间隙，文字一贴边就糊上箭头。
   2em 还原了原设计 4px（0.286em）的安全间距。 */
.select-fluid {
  height: 2em;
  min-height: 1rem;
  padding-inline: 0.75em 2em;
  font-size: calc(var(--kawaru-fs) * 0.8125);
  background-position:
    calc(100% - 1.4286em) calc(1px + 50%),
    calc(100% - 1.15em) calc(1px + 50%);
  background-size:
    0.2857em 0.2857em,
    0.2857em 0.2857em;
}
</style>
