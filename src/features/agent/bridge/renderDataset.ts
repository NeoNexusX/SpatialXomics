import type { DatasetOverview } from './analysisTypes'

/** 数值格式化：科学计数法（紧凑）；null/undefined → N/A */
export function fmt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  if (v === 0) return '0'
  if (Math.abs(v) >= 1000 || Math.abs(v) < 0.01) return v.toExponential(3)
  return v.toFixed(4).replace(/\.?0+$/, '')
}

/** 渲染数据集概览（get_dataset_overview 工具与 system prompt 静态段共用） */
export function renderDataset(d: DatasetOverview): string {
  const lines = [`dataMode: ${d.dataMode}`, `dimensions: ${d.width} x ${d.height}`]
  if (d.rowAxis) lines.push(`rowAxis: ${d.rowAxis}`)
  if (d.name) lines.push(`sampleName: ${d.name}`)
  if (d.filename) lines.push(`filename: ${d.filename}`)
  if (d.pixelCount != null) lines.push(`pixelCount: ${d.pixelCount}`)
  if (d.pixelSizeHorizontal != null)
    lines.push(`pixelSize: ${d.pixelSizeHorizontal} x ${d.pixelSizeVertical ?? '?'} um`)
  if (d.mzMin != null)
    lines.push(`mzRange: ${fmt(d.mzMin)} - ${fmt(d.mzMax)} (${d.mzCount} points)`)
  if (d.analyzer) lines.push(`analyzer: ${d.analyzer}`)
  if (d.ionisationSource) lines.push(`ionSource: ${d.ionisationSource}`)
  if (d.polarity) lines.push(`polarity: ${d.polarity}`)
  return lines.join('\n')
}
