import { computed, ref, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { File } from '@/features/datasets/types/dataset'
import { useToast } from '@/shared/composables/useToast'
import { useCopyToClipboard } from '@/shared/composables/useCopyToClipboard'
import { t } from '@/i18n'
import { buildOverviewShareUrl, isValidPublicId } from '@/features/datasets/utils/overviewShareLink'

/** Route parsing, link creation, and clipboard state for public Overview sharing. */
export function useOverviewShare(dataset: Ref<File | null>) {
  const route = useRoute()
  const router = useRouter()
  const { showToast } = useToast()
  const { copy } = useCopyToClipboard()

  const isShareView = computed(() => route.name === 'SharedDatasetOverview')
  // 16 位 publicId 才是有效链接，其余由 useDatasetDetail.isInvalidShare 按死链处理
  const sharedToken = computed(() => {
    const token = isShareView.value ? route.params.shareToken : null
    return isValidPublicId(token) ? token : null
  })
  const isShareCopied = ref(false)

  // 分享不再要求文件公开：私有/公开统一凭 public_id 生成 /s/{public_id} 链接，
  // 接收端需登录浏览（匿名由分享页就地引导登录）。是否公开走 Make Public，与分享解耦
  const shareCurrent = async () => {
    const current = dataset.value

    const shareUrl = buildOverviewShareUrl(router, current?.publicId ?? '', window.location.origin)
    if (!shareUrl) {
      showToast(t('datasets.overview.shareUnavailable'), 'error')
      return
    }

    if (await copy(shareUrl)) {
      isShareCopied.value = true
      setTimeout(() => {
        isShareCopied.value = false
      }, 2000)
    }
  }

  return {
    isShareView,
    sharedToken,
    isShareCopied,
    shareCurrent,
  }
}
