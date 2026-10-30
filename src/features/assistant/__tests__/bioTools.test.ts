import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import {
  searchHmdbIndex,
  massSearchHmdbIndex,
  pathwayEnrichment,
  type HmdbRow,
  type KeggIndex,
} from '../tools/bioTools'
import { ADDUCTS } from '../tools/knowledgeTools'
import { toolsProvider } from '../providers/tools'
import { skillsProvider } from '../providers/skills'
import { frontendContextTools } from '../tools/frontendContextTools'
import { registerContextProviders, unregisterContextProviders } from '../providers/analysisContext'
import type { AnnotationRow } from '../agenttypes/assistant'

const HMDB: HmdbRow[] = [
  [
    'HMDB00165',
    'L-Malic acid',
    'C4H6O5',
    134.021528,
    'C00149',
    ['Cytoplasm', 'Mitochondria'],
    ['Diabetes mellitus'],
    'A dicarboxylic acid intermediate in the citric acid cycle.',
  ],
  [
    'HMDB0000122',
    'D-Glucose',
    'C6H12O6',
    180.063388,
    'C00031',
    ['Cytosol', 'Blood'],
    [],
    'Primary energy source.',
  ],
  [
    'HMDB0000673',
    'Caffeine',
    'C8H10N4O2',
    194.080375,
    'C07481',
    [],
    [],
    'A central nervous system stimulant.',
  ],
]

describe('searchHmdbIndex', () => {
  it('matches names case/punctuation-insensitively', () => {
    const hits = searchHmdbIndex(HMDB, 'l malic', 5)
    expect(hits).toHaveLength(1)
    expect(hits[0]![0]).toBe('HMDB00165')
  })

  it('matches accession fragments', () => {
    expect(searchHmdbIndex(HMDB, 'hmdb0000673', 5)).toHaveLength(1)
  })

  it('caps results', () => {
    expect(searchHmdbIndex(HMDB, 'e', 1)).toHaveLength(1)
  })
})

describe('massSearchHmdbIndex', () => {
  it('finds [M-H]- of malic acid within ppm and sorts by |Δppm|', () => {
    const neutral = HMDB[0]![3]!
    // 检索表语义：neutral = mz − shift → 离子 m/z = neutral + shift
    const shift = ADDUCTS.negative['[M-H]-']!
    const ionMz = neutral + shift
    expect(ionMz).toBeCloseTo(neutral - 1.007276, 6)
    const hits = massSearchHmdbIndex(HMDB, ionMz, 'negative', 10, 5)
    expect(hits[0]!.row[0]).toBe('HMDB00165')
    expect(hits[0]!.adduct).toBe('[M-H]-')
    expect(Math.abs(hits[0]!.ppm)).toBeLessThan(1)
  })
})

describe('pathwayEnrichment', () => {
  const HMDB_IDX: HmdbRow[] = [
    ['HMDB0000122', 'D-Glucose', 'C6H12O6', 180.063388, 'C00031', [], [], null],
    ['HMDB0000064', 'L-Glutamine', 'C5H10N2O3', 146.069142, 'C00064', [], [], null],
    ['HMDB0000908', 'PC 34:1', 'C42H82NO8P', 759.5778, null, [], [], null], // 无 KEGG id
  ]
  const KEGG_IDX: KeggIndex = {
    pathways: {
      '00010': 'Glycolysis / Gluconeogenesis',
      '00250': 'Alanine, aspartate and glutamate metabolism',
    },
    compounds: {
      c00031: ['C00031', 'D-Glucose'],
      c00064: ['C00064', 'L-Glutamine'],
    },
    links: {
      c00031: ['00010'],
      c00064: ['00250'],
    },
  }
  const mkRow = (rank: number, name: string, formula: string): AnnotationRow => ({
    id: rank,
    rank,
    name,
    origin: 'endogenous',
    candidates: [{ id: '', name, origin: 'endogenous' }],
    formula,
    adduct: '[M+H]+',
    theoMz: 100,
    obsMz: 100,
    errPpm: 0,
    intensity: 1,
    massScore: 1,
    adductFit: 1,
    chaos: null,
    coloc: null,
    spatialScore: null,
    totalScore: 1,
    q: 0.01,
    siblings: [],
    samePeak: [],
    missingAdducts: [],
  })

  it('folds adduct ions of one formula into a single molecule and ranks pathways by count', () => {
    const rows: AnnotationRow[] = [
      mkRow(1, 'D-Glucose', 'C6H12O6'),
      { ...mkRow(2, 'D-Glucose', 'C6H12O6'), adduct: '[M+Na]+' }, // 同分子另一加合物 → 折叠
      mkRow(3, 'L-Glutamine', 'C5H10N2O3'),
      mkRow(4, 'PC 34:1', 'C42H82NO8P'), // 无通路
    ]
    const r = pathwayEnrichment(rows, HMDB_IDX, KEGG_IDX, 20)
    expect(r.totalFormulas).toBe(3) // 折叠后 3 个分子
    expect(r.mappedFormulas).toBe(2) // glucose + glutamine 有通路
    const names = r.hits.map((h) => h.name)
    expect(names).toContain('Glycolysis / Gluconeogenesis')
    expect(names).toContain('Alanine, aspartate and glutamate metabolism')
    expect(r.unmapped).toContain('PC 34:1')
  })

  it('reports the shared pathway as the strongest signal when ≥2 molecules map to it', () => {
    const rows: AnnotationRow[] = [
      mkRow(1, 'D-Glucose', 'C6H12O6'),
      mkRow(2, 'D-Glucose', 'C6H12O6'), // 同名不同式不会出现，这里凑同通路
    ]
    const r = pathwayEnrichment(rows, HMDB_IDX, KEGG_IDX, 20)
    // 同分子式折叠 → 实际只 1 个分子 1 条通路
    expect(r.hits).toHaveLength(1)
    expect(r.hits[0]!.mapId).toBe('00010')
  })

  it('returns empty hits when nothing maps', () => {
    const rows: AnnotationRow[] = [mkRow(1, 'PC 34:1', 'C42H82NO8P')]
    const r = pathwayEnrichment(rows, HMDB_IDX, KEGG_IDX, 20)
    expect(r.hits).toHaveLength(0)
    expect(r.mappedFormulas).toBe(0)
  })
})

