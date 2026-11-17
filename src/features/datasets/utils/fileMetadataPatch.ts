import type { File } from '@/features/datasets/types/dataset'
import type { FileMetadataPatch } from '@/features/datasets/api/datasetApi'

/**
 * 文件元数据编辑草稿 ⇄ PATCH 载荷转换（纯函数）。
 *
 * 草稿键直接用后端 snake_case（16 个可改字段：12 个字符串 + 4 个数值），避免双向映射；
 * 初始化从 camelCase 的 File 显式搬运，差量构建只发真正变化的键。
 *
 * 数值字段在草稿里保持字符串（输入框天然是字符串），构建载荷时才转成 number：
 * 空串表示「未填写」，按后端口径转成 0；null / NaN / Infinity 一律不发送。
 */

/** 后端字符串字段上限；按 Unicode 码点计数，避免 emoji 等代理对被算成 2 个字符。 */
export const FILE_METADATA_MAX_STRING_LENGTH = 128

/** 12 个字符串可改字段：snake_case 键 = PATCH 载荷键 */
export const FILE_METADATA_TEXT_KEYS = [
  'organism',
  'organism_part',
  'condition',
  'sample_growth_conditions',
  'sample_stabilization',
  'tissue_modification',
  'maldi_matrix',
  'maldi_matrix_application',
  'solvent',
  'polarity',
  'ionisation_source',
  'analyzer',
] as const

/** 4 个数值可改字段；后端要求 >= 0，0 表示未填写 */
export const FILE_METADATA_NUMBER_KEYS = [
  'pixel_size_horizontal',
  'pixel_size_vertical',
  'resolving_power',
  'mz',
] as const

/** 16 个可改字段（spectrum_mode / storage_mode 已不可改，不在其中） */
export const FILE_METADATA_KEYS = [
  ...FILE_METADATA_TEXT_KEYS,
  ...FILE_METADATA_NUMBER_KEYS,
] as const

export type FileMetadataTextKey = (typeof FILE_METADATA_TEXT_KEYS)[number]
export type FileMetadataNumberKey = (typeof FILE_METADATA_NUMBER_KEYS)[number]
export type FileMetadataKey = (typeof FILE_METADATA_KEYS)[number]

/** 草稿统一用 string 保存输入框原始值，数值字段在构建载荷时再转换 */
export type FileMetadataDraft = Record<FileMetadataKey, string>

/** 后端 snake_case → 前端 File camelCase */
const FILE_FIELD_NAMES: Record<FileMetadataKey, keyof File> = {
  organism: 'organism',
  organism_part: 'organismPart',
  condition: 'condition',
  sample_growth_conditions: 'sampleGrowthConditions',
  sample_stabilization: 'sampleStabilization',
  tissue_modification: 'tissueModification',
  maldi_matrix: 'maldiMatrix',
  maldi_matrix_application: 'maldiMatrixApplication',
  solvent: 'solvent',
  polarity: 'polarity',
  ionisation_source: 'ionSource',
  analyzer: 'analyzer',
  pixel_size_horizontal: 'pixelSizeHorizontal',
  pixel_size_vertical: 'pixelSizeVertical',
  resolving_power: 'resolvingPower',
  mz: 'mz',
}

function toDraftString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

export function isFileMetadataTextKey(key: FileMetadataKey): key is FileMetadataTextKey {
  return (FILE_METADATA_TEXT_KEYS as readonly string[]).includes(key)
}

export function isFileMetadataNumberKey(key: FileMetadataKey): key is FileMetadataNumberKey {
  return (FILE_METADATA_NUMBER_KEYS as readonly string[]).includes(key)
}

/** File（camelCase）→ 草稿（snake_case，空值归一 ''，数值转字符串） */
export function toFileMetadataDraft(file: File): FileMetadataDraft {
  const draft = {} as FileMetadataDraft
  for (const key of FILE_METADATA_KEYS) {
    draft[key] = toDraftString(file[FILE_FIELD_NAMES[key]])
  }
  return draft
}

export function countFileMetadataChars(value: string): number {
  return Array.from(value).length
}

/** 字符串上限与后端一致：<= 128 字符（空串合法，表示清空） */
export function isValidFileMetadataString(value: string): boolean {
  return countFileMetadataChars(value) <= FILE_METADATA_MAX_STRING_LENGTH
}

const DECIMAL_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * 草稿里的数值 → 后端 number。
 * - 空串 = 未填写 → 0（不能发 null）
 * - 非法数字（含 NaN / Infinity）→ null，调用方据此跳过该字段
 */
