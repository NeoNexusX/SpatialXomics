<template>
  <!-- Step 2 已选区卡片：序号 + 拖拽手柄 + 缩略图 + 名称/元信息 + 上移/下移 + 移除。
       拖拽为 HTML5 DnD 的「手柄武装」模式：只有按住手柄 pointerdown 后行才
       draggable，行内其他区域（按钮/文本）不受影响。触屏/键盘走上移/下移按钮。 -->
  <section
    class="bg-base-100 dark:bg-slate-800 rounded-xl shadow-sm border border-base-300 p-4 sm:p-6"
  >
    <div class="flex items-center justify-between gap-3 mb-4">
      <h2 class="kawaru-text-125 font-bold text-base-content flex items-center gap-2">
        {{ $t('collections.selected.step2') }}
        <span
          v-if="selected.length"
          class="badge badge-sm font-medium border border-base-300 bg-base-200 text-base-content/70 kawaru-text-75"
        >
          {{ selected.length }}/{{ limit }} {{ $t('collections.unit.dataset', selected.length) }}
        </span>
      </h2>
      <button
        v-if="selected.length"
        class="btn btn-ghost btn-sm kawaru-text-95 text-error"
        @click="emit('clear-all')"
      >
        <SvgIcon type="trash" class="w-[1em] h-[1em]" />
        {{ $t('common.action.clearAll') }}
      </button>
    </div>

    <div
      v-if="selected.length"
      class="flex flex-col gap-1 border border-base-200 dark:border-slate-700 rounded-md p-2"
    >
      <div class="kawaru-text-87"
        v-for="(dataset, i) in selected"
        :key="dataset.publicId"
        :draggable="armed"
        :class="[
          'relative px-3 py-2 rounded-lg flex items-center gap-3 select-none transition-opacity',
          dragFrom === i ? 'opacity-40' : '',
          dragOver === i && dragFrom !== i ? 'border-t-2 border-t-primary' : '',
        ]"
        @dragstart="onDragStart($event, i)"
        @dragover.prevent="dragOver = i"
        @drop.prevent="onDrop"
        @dragend="resetDrag"
      >
        <!-- 序号 -->
        <span class="w-6 text-center tabular-nums text-base-content/50 kawaru-text-95 shrink-0">
          {{ i + 1 }}
        </span>

        <!-- 拖拽手柄：pointerdown 武装 draggable，dragstart 前生效 -->
        <div
          class="shrink-0 cursor-grab active:cursor-grabbing text-base-content/40 hover:text-base-content/70 p-1"
:title="$t('collections.selected.dragHint')"
          aria-hidden="true"
          @pointerdown="arm"
        >
          <SvgIcon type="bars3" class="w-[1em] h-[1em]" />
        </div>

        <div class="w-10 h-10 shrink-0">
          <DatasetThumb :image-path="dataset.imagePath" :alt="$t('collections.picker.previewAlt', { name: dataset.name })" />
        </div>

        <div class="flex-1 min-w-0">
          <div class="font-medium truncate text-base-content" :title="dataset.name">
            {{ dataset.name }}
          </div>
          <div class="kawaru-text-87 text-base-content/60 truncate">
            {{ [vocabLabel(dataset.organism), dataset.submitter].filter(Boolean).join(' · ') || '–' }}
          </div>
        </div>

        <!-- 上移/下移：触屏与键盘可用的排序通道，边界禁用 -->
        <div class="flex items-center gap-1 shrink-0">
          <button
            class="btn btn-ghost btn-sm btn-square kawaru-text-100"
:title="$t('collections.selected.moveUp')"
            :disabled="i === 0"
            :aria-label="$t('collections.selected.moveUpAria', { name: dataset.name })"
            @click="emit('move-up', i)"
          >
            <SvgIcon type="chevron_up" class="w-[1em] h-[1em]" />
          </button>
          <button
            class="btn btn-ghost btn-sm btn-square kawaru-text-100"
:title="$t('collections.selected.moveDown')"
            :disabled="i === selected.length - 1"
            :aria-label="$t('collections.selected.moveDownAria', { name: dataset.name })"
            @click="emit('move-down', i)"
          >
            <SvgIcon type="chevron_down" class="w-[1em] h-[1em]" />
          </button>
          <button
            class="btn btn-ghost btn-sm btn-square kawaru-text-100 text-error"
:title="$t('collections.selected.removeTitle')"
            :aria-label="$t('collections.selected.removeAria', { name: dataset.name })"
            @click="emit('remove', dataset.publicId)"
          >
            <SvgIcon type="close" class="w-[1em] h-[1em]" />
          </button>
        </div>
      </div>
    </div>

    <!-- 空态 -->
    <div
      v-else
      class="border-2 border-dashed border-base-300 dark:border-slate-600 rounded-lg p-8 text-center text-base-content/50"
    >
      <SvgIcon type="queue_list" class="h-10 w-10 mx-auto mb-3 text-base-content/30" />
      <p>{{ $t('collections.selected.empty') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { PropType } from 'vue'
import DatasetThumb from '@/features/collections/components/DatasetThumb.vue'
import { useDragReorder } from '@/features/collections/composables/useDragReorder'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import type { File } from '@/features/datasets/types/dataset'
import { COLLECTION_MEMBER_LIMIT } from '../constants/collectionLimits'

defineProps({
  selected: { type: Array as PropType<File[]>, required: true },
  /** 成员上限（后端写入校验），徽标显示为 N/上限；创建页的拦截在 useCreateCollection 里 */
  limit: { type: Number, default: COLLECTION_MEMBER_LIMIT },
})

const emit = defineEmits<{
  (e: 'reorder', from: number, to: number): void
  (e: 'move-up', index: number): void
  (e: 'move-down', index: number): void
  (e: 'remove', publicId: string): void
  (e: 'clear-all'): void
}>()

// ---- 拖拽状态：手柄武装模式的 DnD 调序（useDragReorder 共用逻辑）----
const { armed, arm, dragFrom, dragOver, onDragStart, onDrop, resetDrag } = useDragReorder(
  (from, to) => emit('reorder', from, to),
)
</script>
