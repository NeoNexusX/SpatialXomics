import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { t } from '@/i18n'
import type { File } from '../types/dataset'
import type { FileMetadataPatch } from '../api/datasetApi'
import {
  FILE_METADATA_KEYS,
  FILE_METADATA_MAX_STRING_LENGTH,
  buildFileMetadataPatch,
  changedFileMetadataKeys,
  isFileMetadataNumberKey,
  toFileMetadataDraft,
  validateFileMetadataDraft,
  type FileMetadataDraft,
  type FileMetadataKey,
  type FileMetadataValidationIssue,
} from '../utils/fileMetadataPatch'

/** Owns draft validation and reset; the dialog owns saving, notifications and focus. */
export function useFileMetadataDraft(baseline: Readonly<Ref<File | null>>) {
  const draft = ref<FileMetadataDraft | null>(null)
  const inputRevision = shallowRef(0)
  const backendFieldErrors = shallowRef<
    Partial<Record<FileMetadataKey, { value: string; message: string }>>
  >({})

  function resetDraft() {
    draft.value = baseline.value ? toFileMetadataDraft(baseline.value) : null
    backendFieldErrors.value = {}
    inputRevision.value++
  }

  /** 前端校验：字符串 <= 128；数值 >= 0 且不能是 NaN / Infinity */
  const clientFieldErrors = computed<Partial<Record<FileMetadataKey, string>>>(() => {
    const errors: Partial<Record<FileMetadataKey, string>> = {}
    if (!baseline.value || !draft.value) return errors
    for (const { key, kind } of validateFileMetadataDraft(baseline.value, draft.value)) {
      errors[key] =
        kind === 'tooLong'
          ? t('datasets.metadata.tooLong', { max: FILE_METADATA_MAX_STRING_LENGTH })
          : t('datasets.metadata.invalidNumber')
    }
    return errors
  })

  const fieldErrors = computed<Partial<Record<FileMetadataKey, string>>>(() => {
    const errors: Partial<Record<FileMetadataKey, string>> = {}
    for (const key of FILE_METADATA_KEYS) {
      const error = backendFieldErrors.value[key]
      // 编辑别的字段不会清除这条错误；修正对应输入后才移除。
      if (error && draft.value?.[key] === error.value) errors[key] = error.message
    }
    return { ...errors, ...clientFieldErrors.value }
  })

  const hasFieldErrors = computed(() => Object.keys(fieldErrors.value).length > 0)
  const patchPayload = computed<FileMetadataPatch>(() =>
    baseline.value && draft.value ? buildFileMetadataPatch(baseline.value, draft.value) : {},
  )
  const changeCount = computed(() => Object.keys(patchPayload.value).length)
  const dirty = computed(() => changeCount.value > 0)
  const canReset = computed(
    () =>
      !!baseline.value &&
      !!draft.value &&
      changedFileMetadataKeys(baseline.value, draft.value).length > 0,
  )

  /** 后端 422 的 msg 多为通用英文；已知类型优先用本地文案，其余保留后端原文 */
  function localizeIssue(issue: FileMetadataValidationIssue): string {
    if (issue.type === 'string_too_long') {
      return t('datasets.metadata.tooLong', { max: FILE_METADATA_MAX_STRING_LENGTH })
    }
    if (issue.key && isFileMetadataNumberKey(issue.key)) {
      return t('datasets.metadata.invalidNumber')
    }
    return issue.msg
  }

  function applyValidationIssues(
    issues: FileMetadataValidationIssue[],
    submitted: FileMetadataDraft,
  ) {
    const mapped: typeof backendFieldErrors.value = {}
    const messages: string[] = []
    for (const issue of issues) {
      const message = localizeIssue(issue)
      if (issue.key) mapped[issue.key] = { value: submitted[issue.key], message }
      else messages.push(message)
    }
    backendFieldErrors.value = mapped
    return { firstKey: FILE_METADATA_KEYS.find((key) => mapped[key]), messages }
  }

  watch(baseline, resetDraft, { immediate: true, flush: 'sync' })

  return {
    draft,
    inputRevision,
    fieldErrors,
    hasFieldErrors,
    patchPayload,
    changeCount,
    dirty,
    canReset,
    reset: resetDraft,
    applyValidationIssues,
  }
}
