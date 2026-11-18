<template>
  <!-- 集合卡片：<lg 纵向堆叠（封面 → 名称/元信息 → 操作行沉底），lg+ 封面在左、
       右侧信息区 + 最右操作列。
       右侧信息区：表头（名称 + 右上角归属徽标 + Creator/Created/Updated 行）横跨
       整个右侧；其下「两框等高并排」——左框 Organism / Organism Part /
       Ionisation Source chips（整列圆角框），右框 Title/DOI/Access/Journal/Published
       标签左置行（浅背景圆角框，空值占位「—」）。<xl 两框纵向堆叠，xl 起并排且
       xl:items-stretch 等高（顶、底都齐平）；整对 mt-auto 沉底，两框底边与封面底边对齐。
       chips 每个字段恒一行：最多常显 3 个值（nowrap，放不下由 chip 内省略号截断、
       title 悬停看全称），行尾「…」圆钮点开 popover 悬浮窗看剩余值（top layer）。
       封面图统一取成员文件的 OSS 预览图（目录来自后端 image_path），
       后端已按数据类型返回对应的那张（processed → TIC，continuous → UMAP），
       前端不做判断；成员超过 1 个时用左右箭头切换。封面下方不带缩略图条。
       轮播用 daisyUI carousel（帧常驻 DOM + scrollIntoView 翻页），
       只挂前 5 个成员的帧，封顶图片请求数。
       卡片右侧多留一截空白（lg:pr-10），让操作列不贴边。

       字号一律走 kawaru-text-* 档位（style.css），不用 text-[Nem] ——
       本组件嵌在列表页的任意深度，em 会随层级叠乘，档位才是绝对像素。 -->
  <div
    class="flex flex-col lg:flex-row lg:p-6 gap-x-4 gap-y-4 h-full bg-base-100 dark:bg-slate-800 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 border border-base-300 cursor-pointer"
    @click="$emit('view', collection.publicId)"
  >
    <!-- 主区包裹层（封面 + 右侧信息区）：md 起封面左栏（300/340px）、信息区占满
         同行剩余宽度并 stretch 到封面高；<md 纵向堆叠；操作列不进本层 -->
    <div class="flex flex-col md:flex-row flex-1 min-w-0 gap-x-5 gap-y-4">
      <!-- 左：封面轮播（尺寸与框体同一个元素，不再套一层纯尺寸壳）。
         <md 满宽置顶、4:3；md 起定宽 300/340px，高度不再钉死在 4:3——去掉 self-start
         后随行 stretch 到右侧信息区等高（填掉下方空白），再由 md:max-h 封顶，
         即 min(右侧内容高, max-h)；aspect-[4/3] 退化为内容很矮时的高度下限。
         注：图片 object-contain 受宽度约束，盒子变高只是上下补浅底（不放大图、不裁切）。
         点击封面不进入 overview：翻看轮播时容易误触整卡跳转，
         入口收归 View Collection 按钮；cursor-default 覆盖整卡的 pointer -->
      <div
        class="shrink-0 w-full md:w-[300px] lg:w-[340px] md:max-h-[400px] aspect-[4/3] relative rounded-lg overflow-hidden border border-base-300 bg-base-200 cursor-default"
        @click.stop
      >
        <!-- 封面完整显示（contain）：TIC / UMAP 都按原比例缩放进框内，不裁切。
             超宽图（TIC 条带 8500×1500）两侧会有留白，但至少内容是全的。 -->
        <!-- 封面成员仍在拉取（列表接口不带 members）：骨架占位，
             避免先闪随机占位图再换真图 -->
        <div v-if="coverLoading" class="skeleton w-full h-full rounded-none" aria-hidden="true" />
        <!-- daisyUI carousel：snap-mandatory + 平滑滚动 + 隐藏滚动条。翻页用 button +
             scrollIntoView，不用 <a href="#slideN"> 锚点：锚点会写进 history，还要求全页
             id 唯一。帧常驻 DOM，img 各自 lazy。 -->
        <div
          v-else-if="slideCount"
          ref="carouselEl"
          class="carousel overscroll-x-contain w-full h-full"
          role="group"
          :aria-label="$t('collections.card.coversAria', { name: collection.name })"
          @scroll.passive="onCoverScroll"
        >
          <div v-for="(imagePath, i) in slides" :key="i" class="carousel-item w-full h-full">
            <DatasetThumb :image-path="imagePath" :alt="`${collection.name} preview`" />
          </div>
        </div>
        <div
          v-else
          class="w-full h-full text-base-content"
          aria-hidden="true"
          v-html="placeholderSvg"
        />

        <!-- 箭头 + 帧计数。箭头为半透明深色圆钮（黑底白箭头）：
           浅色 TIC / 深色 UMAP 封面上都稳定可见 -->
        <template v-if="slideCount > 1">
          <button
            type="button"
            class="absolute left-1 top-1/2 -translate-y-1/2 btn btn-xs btn-circle bg-black/50 hover:bg-black/70 text-white border-none shadow-sm kawaru-text-68"
            :aria-label="$t('collections.card.prev')"
            @click.stop="goPrev"
          >
            <SvgIcon type="chevron_left" class="w-[1em] h-[1em]" />
          </button>
          <button
            type="button"
            class="absolute right-1 top-1/2 -translate-y-1/2 btn btn-xs btn-circle bg-black/50 hover:bg-black/70 text-white border-none shadow-sm kawaru-text-68"
            :aria-label="$t('collections.card.next')"
            @click.stop="goNext"
          >
            <SvgIcon type="chevron_right" class="w-[1em] h-[1em]" />
          </button>
          <span
            class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded kawaru-text-68 font-medium bg-base-100/85 dark:bg-slate-800/85 text-base-content/70 border border-base-300"
          >
            {{ scrollIndex + 1 }}/{{ slideCount }}
          </span>
        </template>
      </div>

      <!-- 右侧信息区：表头（名称/徽标/Creator 行）在上，其下「两框等高并排」；
           整个区 stretch 到封面高，让两框底边与封面底边对齐。 -->
      <div class="flex-1 min-w-0 flex flex-col p-2 gap-2">
        <!-- 上：名称 + 归属徽标（紧跟名称后）+ Creator / Created / Updated，无框无背景。
             列表接口没有集合级公开标记，「公开」即「非本人所有」 -->
        <div class="pb-3 min-w-0 flex flex-col gap-3">
          <!-- 徽标紧跟名称：名称按内容宽、放不下自己 truncate，徽标 shrink-0 恒在其后 -->
          <div class="flex items-center gap-2.5 min-w-0">
            <h3
              class="min-w-0 truncate font-bold kawaru-text-187 leading-snug text-base-content"
              :title="collection.name"
            >
              {{ collection.name }}
            </h3>
            <span
              class="shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 kawaru-text-81 font-medium border"
              :class="ownershipBadge.class"
            >
              <SvgIcon type="circle_stack" class="w-[0.95em] h-[0.95em]" />
              {{ ownershipBadge.label }}
            </span>
          </div>

          <!-- 宽度充足时恒一行；中栏被挤窄（lg/xl 断点起始段，最窄 ~230px）时三段
               作为整段换行，标签与日期永不被 truncate 切成「Ca…/Upd…」碎片——
               只有用户名保留 truncate（放不下由它省略） -->
          <div
            class="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0 kawaru-text-81 text-base-content/75"
          >
            <span
              class="inline-flex items-center gap-1 min-w-0"
              :title="$t('collections.card.owner', { name: collection.ownerUsername })"
            >
              <span class="shrink-0 text-base-content/45">{{
                $t('collections.card.label.creator')
              }}</span>
              <SvgIcon type="user" class="w-[1.05em] h-[1.05em] shrink-0 text-base-content/60" />
              <span class="truncate font-medium">{{ collection.ownerUsername }}</span>
            </span>
            <!-- 日期段整段 shrink-0 + nowrap：放不下就整体换到下一行，
                 不收缩、不截断（日期被省略号切开等于信息全丢） -->
            <span class="shrink-0 whitespace-nowrap">
              <span class="text-base-content/45">{{ $t('collections.card.label.created') }}</span>
              {{ formattedCreated }}
            </span>
            <span class="shrink-0 whitespace-nowrap">
              <span class="text-base-content/45">{{ $t('collections.card.label.updated') }}</span>
              {{ formattedUpdated }}
            </span>
          </div>
        </div>

        <!-- 合并面板：表头之下，样本信息 | 学术信息 两列，中缝 daisyUI divider 分隔。
             边框/浅背景/内边距挂在面板上（两列不再各自成框）；<xl 纵向堆叠、divider 转横向，
             xl 起并排、左右各 flex-1 平分、divider 转竖向并通高；整块 mt-auto 沉底、与封面底对齐。 -->
        <div
          class="mt-auto min-w-0 rounded-lg border border-base-300 bg-base-200/40 dark:bg-slate-700/40 p-3 flex flex-col xl:flex-row"
        >
          <!-- 左列（样本）：Organism / Organism Part / Ionisation Source，每个字段恒一行；
               放不下由 chip 内省略号截断、行尾「…」点开 popover 看剩余值。 -->
          <div class="xl:flex-1 min-w-0 flex flex-col gap-2.5">
            <div v-for="field in basicFields" :key="field.key" class="min-w-0">
              <div class="kawaru-text-81 font-medium text-base-content/45">{{ field.label }}</div>
              <div
                v-if="field.values.length"
                class="flex flex-nowrap items-center gap-1.5 mt-1 min-w-0"
              >
                <span
                  v-for="value in field.visibleValues"
                  :key="value"
                  class="min-w-0 inline-flex items-center rounded-full px-2.5 py-0.5 kawaru-text-81 font-medium bg-base-200/80 text-base-content/70 border border-base-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600"
                  :title="vocabLabel(value)"
                >
                  <span class="truncate">{{ vocabLabel(value) }}</span>
                </span>

                <!-- 行尾「…」：该字段还有未常显的值，点开下方悬浮窗查看。
                 shrink-0 让它在与截断 chip 挤一行时始终留在可视区末尾 -->
                <button
                  v-if="field.hiddenValues.length"
                  type="button"
                  :popovertarget="field.popoverId"
                  :style="{ anchorName: field.anchorName }"
                  class="shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 kawaru-text-81 font-medium bg-base-200/80 text-base-content/70 border border-base-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600 hover:border-primary/40 hover:text-primary"
                  :title="$t('collections.card.more', { count: field.hiddenValues.length })"
                  :aria-label="$t('collections.card.moreAria', { name: collection.name })"
                  @click.stop
                >
                  …
                </button>

                <!-- 剩余值悬浮窗：daisyUI 5 的 popover 形态，内容进 top layer，
                 点外部 / Esc 关闭；[position-try-fallbacks] 让下方放不下时自动上翻。
                 与「…」圆钮同条件渲染，没有剩余值就不挂空面板 -->
                <div
                  v-if="field.hiddenValues.length"
                  :id="field.popoverId"
                  popover
                  role="dialog"
                  :style="{ positionAnchor: field.anchorName }"
                  class="dropdown dropdown-end dropdown-bottom w-[16em] rounded-box p-3 bg-base-100 dark:bg-slate-800 border border-base-300 shadow-lg [position-try-fallbacks:flip-block]"
                  @click.stop
                >
                  <div class="kawaru-text-81 font-medium text-base-content/45">
                    {{ field.label }}
                  </div>
                  <div class="flex flex-wrap gap-1.5 mt-1">
                    <span
                      v-for="value in field.hiddenValues"
                      :key="value"
                      class="max-w-full inline-flex items-center rounded-full px-2.5 py-0.5 kawaru-text-81 font-medium bg-base-200/80 text-base-content/70 border border-base-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600"
                      :title="vocabLabel(value)"
                    >
                      <span class="truncate">{{ vocabLabel(value) }}</span>
                    </span>
                  </div>
                </div>
              </div>
              <div v-else class="kawaru-text-81 text-base-content/40 mt-1">—</div>
            </div>
          </div>

          <!-- 中缝：<xl 横线、xl 竖线（通高）；留空不写字 -->
          <div class="divider xl:divider-horizontal my-2 xl:my-0 xl:mx-2"></div>

          <!-- 右列（学术）：Title / DOI / Access / Journal / Published 标签左置行 -->
          <div class="xl:flex-1 min-w-0 flex flex-col gap-3">
            <div class="flex items-baseline gap-2 min-w-0">
              <span class="w-[5.5em] shrink-0 kawaru-text-81 font-medium text-base-content/45">{{
                $t('collections.meta.title')
              }}</span>
              <p
                v-if="collection.title"
                class="flex-1 min-w-0 truncate kawaru-text-81 text-base-content/80"
                :title="collection.title"
              >
                {{ collection.title }}
              </p>
              <span v-else class="kawaru-text-81 text-base-content/40">—</span>
            </div>

            <div class="flex items-baseline gap-2 min-w-0">
              <span class="w-[5.5em] shrink-0 kawaru-text-81 font-medium text-base-content/45">{{
                $t('collections.meta.doi')
              }}</span>
              <div v-if="collection.doi.length" class="flex-1 min-w-0 flex flex-col gap-0.5">
                <a
                  v-for="doi in collection.doi"
                  :key="doi"
                  :href="doiHref(doi)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex items-center gap-1.5 min-w-0 kawaru-text-81 text-primary hover:underline"
                  :title="doi"
                  @click.stop
                >
                  <SvgIcon type="link" class="w-[1em] h-[1em] shrink-0" />
                  <span class="truncate">{{ doi }}</span>
                </a>
              </div>
              <span v-else class="kawaru-text-81 text-base-content/40">—</span>
            </div>

            <!-- 后端 access 为 list[str]，逐项原样透传：每项可能是 URL 也可能是标签文本（与 DOI 行同构） -->
            <div class="flex items-baseline gap-2 min-w-0">
              <span class="w-[5.5em] shrink-0 kawaru-text-81 font-medium text-base-content/45">{{
                $t('collections.meta.access')
              }}</span>
              <div v-if="collection.access.length" class="flex-1 min-w-0 flex flex-col gap-0.5">
                <a
                  v-for="entry in collection.access"
                  :key="entry"
                  :href="isUrl(entry) ? entry : undefined"
                  :target="isUrl(entry) ? '_blank' : undefined"
                  :rel="isUrl(entry) ? 'noopener noreferrer' : undefined"
                  class="flex items-center gap-1.5 min-w-0 kawaru-text-81"
                  :class="
                    isUrl(entry)
                      ? 'text-primary hover:underline'
                      : 'cursor-default text-base-content/70'
                  "
                  :title="entry"
                  @click.stop
                >
                  <SvgIcon type="link" class="w-[1em] h-[1em] shrink-0" />
                  <span class="truncate">{{ entry }}</span>
                </a>
              </div>
              <span v-else class="kawaru-text-81 text-base-content/40">—</span>
            </div>

            <div class="flex items-baseline gap-2 min-w-0">
              <span class="w-[5.5em] shrink-0 kawaru-text-81 font-medium text-base-content/45">{{
                $t('collections.meta.journal')
              }}</span>
              <!-- 期刊名斜体加粗：Poppins 只下载了 italic 400 字面（无 700 斜体），
                 全局 font-synthesis:none 会吃掉合成粗体导致看不出加粗，
                 这里单独放开 weight 合成（与 zh-CN 全局放开的做法一致） -->
              <p
                v-if="collection.journalName"
                class="flex-1 min-w-0 truncate kawaru-text-81 text-base-content/80 italic font-bold [font-synthesis:weight]"
                :title="collection.journalName"
              >
                {{ collection.journalName }}
              </p>
              <span v-else class="kawaru-text-81 text-base-content/40">—</span>
            </div>

            <!-- 发表时间：跟在 Journal 行下，框多占一行，Creator 行与框之间的
               弹性空隙（mt-auto）随之收窄；label 列宽与上面各行对齐 -->
            <div class="flex items-baseline gap-2 min-w-0">
              <span class="w-[5.5em] shrink-0 kawaru-text-81 font-medium text-base-content/45">{{
                $t('collections.meta.publishTime')
              }}</span>
              <p
                v-if="collection.publishTime"
                class="flex-1 min-w-0 truncate kawaru-text-81 text-base-content/80"
                :title="formattedPublishTime"
              >
                {{ formattedPublishTime }}
              </p>
              <span v-else class="kawaru-text-81 text-base-content/40">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右：Share / View / Delete 按钮组 + 成员数（Share 需 publicId，Delete 仅
         owner/admin）。lg 下列内容整体垂直居中（justify-center），成员数在按钮
     组下方。容器自挂 kawaru-text-81 钉住字号，lg:w-[11.5em] 恒等于
     「档位 × 11.5」，换档时同步跟上；最宽条目 "View Collection" 需单行放下。 -->
    <div
      class="cursor-default kawaru-text-81 flex flex-row flex-wrap gap-3 items-center w-full border-t border-base-300 p-2 lg:w-[11.5em] lg:flex-col lg:items-stretch lg:self-stretch lg:justify-center lg:border-l lg:border-t-0 lg:pt-1 lg:pl-4"
      @click.stop
    >
      <!-- Share / View / Delete + 成员数量 四者同级：<lg 等宽一行（flex-1 → 1:1:1:1），
           lg 起在右侧竖列各自整宽堆叠（lg:flex-none lg:w-full）。
           Share 需 publicId、Delete 仅 owner/admin，缺项时 flex-1 自动重新等分。 -->
      <!-- 分享：复制免登录公开链接（与 overview 页同一方案），无 publicId 时隐藏 -->
      <button
        v-if="collection.publicId"
        class="btn btn-outline btn-secondary kawaru-text-81 h-[2.3em] min-h-[2.3em] flex-1 min-w-0 lg:flex-none lg:w-full"
        :title="$t('collections.card.copyShareLink')"
        @click.stop="copyShareLink"
      >
        <SvgIcon type="share" class="w-[1em] h-[1em] shrink-0" />
        <span class="truncate">{{ $t('common.action.share') }}</span>
      </button>

      <button
        class="btn btn-primary kawaru-text-81 h-[2.3em] min-h-[2.3em] flex-1 min-w-0 lg:flex-none lg:w-full"
        @click.stop="$emit('view', collection.publicId)"
      >
        <!-- 窄屏等宽四列放不下全称，显示简写「View」；lg 起整宽竖列显示「View Collection」 -->
        <span class="truncate lg:hidden">{{ $t('common.action.view') }}</span>
        <span class="truncate hidden lg:inline">{{ $t('collections.card.viewCollection') }}</span>
        <SvgIcon type="chevron_right" class="w-[1em] h-[1em] shrink-0" />
      </button>

      <!-- 删除：默认浅粉底，hover 加深一档即可 -->
      <button
        v-if="canEdit"
        class="btn btn-outline border-error/30 bg-error/15 text-error hover:bg-error/30 hover:border-error/50 kawaru-text-81 h-[2.3em] min-h-[2.3em] flex-1 min-w-0 lg:flex-none lg:w-full"
        :title="$t('collections.card.deleteTitle')"
        @click.stop="$emit('delete', collection.publicId)"
      >
        <SvgIcon type="trash" class="w-[1em] h-[1em] shrink-0" />
        <span class="truncate">{{ $t('common.action.delete') }}</span>
      </button>

      <!-- 成员总数：与按钮同级，<lg 作为第 4 个等宽列，lg 起整宽居中沉在按钮下方。
           窄屏空间有限：数字降一档、隐藏单位词（完整信息在 title / lg 下补回），
           overflow-hidden 兜底确保绝不溢出等宽列。 -->
      <div
        class="flex items-center justify-center gap-2 px-1 text-base-content/70 flex-1 min-w-0 overflow-hidden lg:flex-none lg:w-full"
        :title="$t('collections.card.memberCountTitle', collection.memberCount)"
      >
        <SvgIcon type="queue_list" class="w-[1.5em] h-[1.5em] shrink-0" />
        <span class="kawaru-text-125 lg:kawaru-text-187 font-bold leading-none text-primary">{{
          collection.memberCount
        }}</span>
        <span class="hidden lg:inline kawaru-text-81">{{ unitLabel }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CollectionSummary } from '@/features/collections/types/collection'
