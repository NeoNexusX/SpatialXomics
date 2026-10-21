import type { MetadataAttrs } from '@/services/zarr/types/zarr'
import type { File } from '@/features/datasets/types/dataset'
import type { Acquisition } from '@/features/vizworkbench/types/acquisition'

/**
 * 由三个原始来源推导采集元数据（以谁为准见 types/acquisition.ts）。纯函数：
 * 不管 zarr attrs 和源文件记录哪个先到，结果都一样。
 */
export function deriveAcquisition(
  attrs: MetadataAttrs | null | undefined,
  file: File | null | undefined,
  methods: readonly string[],
): Acquisition {
  let spectrumMode = file?.spectrumMode || ''
  if (attrs?.centroid_spectrum) spectrumMode = 'centroid'
  else if (attrs?.profile_spectrum) spectrumMode = 'profile'
  if (methods.includes('Peak Picking')) spectrumMode = 'centroid'

  let storageMode = file?.storageMode || ''
  if (attrs?.continuous) storageMode = 'continuous'
  else if (attrs?.processed) storageMode = 'processed'
  if (methods.includes('Peak Alignment')) storageMode = 'continuous'

  return {
    polarity: attrs?.polarity || file?.polarity || '',
    ionSource: attrs?.ionisation_source || file?.ionSource || '',
    analyzer: attrs?.analyzer || file?.analyzer || '',
    resolvingPower: file?.resolvingPower != null ? String(file.resolvingPower) : '',
    resolvingPowerMz: file?.mz != null ? String(file.mz) : '',
    maldiMatrix: file?.maldiMatrix || '',
    maldiMatrixApplication: file?.maldiMatrixApplication || '',
    solvent: file?.solvent || '',
    spectrumMode,
    storageMode,
  }
}
