<template>
  <!-- 统一导航：按当前路由选择形态（config.json 的 nav.mode + nav.modeByPath）。
       navbar 形态渲染顶栏；drawer 形态渲染左侧抽屉 + 右下角 FAB；none 什么都不渲染。 -->
  <PageNavbar v-if="mode === 'navbar'" />
  <template v-else-if="mode === 'drawer'">
    <NavDrawer v-model:open="sidebarOpen" :user="user" :is-admin="authStore.isAdmin" />
    <NavFab
      v-model:open="sidebarOpen"
      :user="user"
      :is-admin="authStore.isAdmin"
      :is-dark="isDark"
      @toggle-theme="toggleTheme"
      @toggle-locale="toggleLocale"
      @toggle-ai="showAI = !showAI"
      @logout="logout"
    />
  </template>
  <FloatingAgent v-model:show="showAI" />
</template>

<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/shared/auth/authStore'
import NavDrawer from './NavDrawer.vue'
import NavFab from './NavFab.vue'
import PageNavbar from './PageNavbar.vue'
import FloatingAgent from '@/features/agent/components/FloatingAgent.vue'
import { useTheme } from '@/shared/composables/useTheme'
import { toggleLocale } from '@/shared/composables/useLocale'
import { resolveNavMode } from '@/shared/config/runtimeConfig'

const router = useRouter()
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)

// 主题来自全站单例（已在 main.ts initTheme 初始化），切换即全局同步
const { isDark, toggleTheme } = useTheme()

const mode = computed(() => resolveNavMode(router.currentRoute.value.path))

const sidebarOpen = ref(false)
const showAI = ref(false)

const logout = async () => {
  await authStore.logout()
  router.push('/login')
}

onMounted(() => {
  if (!user.value) {
    authStore.fetchUser().catch(() => {})
  }
})

// Auto-open sidebar after fresh login redirect（navbar 形态没有抽屉，只消费标记不弹出）
watch(
  () => router.currentRoute.value.path,
  () => {
    if (sessionStorage.getItem('just_logged_in')) {
      sessionStorage.removeItem('just_logged_in')
      if (mode.value === 'drawer') {
        sidebarOpen.value = true
      }
    }
  },
)
</script>
