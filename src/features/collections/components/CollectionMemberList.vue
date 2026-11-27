<template>
  <!-- 集合成员列表：行 = 缩略图 + 文件名 + 大小 + 下载。
       manageMode（owner/admin）下额外提供：Add Members 按钮、行复选多选 +
       Remove Selected（批量移除）。调序（手柄拖拽 + 上移/下移，全量重写语义）
       更进一步只在 editMode（页头 Edit 进入编辑态）时出现——浏览态不打扰。
       只读模式（公开页/非 owner）隐藏全部管理控件。 -->
  <section
    class="bg-base-100 dark:bg-slate-800 rounded-xl shadow-sm border border-base-300 p-4 sm:p-6"
  >
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h2 class="kawaru-text-125 font-bold text-base-content flex items-center gap-2">
        {{ $t('collections.members.title') }}
        <span
          v-if="members.length"
          class="badge badge-sm font-medium border border-base-300 bg-base-200 text-base-content/70 kawaru-text-75"
        >
          {{ $t('collections.members.countBadge', { count: members.length, limit }) }}
        </span>
      </h2>

      <!-- 管理工具条 -->
      <div v-if="manageMode" class="flex flex-wrap items-center gap-2">
        <button
          class="btn btn-sm btn-primary kawaru-text-95"
          :disabled="adding"
          @click="emit('add')"
        >
          <SvgIcon v-if="!adding" type="plus" class="w-[1em] h-[1em]" />
          <span v-else class="loading loading-spinner loading-xs"></span>
          {{ $t('collections.members.add') }}
        </button>
        <button
          class="btn btn-sm btn-outline border-base-300 text-error kawaru-text-95"
          :disabled="!selectedIds.size || removing"
          @click="confirmRemove"
        >
          <SvgIcon type="trash" class="w-[1em] h-[1em]" />
          {{
            selectedIds.size
              ? $t('collections.members.removeSelectedCount', { count: selectedIds.size })
              : $t('collections.members.removeSelected')
          }}
        </button>
      </div>
    </div>

    <div v-if="members.length" class="flex flex-col gap-1 border border-base-200 dark:border-slate-700 rounded-md p-2">
      <div class="kawaru-text-100"
        v-for="(member, i) in members"
        :key="member.publicId"
        :draggable="editMode && armed"
        :class="[
          'relative px-3 py-3 rounded-lg flex items-center gap-4 select-none transition-opacity',
          manageMode ? 'cursor-default' : '',
          dragFrom === i ? 'opacity-40' : '',
          dragOver === i && dragFrom !== i ? 'border-t-2 border-t-primary' : '',
        ]"
        @dragstart="editMode && onDragStart($event, i)"
        @dragover.prevent="editMode && (dragOver = i)"
        @drop.prevent="editMode && onDrop()"
        @dragend="editMode && resetDrag()"
      >
        <!-- 多选框（仅管理模式） -->
        <input
          v-if="manageMode"
          type="checkbox"
          class="checkbox checkbox-sm checkbox-primary shrink-0"
          :checked="selectedIds.has(member.publicId)"
          :aria-label="$t('collections.picker.selectAria', { name: member.filename })"
          @change="toggleSelect(member.publicId)"
        />

        <!-- 序号 + 拖拽手柄（编辑态才有手柄） -->
        <span class="w-6 text-center tabular-nums text-base-content/50 kawaru-text-95 shrink-0">
          {{ i + 1 }}
        </span>
        <div
          v-if="editMode"
          class="shrink-0 cursor-grab active:cursor-grabbing text-base-content/40 hover:text-base-content/70 p-1"
:title="$t('collections.selected.dragHint')"
          aria-hidden="true"
          @pointerdown="arm"
        >
          <SvgIcon type="bars3" class="w-[1em] h-[1em]" />
        </div>

        <!-- 缩略图：16（64px）——40px 太小看不清组织结构 -->
        <div class="w-16 h-16 shrink-0">
          <DatasetThumb :image-path="member.imagePath" :alt="$t('collections.picker.previewAlt', { name: member.filename })" />
        </div>

        <div class="flex-1 min-w-0">
          <div class="font-medium truncate text-base-content" :title="member.filename">
            {{ member.filename }}
          </div>
          <div class="kawaru-text-95 text-base-content/60 truncate">
            {{ [member.experimentType, statusLabel(member.status)].filter(Boolean).join(' · ') || '–' }}
          </div>
        </div>

        <div class="kawaru-text-95 text-base-content/60 whitespace-nowrap tabular-nums shrink-0">
          {{ formatBytes(member.size) }}
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <!-- 上移/下移：触屏与键盘可用的排序通道，边界禁用（e2e 也走这里）；
               与拖拽手柄同门槛，仅在 editMode（编辑态）出现 -->
          <template v-if="editMode">
            <button
              class="btn btn-ghost btn-sm btn-square kawaru-text-100"
