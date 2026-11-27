/** 文件对外标识：后端 16 位字符串 public_id（前后端成对迁移，前端不再消费自增数字 file_id） */
export type FilePublicId = string

export interface File {
  publicId: FilePublicId
  /** OSS 预览图目录（后端 image_path，相对 key）；null = 预览图未生成或生成失败 */
  imagePath: string | null
  // Display name without extension
  name: string

  // Basic metadata
  filename?: string // original filename
  fileType?: string // file_type
  experimentType?: string // experiment_type

  // Biological
  organism?: string
  organismPart?: string
  condition?: string

  // Sample processing
  sampleGrowthConditions?: string
  sampleStabilization?: string
  tissueModification?: string

  // MALDI related
  maldiMatrix?: string
  maldiMatrixApplication?: string
  solvent?: string

  // Technical
  sizeBytes?: number
  storageType?: string
  // backend returns verification code (MD5) in `file_verify_code`; frontend uses `hashMd5`
  hashMd5?: string

  // Experiment / instrument
  instrumentTypes?: string[]
  polarity?: string
  ionSource?: string
  analyzer?: string
  pixelSizeHorizontal?: number
  pixelSizeVertical?: number
  resolvingPower?: number | string

  // MS acquisition
  spectrumMode?: string // 'profile' | 'centroid'
  storageMode?: string // 'continuous' | 'processed'
  mz?: number | string // target m/z for resolving power

  // Submission info
  submitTime: string // ISO string
  submitter: string
  institution?: string

  status: string // 'uploading' | 'completed' | 'failed' - from backend
  isPublic: boolean

  // Visualization / Zarr
  defaultRunId?: string | number | null  // 关联的可视化任务 run_id
  runStatus?: string | null              // 可视化任务状态：pending/running/completed/failed

  // UI
  // Keep raw backend object if needed
  raw?: any
}

// ── API response types (separated from api/datasetApi.ts) ──

// GET /files/{public_id}/download_raw - CDN links for imzML + ibd (login required), zero polling
export interface DownloadRawEntry {
  filename: string
  url: string
  size: number
}

export interface DownloadRawResponse {
  files: DownloadRawEntry[]
}

// Collection 响应中的成员行（后端模型 FilePublic，snake_case 原样）。
// 字段清单以接口实测为准；消费方（collectionMapper）对缺字段做默认值兜底。
export interface FilePublicResponse {
  public_id: string
  image_path?: string | null
  filename?: string | null
  size?: number | null
  status?: string | null
  is_public?: boolean
  experiment_type?: string | null
  organism?: string | null
  [key: string]: unknown
}

// POST /processes/mine 列表里的一条处理记录
export interface ProcessItem {
  id: number
  status: string
  params_json: string
  /** 源文件对外标识（16 位字符串 public_id），后端字段 source_file_public_id */
  source_file_public_id: string
  error_message: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  filename?: string
}

// GET /stats/processing - Processing statistics for current user
export interface ProcessingStats {
  processing: number
  completed: number
  failed: number
}
