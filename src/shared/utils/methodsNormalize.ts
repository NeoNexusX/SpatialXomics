import { t } from '@/i18n'
import { isDirectRun } from './processRun'

/**
 * Unified label map: backend key -> display name.
 * Keys come from /processes/mine params_json.
 *
 * 这里产出的英文名是数据：经路由 state 传给 vizworkbench，e2e 也按它筛行。
 * 界面显示一律再过一遍 {@link methodLabel}。
 */
const METHOD_LABELS: Record<string, string> = {
  noise_reduction: 'Noise Reduction',
  baseline_correction: 'Baseline Correction',
  normalization: 'Normalization',
  peak_pick: 'Peak Picking',
  peak_align: 'Peak Alignment',
}

const RAW_CONVERT_LABEL = 'Direct conversion (no preprocessing)'

export function parseAlgorithms(paramsJson: string): string[] {
  if (isDirectRun(paramsJson)) {
    return [RAW_CONVERT_LABEL]
  }
  try {
    const params = JSON.parse(paramsJson)
    const algos = params.algorithms || params
    return Object.entries(algos)
      .filter(([_, v]) => v != null)
      .map(([k]) => METHOD_LABELS[k] || k)
  } catch {
    return []
  }
}

/** 预处理步骤英文名 → 当前语言的显示文字。未知名称（后端新增的算法）原样显示。 */
const METHOD_DISPLAY: Record<string, () => string> = {
  'Noise Reduction': () => t('common.preprocessing.noiseReduction'),
  'Baseline Correction': () => t('common.preprocessing.baselineCorrection'),
  Normalization: () => t('common.preprocessing.normalization'),
  'Peak Picking': () => t('common.preprocessing.peakPicking'),
  'Peak Alignment': () => t('common.preprocessing.peakAlignment'),
  [RAW_CONVERT_LABEL]: () => t('common.preprocessing.rawConvert'),
}

/** 在 computed / 模板里调用才会随语言切换刷新。 */
export function methodLabel(name: string): string {
  return METHOD_DISPLAY[name]?.() ?? name
}
