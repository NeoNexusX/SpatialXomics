import { computed, reactive, ref, type Ref } from 'vue'
import { useToast } from '@/shared/composables/useToast'
import { collectionErrorMessage, updateCollection } from '../api/collectionApi'
import { metadataMaxLength } from '../constants/metadataFields'
import { buildMetadataPatch, toMetadataDraft } from '../utils/metadataPatch'
import type { CollectionDetail, CollectionMetadata, CollectionMetadataDraft } from '../types/collection'
import { t } from '@/i18n'

/**
 * 保存前的长度校验与输入框 maxlength 同源（字段定义表的 maxLength，即后端写入校验的上限）。
 * 输入框已经拦住了输入，这里是兜底：绕过 maxlength 进到草稿里的超长内容不能发出去。
 * 未定义上限的字段不设限。
 */
const NAME_MAX_LENGTH = metadataMaxLength('name') ?? Number.POSITIVE_INFINITY
const DESCRIPTION_MAX_LENGTH = metadataMaxLength('description') ?? Number.POSITIVE_INFINITY

/**
 * Overview 页的原地编辑（不再弹窗）：Edit → 页内字段变输入框 → Save/Cancel。
 *
 * 草稿差量（buildMetadataPatch）决定提交内容——只发变化的字段（exclude_unset 语义），
 * 没有变化时 Save 禁用。与创建页共用 metadataPatch 的差量语义。
 */
export function useCollectionEdit(options: {
  /** 当前详情（useCollectionDetail 的 detail），编辑基线来自它 */
  detail: Ref<CollectionDetail | null>
  /** 保存成功后回写详情（通常是 applyDetail） */
  onSaved: (detail: CollectionDetail) => void
}) {
  const { showToast } = useToast()

  const editing = ref(false)
  const draft = ref<CollectionMetadataDraft | null>(null)
  const saving = ref(false)
  const validationError = ref('')

  /**
   * 编辑基线：元数据 + 顶层 name/description。
   * 顶层字段是权威值（metadata.name 可能是旧值），与只读面板展示的同源。
   */
  function baseline(): CollectionMetadata | null {
    const d = options.detail.value
    if (!d) return null
    return { ...d.metadata, name: d.name, description: d.description ?? '' }
  }

  /** 进入编辑态：以当前详情初始化草稿 */
  function start() {
    const base = baseline()
    if (!base) return
    draft.value = reactive(toMetadataDraft(base)) as CollectionMetadataDraft
    validationError.value = ''
    editing.value = true
  }

  /** 取消：丢弃草稿（saving 中不允许中断，避免请求结果落在已关闭的表单上） */
  function cancel() {
    if (saving.value) return
    editing.value = false
    draft.value = null
  }

  /** 差量即脏态：没有变化的字段时 Save 禁用 */
  const isDirty = computed(() => {
    const base = baseline()
    if (!base || !draft.value) return false
    return Object.keys(buildMetadataPatch(base, draft.value)).length > 0
  })

  async function save() {
    const current = draft.value
    if (!current || saving.value) return

    const name = current.name.trim()
    if (!name) {
      validationError.value = t('collections.validation.nameRequired')
      return
    }
    if (name.length > NAME_MAX_LENGTH) {
      validationError.value = t('collections.validation.nameTooLong', { max: NAME_MAX_LENGTH })
      return
    }
    if ((current.description ?? '').length > DESCRIPTION_MAX_LENGTH) {
      validationError.value = t('collections.validation.descriptionTooLong', {
        max: DESCRIPTION_MAX_LENGTH,
      })
      return
    }

    const patch = buildMetadataPatch(baseline()!, current)
    if (!Object.keys(patch).length) {
      cancel()
      return
    }

    saving.value = true
    validationError.value = ''
    try {
      const next = await updateCollection(options.detail.value!.publicId, patch)
      showToast(t('common.feedback.updated'), 'success')
      options.onSaved(next)
      editing.value = false
      draft.value = null
    } catch (err: any) {
      // 留在编辑态，草稿不丢，用户改完可直接重试
      showToast(collectionErrorMessage(err, t('common.feedback.updateFailed')), 'error')
    } finally {
      saving.value = false
    }
  }

  return { editing, draft, saving, validationError, isDirty, start, cancel, save }
}
