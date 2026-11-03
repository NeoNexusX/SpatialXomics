import { computed, ref, shallowRef, type ShallowRef } from 'vue'
import { useToast } from '@/shared/composables/useToast'
import { addMembers, collectionErrorMessage, removeMembers, reorderMembers } from '../api/collectionApi'
import { isCollectionApiError } from '../types/collection'
import type { CollectionDetail, CollectionMember } from '../types/collection'
import { t } from '@/i18n'

/** 409 order conflict 的标准处理：提示 + 拉最新列表让用户重试（不自动合并） */
const ORDER_CONFLICT_MESSAGE = 'collection member order conflict'

export interface UseCollectionMembersOptions {
  /** 持有详情的 ref（owner: useCollectionDetail），写操作成功后整体回写 */
  detail: ShallowRef<CollectionDetail | null>
  /** 重拉详情（removeMembers 响应只含对账结果，需要刷新拿最新成员） */
  refresh: () => Promise<unknown>
}

/**
 * 集合成员管理：添加（追加到末尾）/ 批量移除（removed/skipped 对账）/ 调序
 * （全量重写语义 + 乐观更新）。所有操作的 409 细分文案在此收口。
 */
export function useCollectionMembers(options: UseCollectionMembersOptions) {
  const { detail, refresh } = options
  const { showToast } = useToast()

  const adding = ref(false)
  const removing = ref(false)
  const reordering = ref(false)

  // 调序乐观覆盖层：null = 直接展示 detail.members（服务端版本）
  const override = shallowRef<CollectionMember[] | null>(null)
  const members = computed(() => override.value ?? detail.value?.members ?? [])

  function syncFromServer() {
    override.value = null
  }

  function errorText(err: any, fallback: string): string {
    return collectionErrorMessage(err, fallback)
  }

  // ---- 添加成员：响应即完整 CollectionDetail，直接回写。
  // 返回是否成功——调用方据此决定是否关闭选集弹窗（失败时保留用户的选择便于重试）----
  async function add(filePublicIds: string[]): Promise<boolean> {
    if (!detail.value || !filePublicIds.length || adding.value) return false
    adding.value = true
    try {
      detail.value = await addMembers(detail.value.publicId, filePublicIds)
      syncFromServer()
      showToast(t('common.feedback.added'), 'success')
      return true
    } catch (err: any) {
      showToast(errorText(err, t('common.feedback.addFailed')), 'error')
      // 409（资格/上限）后服务端状态可能已变，拉一次最新保持一致
      if (isCollectionApiError(err) && err.status === 409) await refresh()
      return false
    } finally {
      adding.value = false
    }
  }

  // ---- 移除成员：消费 removed/skipped 对账后重拉 ----
  async function remove(publicIds: string[]) {
    if (!detail.value || !publicIds.length || removing.value) return
    removing.value = true
    try {
      const result = await removeMembers(detail.value.publicId, publicIds)
      const parts = [t('collections.toast.removedCount', { count: result.removed.length })]
      if (result.skipped.length) {
        parts.push(t('collections.toast.skippedCount', { count: result.skipped.length }))
      }
      showToast(parts.join(t('collections.toast.separator')), 'success')
      await refresh()
    } catch (err: any) {
      showToast(errorText(err, t('common.feedback.removeFailed')), 'error')
    } finally {
      removing.value = false
    }
  }

  // ---- 调序：本地乐观重排 → 全量重写；409 冲突时重拉覆盖，其他失败回滚 ----
  async function reorder(from: number, to: number) {
    const current = members.value
    if (!detail.value || reordering.value) return
    if (from === to || from < 0 || from >= current.length || to < 0 || to >= current.length) return

    const optimistic = [...current]
    const [item] = optimistic.splice(from, 1)
    optimistic.splice(to, 0, item!)
    override.value = optimistic

    reordering.value = true
    try {
      // 全量重写：数组必须恰好等于当前成员全集
      detail.value = await reorderMembers(
        detail.value.publicId,
        optimistic.map((m) => m.publicId),
      )
      syncFromServer()
    } catch (err: any) {
      // 这里匹配的是后端英文原文，不要改成匹配译文
      if (isCollectionApiError(err) && err.backendMessage.includes(ORDER_CONFLICT_MESSAGE)) {
        showToast(t('collections.toast.reorderConflict'), 'warning')
      } else {
        showToast(errorText(err, t('common.feedback.updateFailed')), 'error')
      }
      // 冲突或失败：以服务端版本为准（重拉）
      await refresh()
      syncFromServer()
    } finally {
      reordering.value = false
    }
  }

  return { members, adding, removing, reordering, add, remove, reorder }
}
