<script setup lang="ts">
/**
 * 注释表格（虚拟滚动，行高固定）。一行 = 一个加合离子，只放判断要用的信息：
 *   第 1 行：名称（+N 个候选）· 同峰多解释 ⚠ · q（按档位着色）
 *   第 2 行：加合物 · 实测 m/z · ppm · 同分子其他加合离子的小标签（点击跳转）
 * 分子式、总分、分数拆解等放在详情卡里。悬停一行显示详情卡，并浅色高亮同分子的
 * 其他行；详情卡可以钉住。
 */
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import PubChemDialog from '@/features/vizworkbench/components/PubChemDialog.vue'
import AnnotationDetailCard from '@/features/vizworkbench/components/annotation/AnnotationDetailCard.vue'
import { ANNOTATION_KEY } from '@/features/vizworkbench/composables/useAnnotation'
import {
  adductDisplay,
  adductShort,
  fmtMz,
  fmtPpm,
  fmtQ,
  fmtScore,
  moleculeName,
  qLevelClass,
  siblingIons,
} from '@/features/vizworkbench/utils/annotation/format'
import type { IonAnnotation } from '@/features/vizworkbench/types/annotation'

const ROW_H = 70
const OVERSCAN = 8
/** 行内最多显示几个同分子离子标签 */
const MAX_SIBLING_CHIPS = 2

const ann = inject(ANNOTATION_KEY)!
const {
  rows,
  ionById,
  molecules,
  selectedIonId,
  selectedMzIndex,
  hoverMoleculeId,
  scrollRequest,
  hiddenJumpId,
  selectIon,
  jumpToIon,
  revealHiddenJump,
  pairRFor,
  prioritize,
} = ann

// ---- 虚拟滚动 ----
const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(400)

const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN))
const end = computed(() =>
  Math.min(rows.value.length, Math.ceil((scrollTop.value + viewportH.value) / ROW_H) + OVERSCAN),
)
/** 渲染窗口内的行，连同分子和同分子的其他离子 */
const visible = computed(() =>
  rows.value.slice(start.value, end.value).map((ion) => {
    const mol = molecules.value.get(ion.moleculeId)
    return { ion, mol, sibs: siblingIons(ion, molecules.value, ionById.value) }
  }),
)

watch(
  scrollEl,
  (el, _prev, onCleanup) => {
    if (!el) return
    viewportH.value = el.clientHeight
    const ro = new ResizeObserver(() => (viewportH.value = el.clientHeight))
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  },
  { flush: 'post' },
)

let bumpTimer: ReturnType<typeof setTimeout> | null = null
function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement).scrollTop
  if (!pinned.value) hideCard()
  // 滚到的行优先补空间评分（节流）
  bumpTimer ??= setTimeout(() => {
    bumpTimer = null
    prioritize(visible.value.map((r) => r.ion.id))
  }, 300)
}

// 跳转：把目标行滚到视口中间
watch(scrollRequest, async (req) => {
  if (!req) return
  await nextTick()
  const el = scrollEl.value
  const idx = rows.value.findIndex((r) => r.id === req.id)
  if (!el || idx < 0) return
  el.scrollTop = Math.max(0, idx * ROW_H - el.clientHeight / 2 + ROW_H / 2)
})

// ---- 行样式 ----
function chipClass(ion: IonAnnotation, sib: IonAnnotation): string {
  const r = pairRFor(ion, sib)
  if (r == null) return 'badge-ghost'
  if (r >= 0.7) return 'badge-success badge-outline'
  return r < 0.4 ? 'badge-ghost opacity-60' : 'badge-ghost'
}

function rowClass(ion: IonAnnotation): string {
  if (ion.id === selectedIonId.value) return 'bg-primary/20'
  if (ion.axisIndex === selectedMzIndex.value) return 'bg-primary/10'
  if (ion.moleculeId === hoverMoleculeId.value) return 'bg-accent/10'
  return 'hover:bg-base-200/70'
}

