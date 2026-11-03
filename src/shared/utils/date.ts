/**
 * 后端返回的时间戳是 UTC，但没有 'Z'/时区后缀；JS 默认会按本地时区解析，
 * 在 UTC+8 下会出现 8 小时偏差。这里强制按 UTC 解析。
 */
export function parseUtcDate(s: string | null | undefined): Date | null {
  const value = s?.trim()
  if (!value) return null
  const hasTz = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value)
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value.replace(' ', 'T')
  const date = new Date(hasTz ? normalized : `${normalized}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}
