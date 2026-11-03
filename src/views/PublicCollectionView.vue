<template>
  <div class="min-h-screen bg-base-200">
    <div class="max-w-[1680px] mx-auto p-4 md:p-8 kawaru-text-100">
      <!-- Loading -->
      <div v-if="loading" class="flex flex-col gap-6">
        <div class="skeleton h-16 rounded-xl"></div>
        <div class="skeleton h-40 rounded-xl"></div>
        <div class="skeleton h-64 rounded-xl"></div>
      </div>

      <!-- 错误态：链接无效 / 集合不存在（后端对非公开集合也返回 404，不暴露存在性） -->
      <div
        v-else-if="error"
        class="p-12 bg-base-100 dark:bg-slate-800 rounded-xl border border-base-300 text-center"
      >
        <SvgIcon type="circle_stack" class="h-12 w-12 mx-auto text-base-content/30 mb-4" />
        <h3 class="kawaru-text-112 font-bold text-base-content">
          {{ $t('collections.overview.notFound') }}
        </h3>
        <p class="mt-2 text-base-content/60">
          {{ $t('collections.public.notFoundDesc') }}
        </p>
        <router-link to="/" class="btn btn-primary mt-6 kawaru-text-100">{{
          $t('collections.public.backHome')
        }}</router-link>
      </div>

      <template v-else-if="detail">
        <!-- 与正常进入的 Collection Overview 使用相同的页头结构。 -->
        <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div class="min-w-0">
            <router-link
              to="/collections"
              class="inline-flex items-center gap-1 kawaru-text-87 text-base-content/60 hover:text-primary transition-colors"
            >
              <SvgIcon type="back" class="w-[0.9em] h-[0.9em]" />
              {{ $t('common.page.collections') }}
            </router-link>
            <h1
              class="kawaru-text-page-title leading-[1.15] font-bold text-base-content mt-1 truncate"
              :title="detail.name"
            >
              {{ detail.name }}
            </h1>
            <p v-if="detail.title" class="text-base-content/70 mt-0.5 truncate">
              {{ detail.title }}
            </p>
          </div>
        </div>

        <!-- 统计条 -->
        <div
          class="flex flex-wrap items-center gap-x-6 gap-y-2 bg-base-100 dark:bg-slate-800 rounded-xl shadow-sm border border-base-300 px-4 py-3 mb-6 kawaru-text-87 text-base-content/70"
        >
          <span class="inline-flex items-center gap-1.5">
            <SvgIcon type="queue_list" class="w-[1.1em] h-[1.1em]" />
            <span class="font-semibold text-base-content">{{ detail.memberCount }}</span>
            {{ $t('collections.unit.dataset', detail.memberCount) }}
          </span>
          <span class="inline-flex items-center gap-1.5">
            <SvgIcon type="folder" class="w-[1.1em] h-[1.1em]" />
            {{ formatBytes(detail.totalSize) }}
          </span>
          <span
            class="inline-flex items-center gap-1.5"
            :title="$t('collections.card.owner', { name: detail.ownerUsername })"
          >
            <SvgIcon type="user" class="w-[1.1em] h-[1.1em]" />
            {{ detail.ownerUsername }}
          </span>
          <span v-if="updatedDate" class="ml-auto whitespace-nowrap">
            {{ $t('collections.card.updated', { date: updatedDate }) }}
          </span>
        </div>

        <!-- 与正常详情页一致：先展示成员，再展示学术元数据。 -->
        <CollectionMemberList
          :members="detail.members"
          :manage-mode="false"
          @download="downloadMember"
        />

        <CollectionMetadataPanel class="mt-6" :metadata="detail.metadata" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import CollectionMetadataPanel from '@/features/collections/components/CollectionMetadataPanel.vue'
import CollectionMemberList from '@/features/collections/components/CollectionMemberList.vue'
import {
  collectionErrorMessage,
  getPublicCollection,
} from '@/features/collections/api/collectionApi'
import type {
  CollectionMember,
  PublicCollectionDetail,
} from '@/features/collections/types/collection'
import { useDownloadProgress } from '@/features/datasets/composables/useDownloadProgress'
import { formatBytes, formatDate } from '@/shared/utils/format'
import { t } from '@/i18n'

const route = useRoute()

// 公开页响应不带数字 id（对外只用 public_id），成员下载也走文件级 public_id
const detail = ref<PublicCollectionDetail | null>(null)
const loading = ref(false)
const error = ref('')

const publicId = computed(() => String(route.params.publicId))

async function fetch() {
  loading.value = true
  error.value = ''
  try {
    detail.value = await getPublicCollection(publicId.value)
  } catch (err: any) {
    error.value = collectionErrorMessage(err, t('collections.overview.notFound'))
  } finally {
    loading.value = false
  }
}

const updatedDate = computed(() => formatDate(detail.value?.updatedAt))

// 下载与数据集分享页统一：走认证 download_raw（含登录 + 身份完整校验）；
// noauth 端点保留但不再使用。匿名查看由路由 requiresAuth 守卫拦截。
const { handleDownloadRaw } = useDownloadProgress()

function downloadMember(member: CollectionMember) {
  handleDownloadRaw(member.publicId)
}

watch(publicId, fetch)
onMounted(fetch)
</script>

<style scoped>
/* Layout handled by Tailwind classes */
</style>