// ---- 详情卡（悬停显示，可钉住） ----
/** 悬停多久后弹出：鼠标扫过表格或斜着移向卡片时，经过的行不会把卡片切走 */
const CARD_SHOW_DELAY = 1000
/** 离开行或卡片后多久收起：留出把鼠标移到卡片上的时间 */
const CARD_HIDE_DELAY = 300
// 宽度跟着内容走，只限制上下限：上限再取面板旁边实际剩余的空间
const CARD_MIN_W = 300
const CARD_MAX_W = 480
const GAP = 8
const cardIonId = ref<number | null>(null)
const cardStyle = ref<Record<string, string>>({})
const pinned = ref(false)
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

const cardIon = computed(() =>
  cardIonId.value != null ? (ionById.value.get(cardIonId.value) ?? null) : null,
)

function clearTimers() {
  if (showTimer) clearTimeout(showTimer)
  if (hideTimer) clearTimeout(hideTimer)
  showTimer = hideTimer = null
}

/**
 * 卡片优先放在面板右侧；右侧放不下最小宽度时放左侧，用 right 定位，卡片从面板边缘
 * 向外长，不需要预先知道实际宽度；两侧都放不下（小屏）时贴视口左边。纵向对齐悬停的行。
 */
function placeCard(rowEl: HTMLElement) {
  const rect = rowEl.getBoundingClientRect()
  const panel = rowEl.closest('aside')?.getBoundingClientRect() ?? rect
  const vw = window.innerWidth
  const roomRight = vw - panel.right - 2 * GAP
  const roomLeft = panel.left - 2 * GAP
  const top = `${Math.max(GAP, Math.min(rect.top, window.innerHeight * 0.3))}px`
  let pos: Record<string, string>
  let room: number
  if (roomRight >= CARD_MIN_W) {
    pos = { left: `${panel.right + GAP}px` }
    room = roomRight
  } else if (roomLeft >= CARD_MIN_W) {
    pos = { right: `${vw - panel.left + GAP}px` }
    room = roomLeft
  } else {
    pos = { left: `${GAP}px` }
    room = vw - 2 * GAP
  }
  const maxW = Math.min(CARD_MAX_W, room)
  cardStyle.value = {
    ...pos,
    top,
    maxWidth: `${maxW}px`,
    minWidth: `${Math.min(CARD_MIN_W, maxW)}px`,
  }
}

function onRowEnter(ion: IonAnnotation, e: MouseEvent) {
  hoverMoleculeId.value = ion.moleculeId
  prioritize([ion.id])
  if (pinned.value) return
  clearTimers()
  const el = e.currentTarget as HTMLElement
  showTimer = setTimeout(() => {
    cardIonId.value = ion.id
    placeCard(el)
  }, CARD_SHOW_DELAY)
}

function onRowLeave() {
  hoverMoleculeId.value = null
  if (showTimer) clearTimeout(showTimer)
  showTimer = null
  if (!pinned.value) hideTimer = setTimeout(hideCard, CARD_HIDE_DELAY)
}

function onCardEnter() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
}

function onCardLeave() {
  if (!pinned.value) hideTimer = setTimeout(hideCard, CARD_HIDE_DELAY)
}

function hideCard() {
  clearTimers()
  cardIonId.value = null
  pinned.value = false
}

/** 卡片里的跳转：钉住时卡片跟着切到目标行 */
function onCardJump(id: number) {
  jumpToIon(id)
  if (pinned.value) cardIonId.value = id
}

// ---- PubChem ----
const pubchemOpen = ref(false)
const pubchemQuery = ref('')
function openPubChem(query: string) {
  pubchemQuery.value = query
  pubchemOpen.value = true
}

onUnmounted(() => {
  clearTimers()
  if (bumpTimer) clearTimeout(bumpTimer)
})
</script>

