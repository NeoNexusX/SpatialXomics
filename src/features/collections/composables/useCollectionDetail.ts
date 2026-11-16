import { computed, onMounted, shallowRef, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/shared/auth/authStore'
import { useLatestRequest } from '@/shared/composables/useLatestRequest'
import { collectionErrorMessage, getPublicCollection } from '../api/collectionApi'
import { isCollectionApiError } from '../types/collection'
import type { CollectionDetail } from '../types/collection'
import { t } from '@/i18n'

/**
 * Collection Overview 页的数据装配：详情拉取 + owner/admin 编辑权判定。
 * 所有成员写操作（增/删/调序）成功后通过 applyDetail() 回写这里持有的
 * detail（响应即完整 CollectionDetail），保证单一数据源。
 * public_id 来自路径参数 /collections/overview/{public_id}（与数据集详情
 * /overview/{public_id} 同方案）。详情读取走免登录公开接口
 * GET /collections/public/{public_id}：认证版 GET /collections/{public_id}
 * 是 owner 限定的，浏览他人集合（列表来自 /collections/list_all）必须走
 * 公开接口；写操作（编辑/删除/成员管理）仍走认证接口，由后端按 owner 鉴权。
 */
export function useCollectionDetail() {
  const auth = useAuthStore()
  const route = useRoute()

  const detail = shallowRef<CollectionDetail | null>(null)
  const loading = ref(false)
  const error = ref('')
  const notFound = ref(false)

  const publicId = computed(() =>
    typeof route.params.publicId === 'string' && route.params.publicId ? route.params.publicId : '',
  )
  const isStale = computed(() => !publicId.value)

  // 写操作仅限 owner 或 admin（与后端权限一致）
  const canEdit = computed(
    () => !!detail.value && (detail.value.ownerUsername === auth.user?.username || auth.isAdmin),
  )

  const requests = useLatestRequest()

  async function fetch() {
    if (isStale.value) return
    const isCurrent = requests.begin()
    loading.value = true
    error.value = ''
    notFound.value = false
    try {
      const next = await getPublicCollection(publicId.value)
      if (isCurrent()) detail.value = next
    } catch (err: any) {
      if (!isCurrent()) return
      notFound.value = isCollectionApiError(err) && err.status === 404
      error.value = collectionErrorMessage(
        err,
        t('common.feedback.loadFailed', { target: t('collections.overview.target') }),
      )
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  function applyDetail(next: CollectionDetail) {
    detail.value = next
  }

  onMounted(fetch)
  // 同一路由换了参数时组件不会重建（如浏览器前进后退）
  watch(publicId, fetch)

  return { detail, loading, error, notFound, isStale, canEdit, publicId, fetch, applyDetail }
}