import DatasetThumb from '@/features/collections/components/DatasetThumb.vue'
import { getDatasetPlaceholderSvg } from '@/features/datasets/utils/datasetPlaceholder'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import { formatDate } from '@/shared/utils/format'
import { useToast } from '@/shared/composables/useToast'
import { useCopyToClipboard } from '@/shared/composables/useCopyToClipboard'
import { t } from '@/i18n'

const props = defineProps<{
  collection: CollectionSummary
  /** 当前用户是 owner 或 admin（控制 Delete 显隐） */
  canEdit?: boolean
  /** 集合属于当前登录用户（控制归属徽标显隐） */
  isMine?: boolean
  /** 该集合成员的 imagePath（由 useCollectionCovers 逐卡补齐），决定封面轮播；只取前 5 个 */
  imagePaths?: (string | null)[]
  /** 封面成员仍在拉取（拉取期间显示骨架而非占位图） */
  coverLoading?: boolean
}>()

defineEmits<{
  (e: 'view', publicId: string): void
  (e: 'delete', publicId: string): void
}>()

const { showToast } = useToast()
const { copy } = useCopyToClipboard()

// 占位图只生成一次（随机配色，与数据集页回退同策略）
const placeholderSvg = getDatasetPlaceholderSvg({ showGuides: true })

