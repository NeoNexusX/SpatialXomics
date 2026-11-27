import { describe, expect, it } from 'vitest'
import { mapCollectionDetail, mapCollectionSummary } from '../collectionMapper'
import { deriveCollectionMetadata } from '../../utils/deriveCollectionMetadata'

/** 成员行没带的样本 / 采集元数据一律归一成 null */
const NO_METADATA = {
  organism: null,
  organismPart: null,
  sampleStabilization: null,
  sampleGrowthConditions: null,
  tissueModification: null,
  polarity: null,
  ionSource: null,
  analyzer: null,
}

// 真实后端（POST /collections/list）把元数据平铺在顶层，没有嵌套 metadata 对象
// （pixel_size_* / resolving_power / mz 已随集合级数值字段下线；数字 id 已随
// public_id 迁移下线，不再出现在响应中）
const flatRaw = {
  public_id: 'aB3xK9mQ2rT7wY1z',
  owner_username: 'lyk',
  name: 'Mouse kidney MSI',
  description: 'A curated set',
  member_type: [],
  collection_type: [],
  title: 'A title',
  doi: ['10.1000/xyz'],
  access: null,
  journal_name: 'Nature',
  abstract: 'An abstract',
  cite_information: '',
  organism: ['mouse'],
  organism_part: ['kidney'],
  sample_stabilization: [],
  sample_growth_conditions: [],
  tissue_modification: [],
  polarity: ['negative'],
  ionisation_source: [],
  analyzer: ['FTICR'],
  member_count: 3,
  total_size: 1024,
  created_at: '2026-09-01T00:00:00',
  updated_at: '2026-09-09T00:00:00',
}

const detailRaw = {
  ...flatRaw,
  members: [
    {
      public_id: 'qW3rT5yU7iO9pA1s',
      image_path: 'images/file_42/',
      filename: 'kidney1.imzML',
      size: 100,
      status: 'completed',
      is_public: true,
      experiment_type: 'imzML',
    },
    { public_id: 'zX9cV8bN6mL4kJ2h' },
  ],
}

describe('mapCollectionDetail', () => {
  it('maps top-level snake_case into camelCase', () => {
    const d = mapCollectionDetail(detailRaw)

    expect(d.memberCount).toBe(3)
    expect(d.totalSize).toBe(1024)
    expect(d.ownerUsername).toBe('lyk')
    expect(d.publicId).toBe('aB3xK9mQ2rT7wY1z')
    expect(d.updatedAt).toBe('2026-09-09T00:00:00')
    expect(d.title).toBe('A title')
  })

  it('extracts the flat metadata fields from the top level', () => {
    const d = mapCollectionDetail(detailRaw)

    // 后端平铺返回，元数据不能被丢掉（此前误以为嵌套在 raw.metadata 下）
    expect(d.metadata.doi).toEqual(['10.1000/xyz'])
    expect(d.metadata.organism).toEqual(['mouse'])
    expect(d.metadata.analyzer).toEqual(['FTICR'])
    expect(d.metadata.journal_name).toBe('Nature')
    expect(d.metadata.name).toBe('Mouse kidney MSI')
  })

  it('drops the retired collection-level numeric instrument fields', () => {
    // 即便旧响应残留这 4 个字段，也不进入 metadata（字段表已下线）
    const d = mapCollectionDetail({
      ...detailRaw,
      pixel_size_horizontal: ['10'],
      pixel_size_vertical: ['10'],
      resolving_power: ['100000'],
      mz: ['100.0'],
    })

    expect((d.metadata as unknown as Record<string, unknown>).pixel_size_horizontal).toBeUndefined()
    expect((d.metadata as unknown as Record<string, unknown>).resolving_power).toBeUndefined()
    expect((d.metadata as unknown as Record<string, unknown>).mz).toBeUndefined()
  })

  it('still supports a nested metadata object if the backend switches to one', () => {
    const nested = mapCollectionDetail({
      name: 'X',
      metadata: { name: 'X', doi: ['10.1/x'], organism: ['rat'] },
      members: [],
    })

    expect(nested.metadata.doi).toEqual(['10.1/x'])
    expect(nested.metadata.organism).toEqual(['rat'])
  })

  it('merges partial nested metadata without dropping top-level fields', () => {
    const mapped = mapCollectionDetail({
      name: 'X',
      organism: ['mouse'],
      metadata: { doi: ['10.1/x'] },
      members: [],
    })

    expect(mapped.metadata.doi).toEqual(['10.1/x'])
    expect(mapped.metadata.organism).toEqual(['mouse'])
  })

  it('normalizes legacy scalar list fields without dropping their values', () => {
    const mapped = mapCollectionDetail({
      name: 'X',
      member_type: 'MSI',
      collection_type: 'Serial sections',
      members: [],
    })

    expect(mapped.metadata.member_type).toEqual(['MSI'])
    expect(mapped.metadata.collection_type).toEqual(['Serial sections'])
  })

  it('maps members defensively: missing fields get defaults', () => {
    const d = mapCollectionDetail(detailRaw)

    expect(d.members).toHaveLength(2)
    expect(d.members[0]).toEqual({
      publicId: 'qW3rT5yU7iO9pA1s',
      imagePath: 'images/file_42/',
      filename: 'kidney1.imzML',
      size: 100,
      status: 'completed',
      isPublic: true,
      experimentType: 'imzML',
      ...NO_METADATA,
    })
    expect(d.members[1]).toEqual({
      publicId: 'zX9cV8bN6mL4kJ2h',
      imagePath: null,
      filename: '',
      size: 0,
      status: '',
      isPublic: false,
      experimentType: null,
      ...NO_METADATA,
    })
  })

  // 成员行就是完整的 FilePublic：样本 / 采集元数据要带出来，增删成员后才能据此比对汇总字段
  it('carries member sample / acquisition metadata for deriving summary fields', () => {
    const d = mapCollectionDetail({
      ...detailRaw,
      members: [
        {
          public_id: 'qW3rT5yU7iO9pA1s',
          organism: 'Human (Homo sapiens)',
          organism_part: 'Brain',
          polarity: 'Positive',
          ionisation_source: 'MALDI',
          analyzer: 'FTICR',
          // 后端对未填写的字符串字段给的是空串
          sample_stabilization: '',
        },
      ],
    })

    expect(d.members[0]).toMatchObject({
      organism: 'Human (Homo sapiens)',
      organismPart: 'Brain',
      polarity: 'Positive',
      ionSource: 'MALDI',
      analyzer: 'FTICR',
      sampleStabilization: null,
      sampleGrowthConditions: null,
      tissueModification: null,
    })
    // 与创建页的数据集共用同一套并集推导
    expect(deriveCollectionMetadata(d.members)).toMatchObject({
      organism: ['Human (Homo sapiens)'],
      organism_part: ['Brain'],
      polarity: ['Positive'],
      ionisation_source: ['MALDI'],
      analyzer: ['FTICR'],
      sample_stabilization: [],
    })
  })

  it('throws on a member row missing public_id (contract error, no silent "undefined")', () => {
    expect(() => mapCollectionDetail({ ...flatRaw, members: [{ filename: 'a.imzML' }] })).toThrow(
      /public_id/,
    )
  })

  it('tolerates empty payload', () => {
    const d = mapCollectionDetail({})
    expect(d.publicId).toBe('')
    expect(d.memberCount).toBe(0)
    expect(d.members).toEqual([])
    expect(d.metadata.name).toBe('')
  })
})

