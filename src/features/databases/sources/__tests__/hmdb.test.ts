import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/databases.json'
import zh from '@/i18n/locales/zh-CN/databases.json'
import { DATABASE_SOURCES } from '../index'
import { hmdbSource, originLabel } from '../hmdb'

describe('hmdbSource', () => {
  it('is registered as the first database source', () => {
    expect(DATABASE_SOURCES[0]).toBe(hmdbSource)
  })

  it('declares columns in the agreed order', () => {
    expect(hmdbSource.columns.map((c) => c.key)).toEqual([
      'id',
      'formula',
      'name',
      'inchi',
      'mass',
      'origin',
      'pubchem',
      'hmdb',
    ])
    // PubChem 检索用名称（与注释面板一致）
    expect(hmdbSource.columns.find((c) => c.key === 'pubchem')!.pubchemField).toBe('name')
  })

  it('offers copy buttons on name and InChI only', () => {
    expect(hmdbSource.columns.filter((c) => c.copyable).map((c) => c.key)).toEqual([
      'name',
      'inchi',
    ])
  })

  it('links HMDB entries via the shared compoundUrl logic', () => {
    const col = hmdbSource.columns.find((c) => c.key === 'hmdb')!
    expect(col.link!({ id: 'HMDB0000001' })).toBe('https://hmdb.ca/metabolites/HMDB0000001')
    expect(col.link!({ id: 'not-an-id' })).toBeNull()
  })

  it('has a label for every column in both locales', () => {
    const fieldsEn = en.databases.hmdb.field as Record<string, string>
    const fieldsZh = zh.databases.hmdb.field as Record<string, string>
    for (const col of hmdbSource.columns) {
      expect(fieldsEn[col.key], `en.${col.key}`).toBeTruthy()
      expect(fieldsZh[col.key], `zh-CN.${col.key}`).toBeTruthy()
    }
  })

  it('points rowKey at one of its own columns and ships a fetcher', () => {
    const keys = hmdbSource.columns.map((c) => c.key)
    expect(keys).toContain(hmdbSource.rowKey)
    expect(typeof hmdbSource.fetcher).toBe('function')
  })

  it('maps known origin vocabularies and falls back to raw values', () => {
    // 单测里语言包未加载，t() 返回 key 本身——能区分「命中词表」与「原样回退」即可
    expect(originLabel('endogenous')).toBe('databases.hmdb.origin.endogenous')
    expect(originLabel('brand-new-value')).toBe('brand-new-value')
  })
})
