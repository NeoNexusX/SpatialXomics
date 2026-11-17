<template>
  <!-- 共享顶栏实际高度，首页据此计算可用视口；抽屉模式下高度为 0。 -->
  <div
    class="min-h-[100dvh] max-w-full overflow-x-clip flex flex-col transition-colors duration-300"
    :style="{ '--app-navbar-height': `${navbarHeight}px` }"
  >
    <Navbar @resize="navbarHeight = $event" />
    <!-- Main content area -->
    <main class="flex-1 w-full relative flex flex-col">
      <router-view></router-view>
      <ToastContainer />
    </main>
  </div>
</template>

<script setup lang="ts">
import { shallowRef } from 'vue'
import Navbar from './components/Navbar.vue'
import ToastContainer from '@/shared/components/ToastContainer.vue'

const navbarHeight = shallowRef(0)
</script>