describe('mapCollectionSummary', () => {
  it('maps flat list rows (real POST /collections/list shape)', () => {
    const s = mapCollectionSummary(flatRaw)

    expect(s).toMatchObject({
      name: 'Mouse kidney MSI',
      title: 'A title',
      memberCount: 3,
      totalSize: 1024,
      ownerUsername: 'lyk',
      organism: ['mouse'],
      publicId: 'aB3xK9mQ2rT7wY1z',
    })
  })

  // 卡片直接渲染这些字段，必须从平铺的列表响应里挑出来
  it('exposes the card fields (doi / journal / access / organism part / ionisation source)', () => {
    const s = mapCollectionSummary(flatRaw)

    expect(s.doi).toEqual(['10.1000/xyz'])
    expect(s.journalName).toBe('Nature')
    expect(s.access).toEqual([])
    expect(s.organismPart).toEqual(['kidney'])
    expect(s.ionisationSource).toEqual([])
  })

  it('maps access as a list (backend contract is list[str])', () => {
    expect(mapCollectionSummary({ access: ['https://example.org/data'] }).access).toEqual([
      'https://example.org/data',
    ])
    // 后端历史上可能回过标量：归一成单元素列表而不是穿透原值
    expect(mapCollectionSummary({ access: 'https://example.org/data' }).access).toEqual([
      'https://example.org/data',
    ])
    expect(mapCollectionSummary({ access: '' }).access).toEqual([])
  })

  it('drops blank entries so the card does not render empty chips', () => {
    const s = mapCollectionSummary({ organism: ['rat', '', '  '], access: [] })

    expect(s.organism).toEqual(['rat'])
  })

  // 列表响应目前不带 members；若带上则直接映射，省掉逐卡详情请求
  it('maps members when the list row happens to carry them', () => {
    const s = mapCollectionSummary({
      ...flatRaw,
      members: [
        { public_id: 'qW3rT5yU7iO9pA1s', filename: 'a.imzML', status: 'completed', is_public: true },
      ],
    })

    expect(s.members?.map((m) => m.publicId)).toEqual(['qW3rT5yU7iO9pA1s'])
  })

  it('leaves members undefined when the list row has none', () => {
    expect(mapCollectionSummary(flatRaw).members).toBeUndefined()
  })
})
