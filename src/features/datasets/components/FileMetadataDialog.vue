<template>
  <!-- 数据集元信息编辑弹窗（My Datasets 卡片右侧 Edit 触发）：
       PATCH /files/{public_id}，可改样本属性 9 个（8 个 SelectWithOther 词表下拉
       + solvent 复合选择器）+ spectrum_mode / storage_mode（枚举下拉）。
       差量提交只发变化的键；枚举字段空值（后端不接受的 ''）不发送。
       保存成功后把返回的 FilePublic 交回父级。 -->
  <dialog class="modal" :class="{ 'modal-open': open }">
    <div class="modal-box w-11/12 max-w-2xl kawaru-text-100">
      <h3 class="kawaru-text-112 font-bold text-base-content mb-1">{{ $t('datasets.metadata.title') }}</h3>
      <p class="kawaru-text-81 text-base-content/50 mb-4 truncate" :title="dataset?.filename">
        {{ dataset?.filename }}
      </p>

      <!-- v-if 守卫：dialog 常驻 DOM（modal-open 只切显隐），draft 在打开时才
           初始化；无守卫会在关闭状态下渲染 null 的字段绑定，整个页面崩掉 -->
      <div v-if="draft" class="max-h-[60vh] overflow-y-auto px-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <!-- 8 个样本属性：与上传表单同款 SelectWithOther（词表 + Other 自定义输入）。
               当前值不在词表内时组件自动落到 Other 输入框回显。 -->
          <label
            v-for="field in TEXT_FIELDS"
            :key="field.key"
            class="flex flex-col gap-1 min-w-0"
          >
            <span class="kawaru-text-81 font-medium text-base-content/70">{{ field.label }}</span>
            <SelectWithOther
              v-model="draft![field.key]"
              :options="field.suggestions"
              :label-of="vocabLabel"
              :placeholder="$t('common.input.selectShort')"
              :other-placeholder="$t('common.input.specifyOther')"
            />
          </label>

          <!-- 溶剂：与上传页同款复合控件（"数值+单位+组分" 逗号分隔，可增删条目）。
               整行占满：用量输入 + 单位下拉 + 溶剂下拉 + 条目列表在窄栏里会挤成一团。 -->
          <div class="flex flex-col gap-1 min-w-0 col-span-full">
            <span class="kawaru-text-81 font-medium text-base-content/70">{{ $t('common.meta.solvent') }}</span>
            <SolventPicker v-model="draft!.solvent" :solvent-options="SOLVENTS" />
          </div>

          <!-- 枚举：IconSelect 下拉。placeholder="" 让 IconSelect 不渲染占位项，
               下拉里只有真实取值；未设置的字段显示为空（选中态 = 不修改该字段） -->
          <label class="flex flex-col gap-1 min-w-0">
            <span class="kawaru-text-81 font-medium text-base-content/70">{{ $t('common.meta.spectrumMode') }}</span>
            <IconSelect
              v-model="draft!.spectrum_mode"
              :options="SPECTRUM_MODES"
              placeholder=""
              hide-label
            />
          </label>
          <label class="flex flex-col gap-1 min-w-0">
            <span class="kawaru-text-81 font-medium text-base-content/70">{{ $t('common.meta.storageMode') }}</span>
            <IconSelect
              v-model="draft!.storage_mode"
              :options="STORAGE_MODES"
              placeholder=""
              hide-label
            />
          </label>
        </div>
      </div>

      <div class="modal-action">
        <button class="btn kawaru-text-100" :disabled="saving" @click="close">{{ $t('common.action.cancel') }}</button>
        <button class="btn btn-primary kawaru-text-100" :disabled="saving || !dirty" @click="save">
          <span v-if="saving" class="loading loading-spinner loading-sm"></span>
          {{ $t('common.action.saveChanges') }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="close">
      <button @click.prevent="close">{{ $t('common.action.close') }}</button>
    </form>
  </dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch, type PropType } from 'vue'
