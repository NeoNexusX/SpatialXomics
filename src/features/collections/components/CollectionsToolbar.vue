<template>
  <!-- 集合列表工具栏：沿用 DatasetFilterBar 的容器几何与搜索/筛选/排序控件形态 -->
  <div
    class="flex flex-col md:flex-row gap-4 justify-between items-center kawaru-text-100 bg-base-100 dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-base-300 mb-6"
  >
    <!-- 搜索（服务端 name 模糊，跨全部分页）+ 筛选入口 -->
    <div class="flex flex-1 items-center gap-2 min-w-0 w-full md:w-auto">
      <SearchInput
        v-model="searchQuery"
        :placeholder="$t('collections.toolbar.searchPlaceholder')"
        class="flex-1 min-w-[7rem]"
        @search="onSearchClick"
      />
      <button @click="onSearchClick" class="btn btn-primary shrink-0 kawaru-text-100">{{ $t('common.action.search') }}</button>

      <!-- 筛选：枚举多选 + 文本模糊（服务端筛选，POST body）。面板与
           DatasetFilterPanel 同构，teleport 到 body 不被裁剪 -->
      <div class="flex relative group w-full sm:w-auto">
        <button
          ref="filterBtn"
          @click="toggleFilterPanel"
          class="flex w-full sm:w-auto items-center justify-center gap-2 bg-base-100 dark:bg-slate-800 border border-base-300 text-base-content h-10 px-4 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors kawaru-text-100 font-medium"
        >
          <SvgIcon type="plus" class="w-[1.1em] h-[1.1em]" />
          {{ $t('collections.filter.addFilter') }}
        </button>
        <teleport to="body">
          <!-- 面板 z 必须低于 TagInput 词表下拉的 z-[1000]（否则下拉建议被面板盖住），
               高于页面普通内容；toast(9999)/SXO-Harness(10000) 仍在面板之上 -->
          <div
            v-show="showFilterPanel"
            ref="filterPanelRef"
            :style="panelStyle"
            class="bg-base-100 dark:bg-slate-800 border border-base-300 rounded-lg p-5 shadow-2xl
              overflow-y-auto z-[900]"
          >
            <CollectionFilterPanel
              :show-owner="showOwnerFilter"
              @apply="(payload) => emit('apply-filters', payload)"
              @close="closeFilterPanel"
            />
          </div>
        </teleport>
      </div>
    </div>

    <!-- 范围切换：默认浏览全部（/collections/list_all），勾选后仅显示自己的（/collections/list） -->
    <label
      class="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap
        kawaru-text-95 text-base-content/80"
    >
      <input
        type="checkbox"
        class="toggle toggle-primary"
        :checked="mineOnly"
        @change="$emit('update:mineOnly', ($event.target as HTMLInputElement).checked)"
      />
      <span>{{ $t('collections.toolbar.mineOnly') }}</span>
    </label>

    <!-- 排序：后端目前仅支持 updated_at 倒序（无排序参数），先以单选项静态展示；
         后端支持排序后在此追加选项并恢复 v-model + @sort 事件 -->
    <div class="relative w-full md:w-64 min-w-0">
      <select
        class="appearance-none w-full min-w-0 bg-base-100 dark:bg-slate-800 border border-base-300 text-base-content py-2 pl-3 pr-8 rounded-lg kawaru-text-100"
        :aria-label="$t('collections.toolbar.sortAria')"
      >
        <option>{{ $t('collections.toolbar.sortUpdated') }}</option>
      </select>
      <div
        class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-base-content/60"
      >
        <SvgIcon type="chevron_down" class="fill-current h-[1em] w-[1em]" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import SearchInput from '@/shared/components/SearchInput.vue'
import CollectionFilterPanel from './CollectionFilterPanel.vue'
import { useClickOutside } from '@/shared/composables/useClickOutside'
import { useAnchoredPosition } from '@/shared/composables/useAnchoredPosition'

const props = defineProps<{
  /** 仅显示当前登录用户的集合（切换 /collections/list_all ↔ /collections/list） */
  mineOnly?: boolean
  /** 当前已应用的搜索词。空态里的 Clear Search 只重置外层状态，
   *  这里跟着清空输入框，避免框里留着旧词与列表状态不一致 */
  searchApplied?: string
  /** 筛选面板显示 owner_username：仅「浏览全部」时有意义（我的集合 owner 恒为自己） */
  showOwnerFilter?: boolean
}>()

const emit = defineEmits<{
  (e: 'search', query: string): void
  (e: 'update:mineOnly', value: boolean): void
  (e: 'apply-filters', payload: Record<string, string | string[]>): void
}>()

const searchQuery = ref('')

// 外部清空搜索（如 Clear Search 按钮）时同步清掉输入框；
// 提交搜索（变为非空）不动输入框——两者本就同值
watch(
  () => props.searchApplied,
  (v) => {
    if (!v) searchQuery.value = ''
  },
)

const onSearchClick = () => emit('search', searchQuery.value)

// ---- 筛选面板：定位与点击外关闭，与 DatasetFilterBar 同一套路 ----
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

// 词表下拉 teleport 在面板 DOM 之外，选择选项不算 outside（否则面板会被误关）
useClickOutside(filterPanelRef, closeFilterPanel, [filterBtn], '[data-taginput-menu]')
</script>
