/**
 * SI_DB（HMDB 来源重排版）数据源描述符：tab 文案、列定义、fetcher 的装配处。
 * 文案用 () => t('...') 的函数形式，key 保持静态字面量（vocabLabels.ts 同款约定）。
 * 后端就绪后，只需把 fetcher 换成走 httpClient 的实现（见 types/database.ts 契约）。
 */
import { t } from '@/i18n'
import { listHmdbFromCsv } from '../api/hmdbCsv'
import type { DatabaseSource } from '../types/database'

/** Origin 词表显示文字；key 是 CSV 里的英文原值，表里没有的原样显示（vocabLabels.ts 同款约定） */
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
  note: () => t('databases.hmdb.note'),
  rowKey: 'id',
  columns: [
    { key: 'id', label: () => t('databases.hmdb.field.id'), mono: true },
    { key: 'name', label: () => t('databases.hmdb.field.name') },
    { key: 'formula', label: () => t('databases.hmdb.field.formula'), mono: true },
    {
      key: 'mass',
      label: () => t('databases.hmdb.field.mass'),
      format: (v) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(4) : '—'),
    },
    { key: 'origin', label: () => t('databases.hmdb.field.origin'), format: (v) => originLabel(String(v)) },
    { key: 'inchi', label: () => t('databases.hmdb.field.inchi'), mono: true, expandable: true },
  ],
  fetcher: listHmdbFromCsv,
}
