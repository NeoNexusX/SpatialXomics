<template>
  <!-- 五个控件必须等高。SearchInput / Search 是 daisyUI 的 .input / .btn，
       height 被 --size 写死在 40px、不随字号变；自绘控件若靠 py-* + 行盒凑高度，
       字号一涨就顶出去（20px 字号下是 46px vs 40px）。故统一钉 h-10 + items-center。 -->
  <div
    class="flex flex-col md:flex-row gap-4 justify-between items-center kawaru-text-100 bg-base-100 dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-base-300 mb-6"
  >
    <div class="flex flex-col sm:flex-row sm:items-center gap-2 w-full md:w-auto">
      <div class="flex flex-1 items-center gap-2 min-w-0">
        <SearchInput
          v-model="searchQuery"
          :placeholder="searchPlaceholder ?? $t('common.input.searchDatasets')"
          class="flex-1 min-w-[7rem]"
          @search="onSearchClick"
        />
        <button @click="onSearchClick" class="btn btn-primary shrink-0 kawaru-text-100">{{ $t('common.action.search') }}</button>
      </div>

      <div v-if="showAddFilter" class="flex relative group w-full sm:w-auto">
        <button
          ref="filterBtn"
          @click="toggleFilterPanel"
          class="flex w-full sm:w-auto items-center justify-center gap-2 bg-base-100 dark:bg-slate-800 border border-base-300 text-base-content h-10 px-4 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors kawaru-text-100 font-medium"
        >
          <SvgIcon type="plus" class="w-[1.1em] h-[1.1em]" />
          {{ $t('datasets.filter.addFilter') }}
        </button>
        <teleport to="body">
          <!-- 面板 z 必须低于 TagInput 词表下拉的 z-[1000]（否则下拉建议被面板盖住），
               高于页面普通内容；toast(9999)/AI 助手(10000) 仍在面板之上 -->
          <div
            v-show="showFilterPanel"
            ref="filterPanelRef"
            :style="panelStyle"
            class="bg-base-100 dark:bg-slate-800 border border-base-300 rounded-lg p-5 shadow-2xl
              overflow-y-auto z-[900]"
          >
            <DatasetFilterPanel
              @apply="(payload) => emit('apply-filters', payload)"
              @close="closeFilterPanel"
            />
          </div>
        </teleport>
      </div>

      <!-- 跨页入口：数据集列表 ↔ 数据集合列表，与 Add filter 并排。
           目标路由 requiresAuth，未登录时由全局守卫带 redirect 回登录页 -->
      <router-link
        v-if="showCollectionsLink"
        to="/collections"
        class="flex w-full sm:w-auto items-center justify-center gap-2 bg-base-100 dark:bg-slate-800 border border-base-300 text-base-content h-10 px-4 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors kawaru-text-100 font-medium"
      >
        <SvgIcon type="circle_stack" class="w-[1.1em] h-[1.1em] shrink-0" />
        <span class="truncate">{{ $t('common.page.collections') }}</span>
      </router-link>
    </div>

    <div class="flex flex-col sm:flex-row sm:items-center gap-2 w-full md:w-auto min-w-0">
      <button
        v-if="showUpload"
        @click="$emit('upload')"
        class="flex w-full sm:w-auto items-center justify-center gap-2 bg-blue-600 text-white hover:bg-blue-700 border-none rounded-lg shadow-sm transition-all transform active:scale-95 kawaru-text-100 font-medium h-10 px-4 min-w-0 overflow-hidden"
      >
        <SvgIcon type="upload" class="w-[1.1em] h-[1.1em] shrink-0" />
        <span class="truncate">{{ $t('common.action.uploadDataset') }}</span>
      </button>

      <div class="relative flex-1 w-full min-w-0">
        <select
          v-model="sortValue"
          class="appearance-none w-full min-w-0 bg-base-100 dark:bg-slate-800 border border-base-300 text-base-content h-10 pl-3 pr-8 rounded-lg cursor-pointer kawaru-text-100"
        >
          <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <div
          class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-base-content/60"
        >
          <SvgIcon type="chevron_down" class="fill-current h-[1.1em] w-[1.1em]" />
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DatasetFilterPanel from '@/features/datasets/components/DatasetFilterPanel.vue'
import SearchInput from '@/shared/components/SearchInput.vue'
import { useClickOutside } from '@/shared/composables/useClickOutside'
import { useAnchoredPosition } from '@/shared/composables/useAnchoredPosition'
import { t } from '@/i18n'

interface SortOption {
  label: string
  value: string
}

withDefaults(
  defineProps<{
    showUpload?: boolean
    showAddFilter?: boolean
    /** 在 Add filter 旁显示进入 /collections 的按钮（数据集列表 ↔ 集合列表互跳） */
    showCollectionsLink?: boolean
    searchPlaceholder?: string
  }>(),
  {
    showUpload: false,
    showAddFilter: false,
    showCollectionsLink: false,
    searchPlaceholder: undefined,
  },
)

const emit = defineEmits<{
  (e: 'search', query: string): void
  (e: 'apply-filters', payload: Record<string, any>): void
  (e: 'sort', value: string): void
  (e: 'upload'): void
}>()

const searchQuery = ref('')
// 复合值 'field:order'：字段 + 方向一起选，由 useDatasetList.handleSort 解析后
// 映射到后端 sort_by/order query 参数（uploaded_at / size × asc / desc）
const sortValue = ref('submission_time:desc')

const sortOptions = computed<SortOption[]>(() => [
  { label: t('datasets.filter.sortNewest'), value: 'submission_time:desc' },
  { label: t('datasets.filter.sortOldest'), value: 'submission_time:asc' },
  { label: t('datasets.filter.sortLargest'), value: 'size_bytes:desc' },
  { label: t('datasets.filter.sortSmallest'), value: 'size_bytes:asc' },
])

const showFilterPanel = ref(false)
const filterBtn = ref<HTMLElement | null>(null)
const filterPanelRef = ref<HTMLElement | null>(null)

// 面板定位：fixed 贴锚点（视口坐标系，不吃文档滚动/裁剪的坑），下方空间不足
// 且上方更宽裕时向上翻，高度钳制在剩余空间内；滚动/缩放自动跟随
const { style: panelStyle } = useAnchoredPosition(filterBtn, showFilterPanel, {
  gap: 8,
  width: 650,
  // getter：窗口缩放后重开/重算时按当前视口高取值
  maxHeight: () => Math.round(window.innerHeight * 0.75),
})

const toggleFilterPanel = () => {
  showFilterPanel.value = !showFilterPanel.value
}

const closeFilterPanel = () => {
  showFilterPanel.value = false
}

const onSearchClick = () => emit('search', searchQuery.value)

// 词表下拉 teleport 在面板 DOM 之外，选择选项不算 outside（否则面板会被误关）
useClickOutside(filterPanelRef, closeFilterPanel, [filterBtn], '[data-taginput-menu]')

watch(sortValue, (value) => emit('sort', value))
</script>
