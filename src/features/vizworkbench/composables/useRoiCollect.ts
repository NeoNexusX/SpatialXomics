import { computed, reactive, watch, type Ref } from 'vue'
import { t } from '@/i18n'
import { countSignal, signalMask, type CollectKind } from '@/features/vizworkbench/utils/roiMask'
import type { RoiEditor } from './useRoiEditor'

interface RoiCollectOptions {
  /** Unfiltered current image. Display filters zero the cells they hide, which would read as no signal. */
  matrix: Readonly<Ref<Float32Array | null>>
  /** Acquired grid cells (1 = has a spectrum); null until loaded. */
  acquired: Readonly<Ref<Uint8Array | null>>
  /** What `matrix` shows: an ion image's m/z, or the TIC image of processed data. */
  image: Readonly<Ref<number | 'TIC' | null>>
  /** False while the view shows no single ion image, e.g. under the multi-ion overlay. */
  available: Readonly<Ref<boolean>>
  /** True while the next image loads. */
  loading: Readonly<Ref<boolean>>
}

export function collectKindLabel(kind: CollectKind) {
  if (kind === 'present') return t('vizworkbench.roi.signalPresent')
  if (kind === 'absent') return t('vizworkbench.roi.signalAbsent')
  return t('vizworkbench.roi.collectAll')
}

/**
 * Stages acquired pixels of the current image in the ROI editor: those with
 * signal, those without, or all of them.
 */
export function useRoiCollect(editor: RoiEditor, options: RoiCollectOptions) {
  const { matrix, acquired, image, available, loading } = options

  // ROI names leave out "m/z" so the signal word survives truncation in the ROI list.
  function imageName(withUnit: boolean) {
    const value = image.value
    if (typeof value !== 'number') return value ?? ''
    return withUnit ? `m/z ${value.toFixed(4)}` : value.toFixed(4)
  }
  const source = computed(() => imageName(true))

  const counts = computed(() => {
    const values = matrix.value
    const cells = acquired.value
    if (!values || !cells || values.length !== cells.length) return null
    const { present, absent } = countSignal(values, cells)
    return { present, absent, all: present + absent }
  })
  const ready = computed(() => available.value && !loading.value && counts.value !== null)

  function snapshot(kind: CollectKind) {
    const values = matrix.value
    const cells = acquired.value
    if (!values || !cells || values.length !== cells.length) return null
    // The acquired cells are the same for every image, so "all" is not named after one.
    return {
      type: 'collect' as const,
      kind,
      label:
        kind === 'all' ? collectKindLabel(kind) : `${imageName(false)} ${collectKindLabel(kind)}`,
      mask: kind === 'all' ? cells.slice() : signalMask(values, cells, kind),
    }
  }

  function stage(kind: CollectKind) {
    if (!ready.value || !counts.value?.[kind]) return
    const next = snapshot(kind)
    if (next) editor.stageCollect(next)
  }

  // A staged mask follows the current image until it is confirmed.
  watch([matrix, acquired, image], () => {
    const kind = editor.pendingCollect
    if (!kind) return
    const next = counts.value?.[kind] ? snapshot(kind) : null
    if (next) editor.stageCollect(next)
    else editor.discardShape()
  })

  watch(available, (value) => {
    if (value) return
    if (editor.pendingCollect) editor.discardShape()
    if (editor.tool === 'collect') editor.selectTool(null)
  })

  return reactive({ source, counts, available, ready, stage })
}

export type RoiCollect = ReturnType<typeof useRoiCollect>
