import type { File } from '@/features/datasets/types/dataset'
import type { FileMetadataPatch } from '@/features/datasets/api/datasetApi'

/**
 * 文件元数据编辑草稿 ⇄ PATCH 载荷转换（纯函数）。
 *
 * 草稿键直接用后端 snake_case（11 个可改字段），避免双向映射；
 * 初始化从 camelCase 的 File 显式搬运，差量构建只发变化的键。
 */

/** 11 个可改字段：snake_case 键 = PATCH 载荷键 */
const FILE_METADATA_KEYS = [
  'organism',
  'organism_part',
  'condition',
  'sample_growth_conditions',
  'sample_stabilization',
  'tissue_modification',
  'maldi_matrix',
  'maldi_matrix_application',
  'solvent',
  'spectrum_mode',
  'storage_mode',
] as const

export type FileMetadataKey = (typeof FILE_METADATA_KEYS)[number]
export type FileMetadataDraft = Record<FileMetadataKey, string>

/** File（camelCase）→ 草稿（snake_case，空值归一 ''） */
export function toFileMetadataDraft(file: File): FileMetadataDraft {
  return {
    organism: file.organism ?? '',
    organism_part: file.organismPart ?? '',
    condition: file.condition ?? '',
    sample_growth_conditions: file.sampleGrowthConditions ?? '',
    sample_stabilization: file.sampleStabilization ?? '',
    tissue_modification: file.tissueModification ?? '',
    maldi_matrix: file.maldiMatrix ?? '',
    maldi_matrix_application: file.maldiMatrixApplication ?? '',
    solvent: file.solvent ?? '',
    spectrum_mode: file.spectrumMode ?? '',
    storage_mode: file.storageMode ?? '',
  }
}

/** 草稿 → 差量载荷：只保留与 File 当前值不同的键（enum 字段空串不发送） */
export function buildFileMetadataPatch(file: File, draft: FileMetadataDraft): FileMetadataPatch {
  const current = toFileMetadataDraft(file)
  const patch: FileMetadataPatch = {}
  for (const key of FILE_METADATA_KEYS) {
    if (draft[key] !== current[key]) {
      // spectrum_mode / storage_mode 是后端枚举，'' 不合法——仅在选了具体值时发送
      if ((key === 'spectrum_mode' || key === 'storage_mode') && !draft[key]) continue
      patch[key] = draft[key]
    }
  }
  return patch
}