:title="$t('collections.selected.moveUp')"
              :disabled="i === 0 || reordering"
              :aria-label="$t('collections.selected.moveUpAria', { name: member.filename })"
              @click="emit('reorder', i, i - 1)"
            >
              <SvgIcon type="chevron_up" class="w-[1em] h-[1em]" />
            </button>
            <button
              class="btn btn-ghost btn-sm btn-square kawaru-text-100"
:title="$t('collections.selected.moveDown')"
              :disabled="i === members.length - 1 || reordering"
              :aria-label="$t('collections.selected.moveDownAria', { name: member.filename })"
              @click="emit('reorder', i, i + 1)"
            >
              <SvgIcon type="chevron_down" class="w-[1em] h-[1em]" />
            </button>
          </template>

          <button
            class="btn btn-ghost btn-sm kawaru-text-95 text-primary hover:text-primary-focus"
            :title="$t('collections.members.downloadAria', { name: member.filename })"
            :aria-label="$t('collections.members.downloadAria', { name: member.filename })"
            @click="emit('download', member)"
          >
            <SvgIcon type="download" class="w-[1em] h-[1em]" />
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
      <p v-if="manageMode">{{ $t('collections.members.emptyManage') }}</p>
      <p v-else>{{ $t('collections.members.empty') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { PropType } from 'vue'
import DatasetThumb from '@/features/collections/components/DatasetThumb.vue'
import { useDragReorder } from '@/features/collections/composables/useDragReorder'
import { formatBytes } from '@/shared/utils/format'
import { t } from '@/i18n'
import type { CollectionMember } from '../types/collection'
import { COLLECTION_MEMBER_LIMIT } from '../constants/collectionLimits'

const props = defineProps({
  members: { type: Array as PropType<CollectionMember[]>, required: true },
  /** owner/admin 视图：显示 Add/Remove 与多选控件 */
  manageMode: { type: Boolean, default: false },
  /** 编辑态（页头 Edit 进入）：显示调序控件（手柄拖拽 + 上移/下移） */
  editMode: { type: Boolean, default: false },
  adding: { type: Boolean, default: false },
  removing: { type: Boolean, default: false },
  reordering: { type: Boolean, default: false },
  /** 后端成员上限（超出 409 collection member limit exceeded），与 constants/collectionLimits
   *  同源。这里是显示用的徽标；拦截在「添加成员」弹窗里按剩余名额做。 */
  limit: { type: Number, default: COLLECTION_MEMBER_LIMIT },
})

const emit = defineEmits<{
  (e: 'add'): void
  (e: 'remove', publicIds: string[]): void
  (e: 'reorder', from: number, to: number): void
  (e: 'download', member: CollectionMember): void
}>()

/** 成员文件的上传状态（后端取值）→ 显示文字；未知取值原样显示 */
function statusLabel(status: string | null | undefined): string {
  if (status === 'completed') return t('common.status.completed')
  if (status === 'uploading') return t('common.status.processing')
  if (status === 'failed') return t('common.status.failed')
  return status ?? ''
}

// ---- 多选（仅管理模式）----
const selectedIds = reactive(new Set<string>())

function toggleSelect(publicId: string) {
  if (selectedIds.has(publicId)) selectedIds.delete(publicId)
  else selectedIds.add(publicId)
}

function confirmRemove() {
  if (!selectedIds.size) return
  emit('remove', [...selectedIds])
}

// 成员列表变化后清掉失效的选择（移除成功/重拉都会走这里）
watch(
  () => props.members,
  (members) => {
    const valid = new Set(members.map((m) => m.publicId))
    for (const id of [...selectedIds]) {
      if (!valid.has(id)) selectedIds.delete(id)
    }
  },
)

// ---- 拖拽调序（手柄武装 DnD，与 SelectedDatasetList 同模式）----
const { armed, arm, dragFrom, dragOver, onDragStart, onDrop, resetDrag } = useDragReorder(
  (from, to) => emit('reorder', from, to),
)
</script>