<template>
  <div
    class="flex max-h-[60dvh] min-h-0 flex-col overflow-hidden rounded-lg border border-base-300 lg:max-h-none lg:flex-1"
  >
    <!-- 跳转目标被筛选隐藏 -->
    <button
      v-if="hiddenJumpId != null"
      class="shrink-0 bg-warning/15 px-2 py-1 text-left kawaru-text-56 text-warning"
      @click="revealHiddenJump"
    >
      {{ $t('vizworkbench.annotation.hiddenJump') }}
    </button>

    <div ref="scrollEl" class="min-h-0 flex-1 overflow-auto" @scroll.passive="onScroll">
      <div :style="{ height: start * ROW_H + 'px' }" aria-hidden="true"></div>
      <div
        v-for="{ ion, mol, sibs } in visible"
        :key="ion.id"
        :data-ion-id="ion.id"
        class="flex cursor-pointer flex-col justify-center gap-2 border-b border-base-content/20 px-4"
        :class="rowClass(ion)"
        :style="{ height: ROW_H + 'px' }"
        @click="selectIon(ion)"
        @mouseenter="onRowEnter(ion, $event)"
        @mouseleave="onRowLeave"
      >
        <div class="flex min-w-0 items-center gap-2 kawaru-text-75">
          <span class="min-w-0 truncate font-medium text-base-content kawaru-text-81">
            {{ moleculeName(mol) }}
          </span>
          <span
            v-if="(mol?.candidates.length ?? 0) > 1"
            class="shrink-0 kawaru-text-56 text-base-content/40"
          >
            +{{ mol!.candidates.length - 1 }}
          </span>
          <span
            v-if="ion.samePeak.length"
            class="shrink-0 text-base-content/60"
            :title="$t('vizworkbench.annotation.samePeakHint', { count: ion.samePeak.length })"
          >
            <SvgIcon type="layers" class="h-4 w-4" />
          </span>
          <span
            class="ml-auto shrink-0 font-mono kawaru-text-68"
            :class="qLevelClass(ion.q)"
            :title="
              $t('vizworkbench.annotation.rowScoreHint', { score: fmtScore(ion.scores.total) })
            "
          >
            {{ $t('vizworkbench.annotation.qValue', { value: fmtQ(ion.q) }) }}
          </span>
        </div>
        <div class="flex min-w-0 items-center gap-2 font-mono kawaru-text-62 text-base-content/50">
          <span class="shrink-0 text-base-content/80">{{ adductDisplay(ion.adduct) }}</span>
          <span class="min-w-0 truncate"
            >{{ fmtMz(ion.obsMz) }} · {{ fmtPpm(ion.errPpm) }} ppm</span
          >
          <span v-if="sibs.length" class="ml-auto flex shrink-0 items-center gap-1">
            <button
              v-for="sib in sibs.slice(0, MAX_SIBLING_CHIPS)"
              :key="sib.id"
              class="badge h-auto px-2 py-0.5 font-mono kawaru-text-56"
              :class="chipClass(ion, sib)"
              :title="`${adductDisplay(sib.adduct)} ${fmtMz(sib.obsMz)} · ${$t('vizworkbench.annotation.jump')}`"
              @click.stop="jumpToIon(sib.id)"
            >
              {{ adductShort(sib.adduct) }}
            </button>
            <span v-if="sibs.length > MAX_SIBLING_CHIPS"
              >+{{ sibs.length - MAX_SIBLING_CHIPS }}</span
            >
          </span>
        </div>
      </div>
      <div
        :style="{ height: Math.max(0, rows.length - end) * ROW_H + 'px' }"
        aria-hidden="true"
      ></div>
      <p v-if="!rows.length" class="p-4 text-center kawaru-text-56 text-base-content/50">
        {{ $t('vizworkbench.annotation.noRowsMatch') }}
      </p>
    </div>
  </div>

  <Teleport to="body">
    <AnnotationDetailCard
      v-if="cardIon"
      :ion="cardIon"
      :pinned="pinned"
      class="fixed z-[60]"
      :style="cardStyle"
      @mouseenter="onCardEnter"
      @mouseleave="onCardLeave"
      @toggle-pin="pinned = !pinned"
      @close="hideCard"
      @jump="onCardJump"
      @pubchem="openPubChem"
    />
  </Teleport>
  <PubChemDialog :open="pubchemOpen" :query="pubchemQuery" @close="pubchemOpen = false" />
</template>
