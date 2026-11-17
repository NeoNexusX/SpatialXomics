<script setup lang="ts">
import { computed, nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'
import SelectWithOther from '@/shared/components/SelectWithOther.vue'
import SolventPicker from '@/features/upload/components/SolventPicker.vue'
import { SOLVENTS } from '@/features/datasets/constants/datasetMetadata'
import {
  getMetadataTextFields,
  getMetadataInstrumentFields,
  getMetadataNumberFields,
} from '../constants/fileMetadataFields'
import { useFileMetadataDraft } from '../composables/useFileMetadataDraft'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import { t } from '@/i18n'
import { mapItemToDataset } from '@/features/datasets/mappers/datasetMapper'
import { patchFileMetadata } from '@/features/datasets/api/datasetApi'
import {
  FILE_METADATA_MAX_STRING_LENGTH,
  findFileMetadataNumberAdjustments,
  parseFileMetadataValidationIssues,
  type FileMetadataDraft,
  type FileMetadataKey,
} from '@/features/datasets/utils/fileMetadataPatch'
import type { File } from '@/features/datasets/types/dataset'
import { extractBackendError, isPermissionDenied } from '@/shared/api/httpClient'
import { useToast } from '@/shared/composables/useToast'

const props = defineProps<{
  open: boolean
  dataset: File | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', file: File): void
}>()

const { showToast } = useToast()

const textFields = computed(getMetadataTextFields)
const instrumentFields = computed(getMetadataInstrumentFields)
const numberFields = computed(getMetadataNumberFields)

const titleId = useId()
const fieldsElement = useTemplateRef<HTMLFieldSetElement>('fields')
const baseline = shallowRef<File | null>(null)
const saving = shallowRef(false)
const saveNotice = shallowRef('')
const editSession = shallowRef(0)
const {
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
} = useFileMetadataDraft(baseline)

// 支持初次挂载即打开、延迟收到数据和切换文件；同一文件的背景刷新不覆盖草稿。
watch(
  [() => props.open, () => props.dataset?.publicId],
  ([open]) => {
    editSession.value++
    baseline.value = open && props.dataset ? { ...props.dataset } : null
    saveNotice.value = ''
  },
  { immediate: true },
)

function reset() {
  if (saving.value) return
  resetDraft()
  saveNotice.value = ''
}

function fieldError(key: FileMetadataKey): string {
  return fieldErrors.value[key] ?? ''
}

async function handleSaveError(err: unknown, submitted: FileMetadataDraft) {
  // 非持有者改别人的数据 → 后端 403 / "permission denied"。
  // 原文对用户无信息量，换成能看懂的说法。
  if (isPermissionDenied(err)) {
    showToast(t('datasets.metadata.notOwner'), 'error')
    return
  }

  // 422：detail 是 FastAPI 标准数组，loc 形如 ["body", "mz"]，按字段就地显示
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  const issues = parseFileMetadataValidationIssues(detail)
  if (issues.length) {
    const { firstKey, messages } = applyValidationIssues(issues, submitted)
    if (firstKey) {
      await nextTick()
      fieldsElement.value
        ?.querySelector<HTMLElement>(
          `[data-field="${firstKey}"] input:not(:disabled), [data-field="${firstKey}"] select`,
        )
        ?.focus()
      showToast(t('datasets.metadata.invalidFields'), 'error')
      if (messages.length) showToast(messages.join('; '), 'error')
      return
    }
    showToast(messages.join('; '), 'error')
    return
  }

  showToast(extractBackendError(err, t('common.feedback.updateFailed')), 'error')
}

async function save() {
  if (!baseline.value || !draft.value || saving.value || hasFieldErrors.value || !dirty.value)
    return

  const publicId = baseline.value.publicId
  const session = editSession.value
  const submitted = { ...draft.value }
  const patch = { ...patchPayload.value }
  saveNotice.value = ''
  saving.value = true
  try {
    const raw = await patchFileMetadata(publicId, patch)
    const saved = mapItemToDataset(raw)
    const adjustments = findFileMetadataNumberAdjustments(patch, saved)
    emit('saved', saved)
    if (adjustments.length) {
      const changes = adjustments
        .map(({ key, submitted, stored }) => {
          const label = numberFields.value.find((field) => field.key === key)!.label
          return `${label}: ${submitted} → ${stored}`
        })
        .join('; ')
      const message = t('datasets.metadata.savedWithAdjustments', { changes })
      showToast(message, 'warning')
      if (session === editSession.value) {
        baseline.value = saved
        saveNotice.value = message
      }
    } else {
      showToast(t('common.feedback.updated'), 'success')
      if (session === editSession.value) emit('close')
    }
  } catch (err) {
    saving.value = false
    if (session === editSession.value) await handleSaveError(err, submitted)
  } finally {
    saving.value = false
  }
}

function close() {
  if (saving.value) return
  emit('close')
}
</script>

<template>
  <dialog
    class="modal"
    :class="{ 'modal-open': open }"
    :aria-labelledby="titleId"
    :aria-busy="saving"
    aria-modal="true"
    @cancel.prevent="close"
    @keydown.esc.prevent="close"
  >
    <div class="modal-box w-11/12 max-w-2xl kawaru-text-100">
      <h3 :id="titleId" class="kawaru-text-112 font-bold text-base-content mb-1">
        {{ $t('datasets.metadata.title') }}
      </h3>
      <p class="kawaru-text-81 text-base-content/50 mb-4 truncate" :title="dataset?.filename">
        {{ dataset?.filename || dataset?.name }}
      </p>

      <p v-if="hasFieldErrors" role="alert" class="text-error kawaru-text-81 mb-3">
        {{ $t('datasets.metadata.invalidFields') }}
      </p>
      <p v-if="saveNotice" role="alert" class="alert alert-warning kawaru-text-81 mb-3">
        {{ saveNotice }}
      </p>
      <fieldset
        v-if="draft"
        :key="inputRevision"
        ref="fields"
        :disabled="saving"
        class="max-h-[60vh] overflow-y-auto px-3 min-w-0"
      >
        <h4
          class="mt-3 mb-4 border-b border-base-content/10 pb-2 kawaru-text-100 text-base-content/60 font-medium"
        >
          {{ $t('upload.form.acquisitionInfo') }}
        </h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <div
            v-for="field in instrumentFields"
            :key="field.key"
            :data-field="field.key"
            class="min-w-0"
          >
            <SelectWithOther
              v-model="draft[field.key]"
              :label="field.label"
              :options="field.suggestions"
              :label-of="vocabLabel"
              :placeholder="$t('datasets.metadata.notSpecified')"
              placeholder-selectable
              :other-placeholder="$t('common.input.specifyOther')"
              :max-length="FILE_METADATA_MAX_STRING_LENGTH"
              custom-input-mode="verbatim"
              :error="fieldError(field.key)"
            />
          </div>
        </div>
        <p class="kawaru-text-75 text-base-content/60 mt-4 mb-2">
          {{ $t('datasets.metadata.numberHint') }}
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <label
            v-for="field in numberFields"
            :key="field.key"
            :data-field="field.key"
            class="flex flex-col gap-1 min-w-0"
          >
            <span class="kawaru-text-81 font-medium text-base-content/70">{{ field.label }}</span>
            <input
              v-model="draft[field.key]"
              type="text"
              inputmode="decimal"
              class="input input-bordered w-full kawaru-text-100"
              :class="{ 'input-error': fieldError(field.key) }"
              :aria-invalid="!!fieldError(field.key)"
              :aria-describedby="
                fieldError(field.key) ? `${titleId}-${field.key}-error` : undefined
              "
              :placeholder="$t('common.input.example', { value: field.example })"
            />
            <span
              v-if="fieldError(field.key)"
              :id="`${titleId}-${field.key}-error`"
              class="kawaru-text-75 text-error mt-0.5"
            >
              {{ fieldError(field.key) }}
            </span>
          </label>
        </div>

        <h4
          class="mt-6 mb-4 border-b border-base-content/10 pb-2 kawaru-text-100 text-base-content/60 font-medium"
        >
          {{ $t('upload.form.sampleMetadata') }}
        </h4>
        <p class="kawaru-text-75 text-base-content/60 mb-3">
          {{ $t('datasets.metadata.textHint', { max: FILE_METADATA_MAX_STRING_LENGTH }) }}
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <div v-for="field in textFields" :key="field.key" :data-field="field.key" class="min-w-0">
            <SelectWithOther
              v-model="draft[field.key]"
              :label="field.label"
              :options="field.suggestions"
              :label-of="vocabLabel"
              :placeholder="$t('datasets.metadata.notSpecified')"
              placeholder-selectable
              :other-placeholder="$t('common.input.specifyOther')"
              :max-length="FILE_METADATA_MAX_STRING_LENGTH"
              custom-input-mode="verbatim"
              :error="fieldError(field.key)"
            />
          </div>
          <div class="flex flex-col gap-1 min-w-0 col-span-full" data-field="solvent">
            <span class="kawaru-text-81 font-medium text-base-content/70">{{
              $t('common.meta.solvent')
            }}</span>
            <SolventPicker
              v-model="draft.solvent"
              :solvent-options="SOLVENTS"
              :max-length="FILE_METADATA_MAX_STRING_LENGTH"
              custom-input-mode="verbatim"
            />
            <span v-if="fieldError('solvent')" class="kawaru-text-75 text-error mt-0.5">
              {{ fieldError('solvent') }}
            </span>
          </div>
        </div>

        <h4
          class="mt-6 mb-4 border-b border-base-content/10 pb-2 kawaru-text-100 text-base-content/60 font-medium"
        >
          {{ $t('datasets.metadata.readOnly') }}
        </h4>
        <p class="kawaru-text-75 text-base-content/60 mb-3">
          {{ $t('datasets.metadata.readOnlyHint') }}
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label class="flex flex-col gap-1 min-w-0" data-field="spectrum_mode">
            <span class="kawaru-text-81 font-medium text-base-content/70">{{
              $t('common.meta.spectrumMode')
            }}</span>
            <input
              class="input input-bordered w-full kawaru-text-100"
              :value="dataset?.spectrumMode || '—'"
              readonly
              disabled
            />
          </label>
          <label class="flex flex-col gap-1 min-w-0" data-field="storage_mode">
            <span class="kawaru-text-81 font-medium text-base-content/70">{{
              $t('common.meta.storageMode')
            }}</span>
            <input
              class="input input-bordered w-full kawaru-text-100"
              :value="dataset?.storageMode || '—'"
              readonly
              disabled
            />
          </label>
        </div>
      </fieldset>

      <div class="flex flex-col gap-2 mt-6 sm:flex-row sm:items-center">
        <div class="flex items-center justify-between gap-2 sm:mr-auto">
          <span role="status" class="kawaru-text-75 text-base-content/60">
            {{ $t('datasets.metadata.changedCount', { count: changeCount }) }}
          </span>
          <button class="btn btn-ghost btn-sm" :disabled="saving || !canReset" @click="reset">
            {{ $t('common.action.reset') }}
          </button>
        </div>
        <div class="grid grid-cols-[1fr_1.5fr] gap-2 sm:flex">
          <button
            class="btn min-w-0 whitespace-normal px-3 kawaru-text-87"
            :disabled="saving"
            @click="close"
          >
            {{ saveNotice && !canReset ? $t('common.action.close') : $t('common.action.cancel') }}
          </button>
          <button
            class="btn btn-primary min-w-0 whitespace-normal px-3 kawaru-text-87"
            :disabled="saving || !dirty || hasFieldErrors"
            @click="save"
          >
            <span v-if="saving" class="loading loading-spinner loading-sm"></span>
            {{ $t('common.action.saveChanges') }}
          </button>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click.prevent="close">
      <button>{{ $t('common.action.close') }}</button>
    </form>
  </dialog>
</template>
