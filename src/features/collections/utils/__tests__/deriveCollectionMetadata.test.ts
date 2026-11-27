import { describe, expect, it } from 'vitest'
import {
  DERIVED_METADATA_KEYS,
  deriveCollectionMetadata,
  mergeDerivedMetadata,
  type DerivedMetadata,
  type DerivedMetadataKey,
} from '../deriveCollectionMetadata'
import type { File } from '@/features/datasets/types/dataset'

const file = (over: Partial<File>): File => ({ publicId: 'qW3rT5yU7iO9pA1s', name: '', submitTime: '', submitter: '', status: 'completed', isPublic: true, ...over }) as File

describe('deriveCollectionMetadata', () => {
  it('returns every derived key as an empty array for an empty selection', () => {
    const result = deriveCollectionMetadata([])

    for (const key of DERIVED_METADATA_KEYS) {
      expect(result[key]).toEqual([])
    }
  })

  it('dedupes values across members and keeps first-seen order', () => {
    const result = deriveCollectionMetadata([
      file({ organism: 'Mouse (Mus musculus)', polarity: 'Negative' }),
      file({ organism: 'Human (Homo sapiens)', polarity: 'Negative' }),
      file({ organism: 'Mouse (Mus musculus)', polarity: 'Positive' }),
    ])

    expect(result.organism).toEqual(['Mouse (Mus musculus)', 'Human (Homo sapiens)'])
    expect(result.polarity).toEqual(['Negative', 'Positive'])
  })

  // 集合元数据的语义是「涵盖的取值集合」：成员不一致时保留全部，而不是取交集
  it('keeps divergent values instead of intersecting them', () => {
    const result = deriveCollectionMetadata([
      file({ organismPart: 'Brain' }),
      file({ organismPart: 'Kidney' }),
    ])

    expect(result.organism_part).toEqual(['Brain', 'Kidney'])
  })

  it('skips missing and whitespace-only values', () => {
    const result = deriveCollectionMetadata([
      file({ organism: '', sampleStabilization: '   ', tissueModification: undefined }),
      file({ organism: 'Rat (Rattus norvegicus)' }),
    ])

    expect(result.organism).toEqual(['Rat (Rattus norvegicus)'])
    expect(result.sample_stabilization).toEqual([])
    expect(result.tissue_modification).toEqual([])
  })

  it('maps camelCase File fields onto the snake_case collection keys', () => {
    const result = deriveCollectionMetadata([
      file({
        ionSource: 'MALDI',
        analyzer: 'TOF',
        sampleGrowthConditions: 'Dark, 22C',
      }),
    ])

    expect(result.ionisation_source).toEqual(['MALDI'])
    expect(result.analyzer).toEqual(['TOF'])
    expect(result.sample_growth_conditions).toEqual(['Dark, 22C'])
  })

  it('does not swallow a literal "0" in a text field', () => {
    const result = deriveCollectionMetadata([file({ polarity: '0' })])

    expect(result.polarity).toEqual(['0'])
  })

  // 集合详情的成员行与数据集在这 8 个字段上同名：增删成员后用同一套逻辑推导
  it('accepts collection members as well as dataset rows', () => {
    const result = deriveCollectionMetadata([
      {
        organism: 'Human (Homo sapiens)',
        organismPart: null,
        polarity: 'Positive',
        ionSource: 'MALDI',
      },
      { organism: 'Mouse (Mus musculus)', polarity: null, ionSource: '' },
    ])

    expect(result.organism).toEqual(['Human (Homo sapiens)', 'Mouse (Mus musculus)'])
    expect(result.organism_part).toEqual([])
    expect(result.polarity).toEqual(['Positive'])
    expect(result.ionisation_source).toEqual(['MALDI'])
  })
})

describe('mergeDerivedMetadata', () => {
  type Values = Partial<Record<DerivedMetadataKey, string[]>>

  /** 只给指定字段填值，其余字段都是空数组 */
  const derived = (values: Values): DerivedMetadata => {
    const result = {} as DerivedMetadata
    for (const key of DERIVED_METADATA_KEYS) result[key] = values[key] ?? []
    return result
  }

  /** 以集合当前的汇总值、成员变化前后的推导值做一次比对 */
  const merge = (current: Values, before: Values, after: Values) =>
    mergeDerivedMetadata({ name: 'X', ...current }, derived(before), derived(after))

  it('appends the values a new member brings and keeps everything already there', () => {
    // 第一个取值是用户手填的，不在任何成员上：照样保留
    expect(
      merge(
        { organism: ['My own label', 'Mouse'] },
        { organism: ['Mouse'] },
        { organism: ['Mouse', 'Rat'] },
      ),
    ).toEqual([
      {
        key: 'organism',
        before: ['My own label', 'Mouse'],
        after: ['My own label', 'Mouse', 'Rat'],
      },
    ])
  })

  it('drops the values that left with a removed member, but keeps hand-added ones', () => {
    expect(
      merge(
        { polarity: ['Negative', 'Positive', 'Custom'] },
        { polarity: ['Negative', 'Positive'] },
        { polarity: ['Positive'] },
      ),
    ).toEqual([
      {
        key: 'polarity',
        before: ['Negative', 'Positive', 'Custom'],
        after: ['Positive', 'Custom'],
      },
    ])
  })

  // 否则用户每次增删成员都会被打扰，而那处差异与这次操作无关
  it('does not raise differences this member change did not cause', () => {
    // 创建时把物种改成了自己的写法；新成员的物种与已有成员相同，推导值没变
    expect(
      merge(
        { organism: ['Human'] },
        { organism: ['Human (Homo sapiens)'] },
        { organism: ['Human (Homo sapiens)'] },
      ),
    ).toEqual([])
  })

  it('proposes nothing when the new member brings a value the collection already has', () => {
    expect(
      merge(
        { organism: ['Mouse', 'Rat'] },
        { organism: ['Mouse'] },
        { organism: ['Mouse', 'Rat'] },
      ),
    ).toEqual([])
  })

  it('proposes nothing when a departing value was never on the collection', () => {
    expect(
      merge(
        { polarity: ['Positive'] },
        { polarity: ['Negative', 'Positive'] },
        { polarity: ['Positive'] },
      ),
    ).toEqual([])
  })

  it('ignores order-only differences in what members provide', () => {
    expect(
      merge(
        { organism: ['Rat', 'Mouse'] },
        { organism: ['Mouse', 'Rat'] },
        { organism: ['Rat', 'Mouse'] },
      ),
    ).toEqual([])
  })

  it('lists every affected field and only those', () => {
    expect(
      merge(
        { organism: ['Mouse'], polarity: ['Positive'] },
        { organism: ['Mouse'], polarity: ['Positive'], analyzer: ['TOF'] },
        {
          organism: ['Mouse', 'Human'],
          polarity: ['Positive', 'Negative'],
          analyzer: ['FTICR', 'TOF'],
        },
      ),
    ).toEqual([
      { key: 'organism', before: ['Mouse'], after: ['Mouse', 'Human'] },
      { key: 'polarity', before: ['Positive'], after: ['Positive', 'Negative'] },
      // 集合上没存过 analyzer，这次只补上新成员带来的那一个
      { key: 'analyzer', before: [], after: ['FTICR'] },
    ])
  })
})
