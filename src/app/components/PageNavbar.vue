<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/shared/auth/authStore'
import SvgIcon from '@/shared/components/SvgIcon.vue'
import { getBrandParts } from '@/shared/config/appName'
import { useTheme } from '@/shared/composables/useTheme'
import { useLocale } from '@/shared/composables/useLocale'
import { t } from '@/i18n'
import { localized } from '@/shared/config/localizedText'
import { getConfig, isNavVisible, filterNavItems } from '@/shared/config/runtimeConfig'
import type {
  NavGuestLink,
  NavItem,
  NavUserItem,
  NavVisibility,
} from '@/shared/config/runtimeConfig'

const router = useRouter()
const emit = defineEmits<{ resize: [height: number] }>()
const navbarElement = useTemplateRef<HTMLElement>('navbarElement')
useResizeObserver(
  navbarElement,
  () => {
    emit('resize', navbarElement.value?.getBoundingClientRect().height ?? 0)
  },
  { box: 'border-box' },
)
onBeforeUnmount(() => emit('resize', 0))
const authStore = useAuthStore()
const { user, isAdmin } = storeToRefs(authStore)
const { isDark, toggleTheme } = useTheme()
const { nextLocale, toggleLocale } = useLocale()

const isAuthenticated = computed(() => !!user.value)

// 与 NavDrawer 一致：把大写 X 拆出做渐变，没有 X 时回退为完整名称
const { pre: namePre, x: nameX, post: namePost } = getBrandParts()

const initials = computed(() => user.value?.username?.slice(0, 2).toUpperCase() ?? '')

// 统一导航配置（与 NavDrawer 共用一份 config.json 的 nav 块）
const navbar = computed(() => getConfig().nav!)
const guestHint = computed(() => localized(navbar.value.guestHint) || t('common.nav.signIn'))

// label 可能是按语言分写的对象，不能直接当 key；分组没有 to，用位置区分
const navKey = (item: NavItem, i: number): string =>
  item.kind === 'group' ? `group-${i}` : item.to

const visible = (i: NavVisibility): boolean =>
  isNavVisible(i, { isAuthenticated: isAuthenticated.value, isAdmin: isAdmin.value })

// 与 NavDrawer 相同的过滤规则：先过滤自身再过滤 children，子项被过滤光的分组整组隐藏
const items = computed<NavItem[]>(() =>
  filterNavItems(navbar.value.items, {
    isAuthenticated: isAuthenticated.value,
    isAdmin: isAdmin.value,
  }),
)

const userItems = computed<NavUserItem[]>(() => navbar.value.userMenu.filter(visible))
const guestLinks = computed<NavGuestLink[]>(() => navbar.value.guestLinks.filter(visible))

