/** 环形图单段：某个数据集分类及其数量 */
export interface DatasetCategoryItem {
  category: string
  count: number
}

/** 数据集分类分布响应体 */
export interface DatasetCategoryStats {
  items: DatasetCategoryItem[]
  /** 所有分类计数之和；后端可不返回，前端可自行累加兜底 */
  total: number
}

/** 平台总览响应体（字段沿用后端 FastAPI 的 snake_case 习惯） */
export interface PlatformOverviewStats {
  /** 总用户数 */
  total_users: number
  /** 总数据集数 */
  total_files: number
  /** 总下载数 */
  total_downloads: number
}

/** 网站访问量响应体 */
export interface VisitsStats {
  daily: number
  monthly: number
  total: number
}

export interface VisitsHistoryDay {
  /** UTC calendar date; never regroup these counts in the browser's timezone. */
  date: string
  count: number
  /** A missing observation is not a confirmed zero. */
  missing: boolean
  is_partial: boolean
}

export interface VisitsHistoryStats {
  timezone: 'UTC'
  start_date: string
  end_date: string
  days: number
  /** Recorded requests within this interval, not the lifetime total. */
  range_total: number
  missing_days: number
  items: VisitsHistoryDay[]
}