// ---- 封面轮播：一卡一帧，箭头切到下一个成员 ----
// 只挂前 5 帧：列表页预览够用，同时封顶一次加载的图片请求数
const MAX_FRAMES = 5
const slides = computed(() => (props.imagePaths ?? []).slice(0, MAX_FRAMES))
const slideCount = computed(() => slides.value.length)

// 帧常驻 DOM，游标由实际滚动位置驱动（手动滑动也同步）
const carouselEl = ref<HTMLElement | null>(null)
const scrollIndex = ref(0)

function goPrev() {
  step(-1)
}
function goNext() {
  step(1)
}
function step(delta: number) {
  if (slideCount.value < 2) return
  scrollToSlide(scrollIndex.value + delta)
}

// 翻到目标帧（负数/越界自动回绕）。inline:'start' 与 carousel-item 的
// snap-align:start 对齐；block:'nearest' 防止联动滚动整页（卡片已在视口内）
function scrollToSlide(target: number) {
  const el = carouselEl.value
  if (!el) return
  const i = ((target % slideCount.value) + slideCount.value) % slideCount.value
  scrollIndex.value = i // 计数即时反馈；回绕时平滑滚动会掠过中间帧
  el.children[i]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
}

// 手动滑动（触摸/触控板）后同步计数；箭头触发的平滑滚动结束时也收敛到同一值
function onCoverScroll() {
  const el = carouselEl.value
  if (!el || !el.clientWidth) return
  const i = Math.round(el.scrollLeft / el.clientWidth)
  if (i >= 0 && i < slideCount.value) scrollIndex.value = i
}