// details 下拉不会因路由跳转自动收起，点击子项后手动收起
const closeDetails = (e: MouseEvent) => {
  ;(e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}

// daisyui dropdown 靠 :focus-within 展开，跳转后焦点仍留在菜单里，需主动 blur 收起
const closeDropdown = () => {
  ;(document.activeElement as HTMLElement | null)?.blur()
}

const onMenuToggleLocale = () => {
  closeDropdown()
  void toggleLocale()
}

const onUserAction = async (action: 'logout') => {
  closeDropdown()
  if (action === 'logout') {
    await authStore.logout()
    router.push('/login')
  }
}
</script>

<template>
  <!-- sticky z-40：顶栏随滚动保持在顶部，下拉菜单盖过页面内容的 stacking context。

       字号一律挂档位，逐处独立。daisyUI 的 .btn / .menu-title 自带固定 font-size，
       所以每处都要显式覆盖。尺寸（[--size:…em]、w-[16em]）继续用 em，
       读所在元素字号，换档时自动跟着缩放。 -->
  <div
    ref="navbarElement"
    class="navbar page-navbar sticky top-0 z-40 shrink-0 px-2 md:px-6 kawaru-text-100"
  >
    <!-- start: 品牌 + 移动端汉堡菜单（小屏合并展示全部分组与用户菜单） -->
    <div class="navbar-start">
      <div class="dropdown">
        <div
          tabindex="0"
          role="button"
          class="btn btn-ghost lg:hidden kawaru-text-100 [--size:2.6em]"
          :aria-label="$t('common.nav.openMenu')"
        >
          <SvgIcon type="bars3" class="w-[1.4em] h-[1.4em]" />
        </div>
        <ul
          tabindex="0"
          class="menu dropdown-content nav-glass-panel rounded-box z-[1] mt-5 w-[16em] p-2 shadow-lg kawaru-text-95"
        >
          <!-- 只放导航分组：Profile / Sign in 等入口由右侧头像下拉承担，这里不重复。
               分段大标题比内容字号大一档；独立链接（如 Documentation）按同级大标题样式渲染 -->
          <template v-for="(item, i) in items" :key="navKey(item, i)">
            <template v-if="item.kind === 'group'">
              <li
                class="menu-title kawaru-text-100 font-semibold text-base-content/80"
                :class="i > 0 ? 'mt-3' : ''"
              >
                {{ localized(item.label) }}
              </li>
              <li v-for="child in item.children" :key="child.to">
                <a
                  v-if="child.external"
                  :href="child.to"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="rounded-lg transition-colors"
                  @click="closeDropdown"
                  >{{ localized(child.label) }}</a
                >
                <router-link
                  v-else
                  :to="child.to"
                  class="rounded-lg transition-colors"
                  active-class="!bg-primary/10 !text-primary font-medium"
                  @click="closeDropdown"
                  >{{ localized(child.label) }}</router-link
                >
              </li>
            </template>
            <li v-else :class="i > 0 ? 'mt-3' : ''">
              <a
                v-if="item.external"
                :href="item.to"
                target="_blank"
                rel="noopener noreferrer"
                class="rounded-lg kawaru-text-100 font-semibold transition-colors"
                @click="closeDropdown"
                >{{ localized(item.label) }}</a
              >
              <router-link
                v-else
                :to="item.to"
                class="rounded-lg kawaru-text-100 font-semibold transition-colors"
                active-class="!bg-primary/10 !text-primary"
                @click="closeDropdown"
                >{{ localized(item.label) }}</router-link
              >
            </li>
          </template>
          <!-- 手机宽度下右侧放不下语言按钮（会顶到品牌名），改在菜单底部提供；sm 及以上回到右侧圆形按钮 -->
          <li
            v-if="navbar.localeToggle !== false"
            class="mt-3 border-t border-base-200 pt-2 sm:hidden"
          >
            <a class="rounded-lg transition-colors" @click="onMenuToggleLocale">
              <SvgIcon type="region" class="w-[1.2em] h-[1.2em] text-base-content/60" />
              {{ nextLocale.label }}
            </a>
          </li>
        </ul>
      </div>

      <!-- 品牌名必须包在单个 span 里：.btn 是带 gap 的 flex 容器，裸文本节点会被拆成多个 flex item 出现空隙。
           X 保留 text-[1.2em]：这是字标内部「X 比其余字母大 1.2 倍」的排版比例，
           父级已是绝对档位，所以整条链确定（1.5 × 1.2 = 基准的 1.8 倍），不是叠乘隐患。 -->
      <router-link to="/" class="btn btn-ghost h-auto min-h-0 px-2 py-[0.2em] kawaru-text-150">
        <span class="font-medium leading-none">
          {{ namePre
          }}<span
            class="brand-text bg-gradient-to-bl from-[var(--brand-accent)] to-primary font-['Outfit',sans-serif] text-[1.2em]"
            style="font-synthesis: style"
            >{{ nameX }}</span
          >{{ namePost }}
        </span>
      </router-link>
    </div>

    <!-- center: 大屏水平菜单（details/summary 原生下拉；数据全部来自 config.json 的 navbar 块） -->
    <div class="navbar-center hidden lg:flex">
      <ul class="menu menu-horizontal gap-[0.25em] px-1 kawaru-text-100">
        <li v-for="(item, i) in items" :key="navKey(item, i)">
          <details v-if="item.kind === 'group'">
            <summary
              class="rounded-lg px-[1em] py-[0.45em] font-medium transition-colors hover:bg-base-200/70"
            >
              {{ localized(item.label) }}
            </summary>
            <ul
              class="z-[1] mt-2 w-[13em] whitespace-nowrap rounded-box nav-glass-panel p-2 shadow-lg kawaru-text-87"
            >
              <li v-for="child in item.children" :key="child.to">
                <a
                  v-if="child.external"
                  :href="child.to"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="rounded-lg py-[0.55em] transition-colors hover:bg-base-200/60"
                  @click="closeDetails"
                  >{{ localized(child.label) }}</a
                >
                <router-link
                  v-else
                  :to="child.to"
                  class="rounded-lg py-[0.55em] transition-colors hover:bg-base-200/60"
                  active-class="!bg-primary/10 !text-primary font-medium"
                  @click="closeDetails"
                  >{{ localized(child.label) }}</router-link
                >
              </li>
            </ul>
          </details>
          <a
            v-else-if="item.external"
            :href="item.to"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-lg px-[1em] py-[0.45em] font-medium transition-colors hover:bg-base-200/70"
            >{{ localized(item.label) }}</a
          >
          <router-link
            v-else
            :to="item.to"
            class="rounded-lg px-[1em] py-[0.45em] font-medium transition-colors hover:bg-base-200/70"
            active-class="!bg-primary/10 !text-primary"
            >{{ localized(item.label) }}</router-link
          >
        </li>
      </ul>
    </div>

    <!-- end: 语言切换 + 主题切换 + 头像（登录后下拉用户菜单 / 未登录占位头像带登录指引） -->
    <div class="navbar-end gap-[0.4em]">
      <!-- 显示「将要切换到」的语言简称（中文界面显示 EN，英文界面显示 中），与主题按钮同尺寸。
           手机宽度下隐藏，入口移到左侧汉堡菜单底部。 -->
      <button
        v-if="navbar.localeToggle !== false"
        class="btn btn-ghost btn-circle kawaru-text-100 [--size:2.6em] hidden sm:inline-flex"
        :aria-label="$t('common.language.switch')"
        :title="nextLocale.label"
        @click="toggleLocale"
      >
        <span class="kawaru-text-87 font-semibold leading-none">{{ nextLocale.short }}</span>
      </button>

      <button
        v-if="navbar.themeToggle !== false"
        class="btn btn-ghost btn-circle kawaru-text-100 [--size:2.6em]"
        :aria-label="$t('common.nav.toggleTheme')"
        @click="toggleTheme"
      >
        <SvgIcon v-if="!isDark" type="sun" class="w-[1.5em] h-[1.5em] text-yellow-400" />
        <SvgIcon v-else type="moon" class="w-[1.5em] h-[1.5em] text-indigo-300" />
      </button>

      <template v-if="isAuthenticated">
        <div class="dropdown dropdown-end">
          <!-- daisyui 5 里占位头像类是 avatar-placeholder（旧版 placeholder 不再居中内容） -->
          <div
            tabindex="0"
            role="button"
            class="btn btn-ghost btn-circle avatar avatar-placeholder kawaru-text-100 [--size:2.6em]"
          >
            <div
              class="w-[2.2em] rounded-full bg-gradient-to-br from-[var(--brand-accent)] to-primary text-primary-content"
            >
              <span class="kawaru-text-87 font-medium">{{ initials }}</span>
            </div>
          </div>
          <ul
            tabindex="0"
            class="menu dropdown-content nav-glass-panel rounded-box z-[1] mt-3 w-[14em] p-2 shadow-lg kawaru-text-95"
          >
            <li class="menu-title kawaru-text-75">{{ user?.username }}</li>
            <template v-for="item in userItems" :key="item.kind === 'link' ? item.to : item.action">
              <li v-if="item.kind === 'link'">
                <router-link
                  :to="item.to"
                  class="rounded-lg transition-colors"
                  @click="closeDropdown"
                >
                  {{ localized(item.label) }}
                </router-link>
              </li>
              <li v-else>
                <a class="rounded-lg transition-colors" @click="onUserAction(item.action)">{{
                  localized(item.label)
                }}</a>
              </li>
            </template>
          </ul>
        </div>
      </template>
      <template v-else>
        <!-- 未登录：占位头像 + tooltip 提示，点开列出登录/注册入口 -->
        <div class="dropdown dropdown-end">
          <div
            tabindex="0"
            role="button"
            class="btn btn-ghost btn-circle avatar avatar-placeholder tooltip tooltip-bottom kawaru-text-100 [--size:2.6em]"
            :data-tip="guestHint"
            :aria-label="guestHint"
          >
            <div class="w-[2.2em] rounded-full bg-base-200 text-base-content/60">
              <SvgIcon type="user-circle" class="w-[1.6em] h-[1.6em]" />
            </div>
          </div>
          <ul
            tabindex="0"
            class="menu dropdown-content nav-glass-panel rounded-box z-[1] mt-3 w-[14em] p-2 shadow-lg kawaru-text-95"
          >
            <li class="menu-title kawaru-text-75">{{ $t('common.nav.notSignedIn') }}</li>
            <li v-for="link in guestLinks" :key="link.to">
              <router-link
                :to="link.to"
                class="rounded-lg transition-colors"
                :class="link.primary ? '!text-primary font-medium' : ''"
                @click="closeDropdown"
                >{{ localized(link.label) }}</router-link
              >
            </li>
          </ul>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Hero's cool surface colours, with a translucent finish for navigation. */
.page-navbar {
  --nav-glass-surface: #edf1f4;
  --nav-glass-highlight: rgb(255 255 255 / 0.5);
  --nav-glass-line: color-mix(in oklab, var(--color-base-content) 10%, transparent);
  --nav-glass-shadow: rgb(28 45 64 / 0.12);
  border-bottom: 1px solid var(--nav-glass-line);
  box-shadow:
    inset 0 1px var(--nav-glass-highlight),
    0 4px 18px -12px var(--nav-glass-shadow);
}
.page-navbar,
.nav-glass-panel {
  /* Opaque fallback where backdrop filtering is unavailable. */
  background: var(--nav-glass-surface);
}
.nav-glass-panel {
  border: 1px solid var(--nav-glass-line);
  box-shadow:
    inset 0 1px var(--nav-glass-highlight),
    0 12px 32px -12px var(--nav-glass-shadow);
}
[data-theme='dark'] .page-navbar {
  --nav-glass-surface: #232a33;
  --nav-glass-highlight: rgb(255 255 255 / 0.06);
  --nav-glass-line: rgb(230 239 250 / 0.12);
  --nav-glass-shadow: rgb(0 0 0 / 0.4);
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .page-navbar,
  .nav-glass-panel {
    background:
      linear-gradient(115deg, var(--nav-glass-highlight), transparent 65%),
      color-mix(in oklab, var(--nav-glass-surface) 82%, transparent);
    -webkit-backdrop-filter: blur(24px) saturate(0.85);
    backdrop-filter: blur(24px) saturate(0.85);
  }
}
</style>
