<script setup lang="ts">
import { ref, computed } from 'vue'
import { localized } from '@/shared/config/localizedText'
import type { TeamMember } from '@/features/home/config/contentConfig'

/**
 * 开发者卡片 —— 竖向矩形（portrait），3D 悬浮采用 daisyUI `hover-3d`（纯 CSS）。
 * - 第一个子元素为可见卡片内容，daisyUI 自动对其做 3D 旋转 + 放大(scale 1.05) + 移动高光。
 * - 其后 8 个空 div 是 hover 热区（daisyUI 3D 效果所需），触摸端无 hover 自然静态。
 * - 整张卡片作为 <a> 包裹（配置 homepage 时），点击跳转个人主页（新标签页）。
 * - 默认背景为银色金属质感；头像缺失/失败时回退「首字母 + 渐变背景」。
 */
const props = defineProps<{ member: TeamMember }>()

const imgFailed = ref(false)
const showImage = computed(() => !!props.member.avatar && !imgFailed.value)

/** 姓名按当前语言解析（content.json 里可写成 { "en": ..., "zh-CN": ... }） */
const memberName = computed(() => localized(props.member.name))

const initials = computed(() =>
  memberName.value
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase(),
)
</script>

<template>
  <component
    :is="member.homepage ? 'a' : 'div'"
    :href="member.homepage || undefined"
    :target="member.homepage ? '_blank' : undefined"
    :rel="member.homepage ? 'noopener noreferrer' : undefined"
    class="hover-3d card-3d w-full"
    :class="member.homepage ? 'cursor-pointer' : ''"
  >
    <!-- 第一个子元素：可见卡片内容（daisyUI 对其做 3D 旋转/放大/高光）-->
    <div class="card-face card aspect-[3/4] w-full">
      <div class="card-body items-center text-center">
        <!-- 头像区 -->
        <div class="flex items-center justify-center">
          <!-- daisyUI avatar；无图时用 avatar-placeholder 回退首字母 -->
          <div class="avatar" :class="{ 'avatar-placeholder': !showImage }">
            <div
              class="avatar-box rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white ring-2 ring-white/60 ring-offset-2 ring-offset-transparent"
            >
              <img
                v-if="showImage"
                :src="member.avatar"
                :alt="memberName"
                loading="lazy"
                decoding="async"
                @error="imgFailed = true"
              />
              <span v-else class="avatar-initials font-bold">{{ initials }}</span>
            </div>
          </div>
        </div>
        <!-- 姓名 -->
        <div class="member-name flex w-full items-center justify-center gap-1.5 font-bold text-base-content">
          <span class="truncate">{{ memberName }}</span>
          <SvgIcon
            v-if="member.homepage"
            type="share"
            class="h-[1em] w-[1em] shrink-0 text-base-content/40"
            aria-hidden="true"
          />
        </div>
        <!-- 职位 -->
        <div class="member-role w-full truncate font-medium text-base-content/70">{{ localized(member.role) }}</div>
        <!-- 学校 -->
        <div
          v-if="member.school"
          class="member-sub flex items-center justify-center gap-[0.4em] text-base-content/60 "
        >
          <SvgIcon type="institution" class="w-[1.5em] shrink-0" />
          <div class="truncate leading-tight">{{ localized(member.school) }}</div>
        </div>
        <!-- 学位 -->
        <div
          v-if="member.degree"
          class="member-meta flex items-center justify-center gap-[0.4em] text-base-content/80"
        >
          <SvgIcon type="research" class="w-[1.5em] shrink-0 text-primary" />
          <div class="truncate leading-tight">{{ localized(member.degree) }}</div>
        </div>
      </div>
    </div>

    <!-- 8 个 hover 热区（daisyUI hover-3d 所需，纯 CSS 驱动 3D 方向）-->
    <div></div>
    <div></div>
    <div></div>
    <div></div>
    <div></div>
    <div></div>
    <div></div>
    <div></div>
  </component>
</template>

<style scoped>
/* 让 hover-3d 撑满轮播单元格（覆盖 daisyUI 默认的 inline-grid）*/
.hover-3d.card-3d {
  display: grid;
  width: 100%;
}

/* ---- 内容随卡片宽度等比缩放（cqi = 卡片宽度的 1%；容器在 .carousel-item 上声明）----
   百分比以 250px 满宽为基准取像素占比；clamp 的下限是窄卡的可读/观感底线，
   上限是满卡时的既有尺寸。卡片越窄，头像、字号、内边距一起按比例缩小，3:4 盒内不挤不溢。 */
.card-body {
  padding: clamp(1rem, 9.6cqi, 2rem); /* 原 p-6 = 24px */
  /* 内容在固定高度内垂直居中：上下留均衡空白，3 行/5 行都不贴边 */
  justify-content: center;
  /* 行间随卡片宽度等比缩放（原 gap-4 = 16px 固定，窄卡时占比过大把末行顶到底边）*/
  gap: clamp(0.5rem, 5.6cqi, 1.5rem);
  /* 字号基准（= 14px 正文）：其余字号 = --fs × 比例，三段边界自动等比缩放 */
  --fs: clamp(0.7rem, 5.6cqi, 1rem);
}
.avatar-box {
  /* 原 h-28 w-28 = 112px */
  width: clamp(64px, 45cqi, 320px);
  height: clamp(64px, 45cqi, 320px);
}
.avatar-initials {
  font-size: calc(var(--fs) * 2.5); /* 30 / 14 */
}
.member-name {
  font-size: calc(var(--fs) * 1.8); /* 18 / 14 */
}
.member-role,
.member-meta {
  font-size: calc(var(--fs) * 1.4); /* 14（基准） */
}
.member-sub {
  font-size: calc(var(--fs) * 1.4);
}

/* 无边卡片：纯 base 色填充，去掉金属边框 */
.card-face {
  border: none;
  background: var(--color-base-100);
}

/* 无障碍：减少动态时关闭旋转/放大 */
@media (prefers-reduced-motion: reduce) {
  .hover-3d > :first-child,
  .hover-3d:hover > :first-child {
    transform: none;
    scale: 1;
    transition: none;
  }
}
</style>
