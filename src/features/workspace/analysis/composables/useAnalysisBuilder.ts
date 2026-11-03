import { computed, reactive, ref, watch, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  usePreprocessingMethods,
  allMethodGroups,
  buildParamKey,
  buildDefaultMethodParams,
} from '@/features/workspace/analysis/composables/usePreprocessingMethods'
import { createProcess } from '@/features/datasets/api/datasetApi'
import { extractBackendError } from '@/shared/api/httpClient'
import { useToast } from '@/shared/composables/useToast'
import { buildProcessPayload } from '@/features/workspace/analysis/services/buildProcessPayload'
import { vocabLabel } from '@/features/datasets/constants/vocabLabels'
import { t } from '@/i18n'

export function useAnalysisBuilder(
  // Arguments
  selectedDataset: Ref<any>,
) {
  // External composables
  const router = useRouter()
  const { showToast } = useToast()

  // State
  const spectrumMode = ref('')
  const storageMode = ref('')
  const selectedMethods = reactive<Record<string, string>>({})
  const { availableMethods, modeNotice } = usePreprocessingMethods(
    spectrumMode,
    storageMode,
    selectedMethods,
  )
  // 默认参数由方法定义生成（单一数据源，见 buildDefaultMethodParams），不再在此硬编码
  const methodParams = reactive(buildDefaultMethodParams())

  const analysisForm = reactive({
    polarity: '' as 'positive' | 'negative' | '',
    ionSource: '',
    analyzer: '',
    pixelSizeX: '',
    pixelSizeY: '',
  })

  const autoFilled = reactive({
    polarity: false,
    ionSource: false,
    analyzer: false,
    pixelSize: false,
  })

  const submitting = ref(false)

  allMethodGroups.forEach((group) => {
    selectedMethods[group.key] = ''
  })

  // Computed
  const totalSelectedCount = computed(() => {
    let sum = 0
    for (const value of Object.values(selectedMethods)) {
      if (value) sum += 1
    }
    return sum
  })

  const canSubmit = computed(() => {
    return !!selectedDataset.value && totalSelectedCount.value > 0 && !!analysisForm.polarity
  })

  const pipelineSummary = computed(() => {
    return availableMethods.value.map((group: any) => {
      const selected = selectedMethods[group.key]
      return {
        key: group.key,
        title: group.title(),
        method: selected ? getMethodLabel(group.key, selected) : '',
        present: !!selected,
      }
    })
  })

  const msSettingsList = computed(() => {
    const list: Array<{ key: string; label: string; value: string }> = []
    if (analysisForm.polarity) {
      list.push({
        key: 'polarity',
        label: t('common.meta.polarity'),
        value: vocabLabel(analysisForm.polarity === 'positive' ? 'Positive' : 'Negative'),
      })
    }
    if (analysisForm.ionSource) {
      list.push({ key: 'source', label: t('common.meta.ionisationSource'), value: analysisForm.ionSource })
    }
    if (analysisForm.analyzer) {
      list.push({ key: 'analyzer', label: t('common.meta.analyzer'), value: analysisForm.analyzer })
    }

    const px = analysisForm.pixelSizeX || ''
    const py = analysisForm.pixelSizeY || ''
    if (px && py) list.push({ key: 'pixel', label: t('common.meta.pixelSize'), value: `${px}×${py} μm` })
    else if (px) list.push({ key: 'pixel', label: t('common.meta.pixelSize'), value: `${px} μm` })
    else if (py) list.push({ key: 'pixel', label: t('common.meta.pixelSize'), value: `${py} μm` })

    const dataset = selectedDataset.value
    if (dataset?.organism)
      list.push({
        key: 'organism',
        label: t('common.meta.organism'),
        value: vocabLabel(dataset.organism),
      })
    if (dataset?.organismPart) {
      list.push({
        key: 'organismPart',
        label: t('common.meta.organismPart'),
        value: vocabLabel(dataset.organismPart),
      })
    }
    if (dataset?.condition)
      list.push({
        key: 'condition',
        label: t('common.meta.condition'),
        value: vocabLabel(dataset.condition),
      })
    if (spectrumMode.value) {
      list.push({ key: 'spectrumMode', label: t('common.meta.spectrumMode'), value: spectrumMode.value })
    }
    if (storageMode.value) {
      list.push({ key: 'storageMode', label: t('common.meta.storageMode'), value: storageMode.value })
    }
    return list
  })

  const summaryReady = computed(() => {
    return (
      !!selectedDataset.value &&
      pipelineSummary.value.every((item: any) => item.present) &&
      !!analysisForm.polarity
    )
  })

  const statusBadge = computed(() => ({
    text: summaryReady.value ? t('workspace.summary.ready') : t('workspace.summary.incomplete'),
    cls: summaryReady.value ? 'badge badge-success' : 'badge badge-warning',
  }))

  // Methods （buildParamKey 由 usePreprocessingMethods 导入，与默认值生成、载荷构建同源）
  const getParam = (groupKey: string, methodId: string, paramKey: string) =>
    methodParams[buildParamKey(groupKey, methodId, paramKey)]

  const setParam = (
    groupKey: string,
    methodId: string,
    paramKey: string,
    value: string | number,
  ) => {
    methodParams[buildParamKey(groupKey, methodId, paramKey)] = value
  }

  const onIntInput = (groupKey: string, methodId: string, paramKey: string, event: Event) => {
    const raw = (event.target as HTMLInputElement).value
    setParam(groupKey, methodId, paramKey, raw.replace(/[^0-9]/g, ''))
  }

  const onFloatInput = (groupKey: string, methodId: string, paramKey: string, event: Event) => {
    const raw = (event.target as HTMLInputElement).value
    setParam(groupKey, methodId, paramKey, raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))
  }

  const onNumBlur = (
    groupKey: string,
    methodId: string,
    paramKey: string,
    kind: 'int' | 'float',
  ) => {
    const raw = methodParams[buildParamKey(groupKey, methodId, paramKey)]
    if (raw === '' || raw === undefined) return
    const value = kind === 'int' ? parseInt(String(raw), 10) : parseFloat(String(raw))
    if (!isNaN(value)) setParam(groupKey, methodId, paramKey, value)
  }

  const isSelected = (groupKey: string, methodId: string) => selectedMethods[groupKey] === methodId

  const toggleSingle = (groupKey: string, methodId: string, event?: MouseEvent) => {
    event?.preventDefault()
    selectedMethods[groupKey] = isSelected(groupKey, methodId) ? '' : methodId
  }

  const getMethodLabel = (groupKey: string, id: string) => {
    const group = allMethodGroups.find((item: any) => item.key === groupKey)
    const method = group?.methods?.find((item: any) => item.id === id)
    return method?.label || id
  }

  const tryAutoFill = () => {
    Object.keys(autoFilled).forEach((key) => {
      ;(autoFilled as any)[key] = false
    })
    if (!selectedDataset.value) return
    const dataset = selectedDataset.value

    analysisForm.polarity = ''
    analysisForm.ionSource = ''
    analysisForm.analyzer = ''
    analysisForm.pixelSizeX = ''
    analysisForm.pixelSizeY = ''

    const polarity = (dataset.polarity || '').toString().toLowerCase()
    if (polarity) {
      analysisForm.polarity = polarity.includes('neg') ? 'negative' : 'positive'
      autoFilled.polarity = true
    }

    const source = (dataset.ionSource || '').toString().toLowerCase()
    if (source) {
      if (source.includes('maldi')) analysisForm.ionSource = 'MALDI'
      else if (source.includes('desi')) analysisForm.ionSource = 'DESI'
      else if (source.includes('sims')) analysisForm.ionSource = 'SIMS'
      else analysisForm.ionSource = dataset.ionSource
      autoFilled.ionSource = true
    }

    const analyzer = (dataset.analyzer || '').toString().toLowerCase()
    if (analyzer) {
      if (analyzer.includes('orbit')) analysisForm.analyzer = 'Orbitrap'
      else if (analyzer.includes('ft') || analyzer.includes('fticr'))
        analysisForm.analyzer = 'FTICR'
      else if (analyzer.includes('q') && analyzer.includes('tof')) analysisForm.analyzer = 'Q-TOF'
      else if (analyzer.includes('tof')) analysisForm.analyzer = 'TOF'
      else analysisForm.analyzer = dataset.analyzer
      autoFilled.analyzer = true
    }

    if (dataset.pixelSizeHorizontal != null) {
      analysisForm.pixelSizeX = String(dataset.pixelSizeHorizontal)
      autoFilled.pixelSize = true
    }
    if (dataset.pixelSizeVertical != null) {
      analysisForm.pixelSizeY = String(dataset.pixelSizeVertical)
      autoFilled.pixelSize = true
    }
  }

  const submit = async () => {
    if (!canSubmit.value || submitting.value) return
    submitting.value = true
    try {
      const payload = buildProcessPayload({
        selectedDataset: selectedDataset.value,
        selectedMethods,
        methodParams,
        methodGroups: allMethodGroups,
      })
      await createProcess(payload)
      showToast(t('workspace.analysis.started'), 'success')
      router.push('/workspace')
    } catch (error) {
      // 404 = 源文件已不存在或正在删除（publicId 失效），提示后让用户重新选择数据集
      if ((error as { response?: { status?: number } })?.response?.status === 404) {
        showToast(t('common.feedback.fileMissing'), 'error')
      } else {
        showToast(extractBackendError(error) || t('workspace.analysis.startFailed'), 'error')
      }
    } finally {
      submitting.value = false
    }
  }

  // Watchers
  watch(selectedDataset, (dataset) => {
    spectrumMode.value = dataset?.spectrumMode || ''
    storageMode.value = dataset?.storageMode || ''
    tryAutoFill()
  })

  return {
    availableMethods,
    modeNotice,
    methodParams,
    submitting,
    canSubmit,
    pipelineSummary,
    msSettingsList,
    statusBadge,
    buildParamKey,
    getParam,
    onIntInput,
    onFloatInput,
    onNumBlur,
    isSelected,
    toggleSingle,
    submit,
  }
}