// 列表刷新/换页后成员列表变化：把滚动位置与游标归零
watch(slides, () => {
  scrollIndex.value = 0
  carouselEl.value?.scrollTo({ left: 0 })
})

// ---- 归属徽标：本人集合 → My Collection，他人集合 → Public Collection ----
// 注意「公开」是「非本人所有」的表述 —— 列表接口没有集合级公开标记，
// 数据本身来自 /collections/list_all（全库，任意登录用户可见）。
const ownershipBadge = computed(() =>
  props.isMine
    ? {
        label: t('collections.card.mineBadge'),
        class: 'bg-primary/10 dark:bg-primary/20 text-primary border-primary/20',
      }
    : {
        label: t('collections.public.badge'),
        class:
          'bg-base-200/80 text-base-content/60 border-base-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600',
      },
)

// ---- 中右 chips 列：三个字段名恒显示，每个字段恒一行 —— 最多常显 3 个值，
// 还有剩余时行尾「…」圆钮点开 per-field 悬浮窗看 ----
/** 每个字段常显的值数量上限 */
const VISIBLE_VALUE_COUNT = 3

const basicFields = computed(() =>
  [
    { key: 'organism', label: t('common.meta.organism'), values: props.collection.organism },
    {
      key: 'organismPart',
      label: t('common.meta.organismPart'),
      values: props.collection.organismPart,
    },
    {
      key: 'ionisationSource',
      label: t('common.meta.ionisationSource'),
      values: props.collection.ionisationSource,
    },
  ].map((field) => ({
    ...field,
    visibleValues: field.values.slice(0, VISIBLE_VALUE_COUNT),
    hiddenValues: field.values.slice(VISIBLE_VALUE_COUNT),
    // popover 靠 id 关联触发按钮，一页多卡 × 每卡三个字段都需唯一
    popoverId: `collection-${props.collection.publicId}-more-${field.key}`,
    // 显式锚点（同样需唯一）。daisyUI 的 popover 靠浏览器的「隐式锚点」（=popovertarget
    // 按钮）定位，但 :popover-open 一翻 false 隐式锚点就没了 —— 而 daisyUI 为了淡出动画
    // 会在关闭后继续渲染 ~250ms，那段时间 position-area 失效，面板会掉到视口左上角
    // 闪一下内容。显式 anchor-name / position-anchor 不随 open 状态丢失，位置全程不动。
    anchorName: `--collection-${props.collection.publicId}-more-${field.key}`,
  })),
)