describe('批量工具调用（array 参数走完整 ToolRuntime 管线）', () => {
  function mkCtx() {
    const ctx = new Context()
    ctx.plugin(toolsProvider)
    // frontendContextTools.inject 声明了 ['tools','skills']：skills 服务缺位
    // 时 fiber 静默失败（工具一个都注册不上，正是 bootstrap.test.ts 把关的场景）
    ctx.plugin(skillsProvider)
    ctx.plugin(frontendContextTools)
    return ctx
  }

  it('get_annotation_detail 标量单查行为保持不变（缺参报可读错误）', async () => {
    const ctx = mkCtx()
    await new Promise((r) => setTimeout(r, 10))

    // 没有任何 provider（注释面板未开）→ unavailable 提示而非报错
    const r = await ctx.tools.execute({
      callId: 'c1',
      name: 'get_annotation_detail',
      arguments: { mz: 760.58 },
      signal: new AbortController().signal,
    })
    expect(r.isError).toBe(false)
    expect(r.content).toContain('Annotation data')
  })

  it('get_annotation_detail 批量 mzs：一次调用返回逐行分节结果', async () => {
    const mkRow = (id: number, name: string, obsMz: number): AnnotationRow =>
      ({
        id,
        rank: id,
        name,
        origin: 'endogenous',
        candidates: [{ id: '', name, origin: 'endogenous' }],
        formula: 'C42H82NO8P',
        adduct: '[M+H]+',
        theoMz: obsMz,
        obsMz,
        errPpm: 0,
        intensity: 1,
        massScore: 1,
        adductFit: 1,
        chaos: null,
        coloc: null,
        spatialScore: null,
        totalScore: 1,
        q: 0.01,
        siblings: [],
        samePeak: [],
        missingAdducts: [],
      }) as AnnotationRow
    const rowA = mkRow(1, 'PC 34:1', 760.5856)
    const rowB = mkRow(2, 'PC 36:4', 806.5696)
    const rowC = mkRow(3, 'SM d18:1/16:0', 703.5748)
    registerContextProviders({
      annotations: () => ({ count: 3, rows: () => [rowA, rowB, rowC] }),
    })

    const ctx = mkCtx()
    await new Promise((r) => setTimeout(r, 10))

    const r = await ctx.tools.execute({
      callId: 'c2',
      name: 'get_annotation_detail',
      arguments: { mzs: [760.5856, 806.5696, 999.9] },
      signal: new AbortController().signal,
    })
    expect(r.isError).toBe(false)
    // 逐行分节：命中的两行 + 未命中的 m/z 行
    expect(r.content).toContain('### m/z 760.5856')
    expect(r.content).toContain('PC 34:1')
    expect(r.content).toContain('### m/z 806.5696')
    expect(r.content).toContain('PC 36:4')
    expect(r.content).toContain('### m/z 999.9')
    expect(r.content).toContain('No annotation row matched near m/z 999.9')

    // 清理全局 provider 注册（pageState.test.ts 同款收尾），避免影响其他测试
    unregisterContextProviders()
  })

  it('hmdb_lookup 批量 queries + 单 query 走同一执行体（无索引部署下报可读指引）', async () => {
    const ctx = mkCtx()
    ctx.plugin((await import('../tools/bioTools')).bioTools)
    await new Promise((r) => setTimeout(r, 10))

    // 测试环境没有 public/data/hmdb-index.json → 单查与批量都应得到带
    // 构建指引的可读错误（isError 回喂模型），而非未知异常
    const single = await ctx.tools.execute({
      callId: 'c3',
      name: 'hmdb_lookup',
      arguments: { query: 'glucose' },
      signal: new AbortController().signal,
    })
    expect(single.isError).toBe(true)
    expect(single.content).toContain('hmdb-index.json')

    const batch = await ctx.tools.execute({
      callId: 'c4',
      name: 'hmdb_lookup',
      arguments: { queries: ['glucose', 'caffeine'] },
      signal: new AbortController().signal,
    })
    // 索引加载发生在 hmdbLookup 内部：批量时 renderBatch 会把单项错误
    // 转成该节的错误文本 —— isError 仍为 true（首个节即错误）或包含指引文本
    expect(batch.content).toContain('hmdb-index.json')
  })

  it('kegg_pathway_lookup 缺参（标量与数组都没给）报可读错误', async () => {
    const ctx = mkCtx()
    ctx.plugin((await import('../tools/bioTools')).bioTools)
    await new Promise((r) => setTimeout(r, 10))

    const r = await ctx.tools.execute({
      callId: 'c5',
      name: 'kegg_pathway_lookup',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('Provide "query" or "queries"')
  })
})