import IconSelect from '@/shared/components/IconSelect.vue'
import SelectWithOther from '@/shared/components/SelectWithOther.vue'
import SolventPicker from '@/features/upload/components/SolventPicker.vue'
import {
  CONDITIONS,
  MALDI_MATRICES,
  MALDI_MATRIX_APPLICATIONS,
  ORGANISMS,
  ORGANISM_PARTS,
  SAMPLE_GROWTH_CONDITIONS,
  SAMPLE_STABILIZATIONS,
  SOLVENTS,
  SPECTRUM_MODES,
  STORAGE_MODES,
  TISSUE_MODIFICATIONS,
} from '@/features/datasets/constants/datasetMetadata'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import { t } from '@/i18n'
import { mapItemToDataset } from '@/features/datasets/mappers/datasetMapper'
import { patchFileMetadata } from '@/features/datasets/api/datasetApi'
import {
  buildFileMetadataPatch,
  toFileMetadataDraft,
  type FileMetadataDraft,
  type FileMetadataKey,
} from '@/features/datasets/utils/fileMetadataPatch'
import type { File } from '@/features/datasets/types/dataset'
import { extractBackendError, isPermissionDenied } from '@/shared/api/httpClient'
import { useToast } from '@/shared/composables/useToast'

const props = defineProps({
  open: { type: Boolean, required: true },
  dataset: { type: Object as PropType<File | null>, default: null },
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', file: File): void
}>()

const { showToast } = useToast()

const TEXT_FIELDS = computed<{ key: FileMetadataKey; label: string; suggestions: readonly string[] }[]>(() => [
  { key: 'organism', label: t('common.meta.organism'), suggestions: ORGANISMS },
  { key: 'organism_part', label: t('common.meta.organismPart'), suggestions: ORGANISM_PARTS },
  { key: 'condition', label: t('common.meta.condition'), suggestions: CONDITIONS },
  { key: 'sample_growth_conditions', label: t('common.meta.growthConditions'), suggestions: SAMPLE_GROWTH_CONDITIONS },
  { key: 'sample_stabilization', label: t('datasets.field.stabilization'), suggestions: SAMPLE_STABILIZATIONS },
  { key: 'tissue_modification', label: t('common.meta.tissueModification'), suggestions: TISSUE_MODIFICATIONS },
  { key: 'maldi_matrix', label: t('common.meta.maldiMatrix'), suggestions: MALDI_MATRICES },
  { key: 'maldi_matrix_application', label: t('datasets.field.matrixApplication'), suggestions: MALDI_MATRIX_APPLICATIONS },
])

const draft = ref<FileMetadataDraft | null>(null)
const saving = ref(false)

// 每次打开时从 File 当前值初始化草稿
watch(
  () => props.open,
  (open) => {
    if (open && props.dataset) {
      draft.value = reactive(toFileMetadataDraft(props.dataset))
    }
  },
)

const dirty = computed(() => {
  if (!props.dataset || !draft.value) return false
  return Object.keys(buildFileMetadataPatch(props.dataset, draft.value)).length > 0
})

async function save() {
  if (!props.dataset || !draft.value || saving.value) return
  const patch = buildFileMetadataPatch(props.dataset, draft.value)
  if (!Object.keys(patch).length) {
    close()
    return
  }

  saving.value = true
  try {
    const raw = await patchFileMetadata(props.dataset.publicId, patch)
    // 响应为更新后的 FilePublic（与列表行同构），复用 mapper 转成前端 File
    showToast(t('common.feedback.updated'), 'success')
    emit('saved', mapItemToDataset(raw))
    emit('close')
  } catch (err: any) {
    // 非持有者改别人的数据 → 后端 403 / "permission denied"。
    // 原文对用户无信息量，换成能看懂的说法。
    const message = isPermissionDenied(err)
      ? t('datasets.metadata.notOwner')
      : extractBackendError(err, t('common.feedback.updateFailed'))
    showToast(message, 'error')
  } finally {
    saving.value = false
  }
}

function close() {
  if (saving.value) return
  emit('close')
}
</script>
