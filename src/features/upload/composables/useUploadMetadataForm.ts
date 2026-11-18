import { ref } from 'vue'
import { ANALYZERS, ION_SOURCES } from '@/features/datasets/constants/datasetMetadata'
import { getIonSourceFieldRules } from '@/features/upload/utils/ionSourceRules'
import { t } from '@/i18n'

export interface UploadMetadataFormState {
  experiment_type: string
  polarity: string
  ionisation_source: string
  analyzer: string
  pixel_size_horizontal: string
  pixel_size_vertical: string
  resolving_power: string
  organism: string
  organism_part: string
  condition: string
  sample_growth_conditions: string
  sample_stabilization: string
  tissue_modification: string
  maldi_matrix: string
  maldi_matrix_application: string
  solvent: string
  spectrum_mode: string
  storage_mode: string
  mz: string
  is_public: boolean
}

interface RequiredField {
  key: keyof UploadMetadataFormState
  /** 字段显示名，校验出错时按当前界面语言取 */
  label: () => string
}

const REQUIRED_FIELDS: RequiredField[] = [
  { key: 'polarity', label: () => t('common.meta.polarity') },
  { key: 'ionisation_source', label: () => t('common.meta.ionisationSource') },
  { key: 'analyzer', label: () => t('common.meta.analyzer') },
  { key: 'pixel_size_horizontal', label: () => t('upload.form.pixelSizeX') },
  { key: 'pixel_size_vertical', label: () => t('upload.form.pixelSizeY') },
  { key: 'organism', label: () => t('common.meta.organism') },
  { key: 'organism_part', label: () => t('common.meta.organismPart') },
  { key: 'condition', label: () => t('common.meta.condition') },
  { key: 'sample_stabilization', label: () => t('common.meta.sampleStabilization') },
  { key: 'spectrum_mode', label: () => t('common.meta.spectrumMode') },
  { key: 'storage_mode', label: () => t('common.meta.storageMode') },
]

function createForm(): UploadMetadataFormState {
  return {
    experiment_type: 'imzML',
    polarity: '',
    ionisation_source: '',
    analyzer: '',
    pixel_size_horizontal: '',
    pixel_size_vertical: '',
    resolving_power: '',
    organism: '',
    organism_part: '',
    condition: '',
    sample_growth_conditions: '',
    sample_stabilization: '',
    tissue_modification: '',
    maldi_matrix: '',
    maldi_matrix_application: '',
    // 预填最常用溶剂;SolventPicker 按 "数值 单位 组分名" 逗号分隔解析,可整条删除
    solvent: '100% Water',
    spectrum_mode: '',
    storage_mode: '',
    mz: '',
    is_public: true,
  }
}

/**
 * Pixel-size rule shared by the blur check in UploadMetadataForm.vue and the
 * submit check in validateMetadata below: empty passes (required-ness is
 * reported separately), otherwise the value must be an integer in [1, 200].
 */
export function isValidPixelSize(value: string): boolean {
  if (!value) return true
  const num = Number(value)
  return !(isNaN(num) || !Number.isInteger(num) || num < 1 || num > 200)
}