// ---- DOI / Access：值是裸 doi 时补 https://doi.org 前缀，已是 URL 就原样用 ----
function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}
function doiHref(doi: string): string {
  // 先剥 doi:/doi.org 前缀再拼，避免 "doi:10.x" 变成 "https://doi.org/doi:10.x"
  const value = doi.trim().replace(/^(?:(?:https?:\/\/)?(?:dx\.|www\.)?doi\.org\/|doi:\s*)/i, '')
  return isUrl(value) ? value : `https://doi.org/${value}`
}

// ---- 分享链接：复制免登录公开页 URL（与 overview 页 copyShareLink 同一方案）----
async function copyShareLink() {
  if (!props.collection.publicId) return
  const url = `${location.origin}/collections/${props.collection.publicId}`
  await copy(url, {
    onError: () => showToast(t('collections.overview.shareLink', { url }), 'info'),
  })
}

const unitLabel = computed(() => t('collections.unit.dataset', props.collection.memberCount))

// formatDate 空值返回 ''，这里统一补「—」（与其他元数据行的占位一致）
const formattedCreated = computed(() => formatDate(props.collection.createdAt) || '—')
const formattedUpdated = computed(() => formatDate(props.collection.updatedAt) || '—')
// 发表时间：模板里 v-if 已挡空值，这里只负责格式化（title 悬停同款文本）
const formattedPublishTime = computed(() => formatDate(props.collection.publishTime))
</script>