export function parseFileMetadataNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return 0
  if (!DECIMAL_NUMBER_RE.test(trimmed)) return null
  const number = Number(trimmed)
  if (!Number.isFinite(number) || number < 0) return null
  return number
}

export function isValidFileMetadataNumber(value: string): boolean {
  return parseFileMetadataNumber(value) !== null
}

/** 用户改过的草稿字段：用于差量校验，也是「只发改过的字段」的判定基础 */
export function changedFileMetadataKeys(file: File, draft: FileMetadataDraft): FileMetadataKey[] {
  const current = toFileMetadataDraft(file)
  return FILE_METADATA_KEYS.filter((key) => draft[key] !== current[key])
}

/**
 * 草稿 → 差量载荷：字符串字段发字符串（清空发 ''），数值字段发 number（清空发 0）。
 * 数值非法时跳过（表单校验会拦住，绝不构造 NaN / Infinity / null 载荷）。
 * 无论草稿里有什么，spectrum_mode / storage_mode 都不会进入载荷。
 */
export function buildFileMetadataPatch(file: File, draft: FileMetadataDraft): FileMetadataPatch {
  const current = toFileMetadataDraft(file)
  const patch: FileMetadataPatch = {}

  for (const key of FILE_METADATA_TEXT_KEYS) {
    if (draft[key] !== current[key]) {
      patch[key] = draft[key]
    }
  }

  for (const key of FILE_METADATA_NUMBER_KEYS) {
    const next = parseFileMetadataNumber(draft[key])
    if (next === null) continue
    // 草稿里的 '' 与当前未填写都归一为 0，避免打开弹窗就产生无意义差量
    const prev = parseFileMetadataNumber(current[key])
    if (next !== prev) {
      patch[key] = next
    }
  }

  return patch
}

export interface FileMetadataNumberAdjustment {
  key: FileMetadataNumberKey
  submitted: number
  stored: number
}

/** 测试服可能按较低精度返回数值；以实际回传值为准，并让用户看到差异。 */
export function findFileMetadataNumberAdjustments(
  patch: FileMetadataPatch,
  saved: File,
): FileMetadataNumberAdjustment[] {
  const adjustments: FileMetadataNumberAdjustment[] = []
  for (const key of FILE_METADATA_NUMBER_KEYS) {
    const submitted = patch[key]
    if (submitted === undefined) continue
    const value = saved[FILE_FIELD_NAMES[key]]
    const stored =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value)
          : NaN
    if (Number.isFinite(stored) && stored !== submitted) {
      adjustments.push({ key, submitted, stored })
    }
  }
  return adjustments
}

export type FileMetadataDraftErrorKind = 'tooLong' | 'invalidNumber'

export interface FileMetadataDraftError {
  key: FileMetadataKey
  kind: FileMetadataDraftErrorKind
}

/** 前端校验：只检查用户改过的字段，未改的字段不会进载荷，不该阻塞保存 */
export function validateFileMetadataDraft(
  file: File,
  draft: FileMetadataDraft,
): FileMetadataDraftError[] {
  const errors: FileMetadataDraftError[] = []
  for (const key of changedFileMetadataKeys(file, draft)) {
    if (isFileMetadataNumberKey(key)) {
      if (!isValidFileMetadataNumber(draft[key])) {
        errors.push({ key, kind: 'invalidNumber' })
      }
    } else if (!isValidFileMetadataString(draft[key])) {
      errors.push({ key, kind: 'tooLong' })
    }
  }
  return errors
}

/** FastAPI 422 detail 里的一条校验错误（loc 形如 ["body", "mz"]） */
export interface FileMetadataValidationIssue {
  /** 能映射到可改字段时才有值；无法映射的交给通用错误提示 */
  key: FileMetadataKey | null
  msg: string
  type: string
}

function isFileMetadataKey(value: string): value is FileMetadataKey {
  return (FILE_METADATA_KEYS as readonly string[]).includes(value)
}

/** 解析 422 的 detail 数组，把 loc 末段映射回可改字段；非数组（如 403/404 的字符串）返回 [] */
export function parseFileMetadataValidationIssues(detail: unknown): FileMetadataValidationIssue[] {
  if (!Array.isArray(detail)) return []

  return detail.map((raw) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const loc = Array.isArray(item.loc) ? item.loc : []
    const candidate = [...loc]
      .reverse()
      .find((part): part is FileMetadataKey => typeof part === 'string' && isFileMetadataKey(part))
    const msg = typeof item.msg === 'string' && item.msg.trim() ? item.msg : 'Invalid value'
    const type = typeof item.type === 'string' ? item.type : ''
    return { key: candidate ?? null, msg, type }
  })
}