export function useUploadMetadataForm() {
  // State
  const form = ref(createForm())
  // 自动从 imzML 识别出的值,用于用户手动修改时的二次确认
  const detectedSpectrumMode = ref('')
  const detectedStorageMode = ref('')

  // Methods
  const resetForm = () => {
    Object.assign(form.value, createForm())
    detectedSpectrumMode.value = ''
    detectedStorageMode.value = ''
  }

  const resetParsedFields = () => {
    form.value.polarity = ''
    form.value.ionisation_source = ''
    form.value.analyzer = ''
    form.value.pixel_size_horizontal = ''
    form.value.pixel_size_vertical = ''
    detectedSpectrumMode.value = ''
    detectedStorageMode.value = ''
  }

  const applyParsedSettings = (settings: any) => {
    if (settings.polarity) {
      form.value.polarity = settings.polarity === 'negative' ? 'Negative' : 'Positive'
    }
    // imzML 解析出的值是任意字符串，用 readonly string[] 断言绕开字面量联合的 includes 约束
    if (settings.ionSource && (ION_SOURCES as readonly string[]).includes(settings.ionSource)) {
      form.value.ionisation_source = settings.ionSource
    }
    if (settings.analyzer && (ANALYZERS as readonly string[]).includes(settings.analyzer)) {
      form.value.analyzer = settings.analyzer
    }
    if (settings.pixelSizeX != null) {
      form.value.pixel_size_horizontal = String(settings.pixelSizeX)
    }
    if (settings.pixelSizeY != null) {
      form.value.pixel_size_vertical = String(settings.pixelSizeY)
    }
    if (settings.spectrum_mode) {
      form.value.spectrum_mode = settings.spectrum_mode
      detectedSpectrumMode.value = settings.spectrum_mode
    }
    if (settings.storage_mode) {
      form.value.storage_mode = settings.storage_mode
      detectedStorageMode.value = settings.storage_mode
    }
  }

  const validateMetadata = () => {
    for (const field of REQUIRED_FIELDS) {
      const value = form.value[field.key]
      if (!value || (typeof value === 'string' && !value.trim())) {
        return t('upload.validation.required', { field: field.label() })
      }
      if (value === 'Other') {
        return t('upload.validation.specifyCustom', { field: field.label() })
      }
    }

    // Dynamic ion-source-dependent validation
    const rules = getIonSourceFieldRules(form.value.ionisation_source)

    // Solvent only checks presence; the MALDI fields additionally reject 'Other'.
    // 显示名不用 rule.label（规则表是纯数据、只有英文），按字段取译文
    const dynamicFields = [
      { rule: rules.solvent, label: t('common.meta.solvent'), value: form.value.solvent, rejectOther: false },
      { rule: rules.maldiMatrix, label: t('common.meta.maldiMatrix'), value: form.value.maldi_matrix, rejectOther: true },
      {
        rule: rules.maldiMatrixApplication,
        label: t('upload.form.maldiMatrixApplication'),
        value: form.value.maldi_matrix_application,
        rejectOther: true,
      },
    ]
    for (const { rule, label, value, rejectOther } of dynamicFields) {
      if (!rule.required) continue
      if (!value || (typeof value === 'string' && !value.trim())) {
        return t('upload.validation.required', { field: label })
      }
      if (rejectOther && value === 'Other') {
        return t('upload.validation.specifyCustom', { field: label })
      }
    }

    // Validate pixel size ranges
    for (const key of ['pixel_size_horizontal', 'pixel_size_vertical'] as const) {
      const val = form.value[key]
      if (val && !isValidPixelSize(val)) {
        const label =
          key === 'pixel_size_horizontal' ? t('upload.form.pixelSizeX') : t('upload.form.pixelSizeY')
        return t('upload.validation.pixelRange', { field: label })
      }
    }
    return ''
  }

  const buildMetadataPayload = () => {
    const payload: Record<string, any> = {}
    Object.keys(form.value).forEach((key) => {
      const formKey = key as keyof UploadMetadataFormState
      const value = form.value[formKey]
      payload[formKey] = value
    })

    payload.pixel_size_horizontal = Number(payload.pixel_size_horizontal)
    payload.pixel_size_vertical = Number(payload.pixel_size_vertical)

    for (const key of ['resolving_power', 'mz'] as const) {
      const v = payload[key]
      if (v !== '' && v !== undefined && isFinite(Number(v))) {
        payload[key] = Number(v)
      } else {
        delete payload[key]
      }
    }

    return payload
  }

  return {
    form,
    detectedSpectrumMode,
    detectedStorageMode,
    resetForm,
    resetParsedFields,
    applyParsedSettings,
    validateMetadata,
    buildMetadataPayload,
  }
}
