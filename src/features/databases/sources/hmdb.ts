/**
 * SI_DB（HMDB 来源重排版）数据源描述符：tab 文案、列定义、筛选控件、整库下载与
 * fetcher 的装配处。文案用 () => t('...') 的函数形式，key 保持静态字面量
 * （vocabLabels.ts 同款约定）。
 *
 * fetcher 是 api/siDb.ts 的 listSiDbPage：走后端 /annotations/si-db 真实接口，
 * 服务不可用时上抛本地化错误（页面错误态 + 重试），不回退样本。
 */
import { t } from '@/i18n'
import { compoundUrl } from '@/features/vizworkbench/utils/annotation/format'
import { downloadSiDbCsv, listSiDbPage } from '../api/siDb'
import { fetchSiDbCsv } from '../api/siDbApi'
import type { DatabaseSource } from '../types/database'

/** Origin 词表显示文字；key 是数据里的英文原值，表里没有的原样显示（vocabLabels.ts 同款约定） */
const ORIGIN_LABELS: Record<string, () => string> = {
  endogenous: () => t('databases.hmdb.origin.endogenous'),
  exogenous: () => t('databases.hmdb.origin.exogenous'),
  expected: () => t('databases.hmdb.origin.expected'),
  unknown: () => t('databases.hmdb.origin.unknown'),
}

export function originLabel(value: string): string {
  return ORIGIN_LABELS[value]?.() ?? value
}

export const hmdbSource: DatabaseSource = {
  id: 'hmdb',
  label: () => t('databases.hmdb.label'),
  searchPlaceholder: () => t('databases.hmdb.searchPlaceholder'),
  rowKey: 'id',
  columns: [
    { key: 'id', label: () => t('databases.hmdb.field.id'), mono: true, width: '13%' },
    { key: 'formula', label: () => t('databases.hmdb.field.formula'), mono: true, width: '13%' },
    { key: 'name', label: () => t('databases.hmdb.field.name'), copyable: true, width: '18%' },
    {
      key: 'inchi',
      label: () => t('databases.hmdb.field.inchi'),
      mono: true,
      copyable: true,
      width: '19%',
    },
    {
      key: 'mass',
      label: () => t('databases.hmdb.field.mass'),
      width: '10%',
      format: (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(4) : '—'),
    },
    {
      key: 'origin',
      label: () => t('databases.hmdb.field.origin'),
      width: '11%',
      format: (v) => originLabel(String(v)),
    },
    // 外链两列复用注释面板的同一套逻辑：PubChem 按名称检索（PubChemDialog），
    // HMDB 走 compoundUrl 的条目页
    {
      key: 'pubchem',
      label: () => t('databases.hmdb.field.pubchem'),
      pubchemField: 'name',
      width: '8%',
    },
    {
      key: 'hmdb',
      label: () => t('databases.hmdb.field.hmdb'),
      link: (row) => compoundUrl(String(row.id ?? '')),
      width: '8%',
    },
  ],
  // 控件 key（origin/mass）与 api/siDb.ts buildSiDbFilters 读取的键一一对应。
  // origin 的 4 个值按对接说明前端写死（后端只收这 4 个）。
  filterControls: [
    {
      kind: 'select',
      key: 'origin',
      label: () => t('databases.hmdb.filter.origin'),
      allLabel: () => t('databases.hmdb.filter.originAll'),
      options: Object.entries(ORIGIN_LABELS).map(([value, label]) => ({ value, label })),
    },
    {
      kind: 'number-range',
      key: 'mass',
      label: () => t('databases.hmdb.filter.mass'),
      minPlaceholder: () => t('databases.hmdb.filter.massMin'),
      maxPlaceholder: () => t('databases.hmdb.filter.massMax'),
    },
  ],
  download: { label: () => t('databases.hmdb.download'), run: downloadSiDbCsv },
  // 注释面板「从平台库导入」走同一后端的整库 CSV（fetchSiDbCsv 读内容，与 download 的浏览器下载互补）
  csvImport: { fetch: fetchSiDbCsv },
  fetcher: listSiDbPage,
}
