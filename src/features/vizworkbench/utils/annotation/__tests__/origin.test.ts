import { describe, expect, it } from 'vitest'
import { moleculeOrigin, originRank, parseOrigin } from '../origin'
import { buildAnnotationCsv, samePeakIons } from '../format'
import { csvLines, splitCsvLine } from '../csv'
import type {
  CandidateOrigin,
  IonAnnotation,
  Molecule,
} from '@/features/vizworkbench/types/annotation'

function molecule(id: number, ...origins: (CandidateOrigin | undefined)[]): Molecule {
  return {
    id,
    formula: `C${id}H${id}O`,
    neutralMass: 100 + id,
    candidates: origins.map((origin, k) => ({
      id: `T${id}${k}`,
      name: `Compound ${id}${'abc'[k]}`,
      inchi: '',
      ...(origin ? { origin } : {}),
    })),
    ionIds: [id],
    missing: [],
  }
}

function ion(id: number, rank: number, samePeak: number[]): IonAnnotation {
  return {
    id,
    moleculeId: id,
    adduct: 'M-H',
    fit: 1,
    peak: 0,
    axisIndex: 0,
    theoMz: 100,
    obsMz: 100,
    errPpm: 0,
    intensity: 1,
    samePeak,
    scores: {
      mass: 1,
      adduct: 1,
      chaos: null,
      coloc: null,
      spatial: null,
      spatialState: 'na',
      total: 1 - rank / 100,
    },
    q: 0.01,
    rank,
  }
}

describe('compound origin', () => {
  it('parses the four levels case-insensitively and ignores anything else', () => {
    expect(parseOrigin(' Endogenous ')).toBe('endogenous')
    expect(parseOrigin('EXOGENOUS')).toBe('exogenous')
    expect(parseOrigin('')).toBeUndefined()
    expect(parseOrigin('内源')).toBeUndefined()
  })

  it('orders endogenous → expected → unknown → exogenous, unlabelled as unknown', () => {
    const levels: (CandidateOrigin | undefined)[] = [
      'exogenous',
      undefined,
      'expected',
      'endogenous',
    ]
    expect(levels.map(originRank)).toEqual([3, 2, 1, 0])
    expect(originRank(undefined)).toBe(originRank('unknown'))
  })

  it('takes the molecule origin from its first candidate', () => {
    expect(moleculeOrigin(molecule(1, 'endogenous', 'exogenous'))).toBe('endogenous')
    expect(moleculeOrigin(molecule(2, undefined))).toBeUndefined()
    expect(moleculeOrigin(undefined)).toBeUndefined()
  })
})

describe('same-peak annotations and export', () => {
  // 一个峰上 5 种解释：1 外源、2 和 4 内源、3 没有标签
  const molecules = new Map(
    [
      molecule(0, 'expected'),
      molecule(1, 'exogenous', 'exogenous'),
      molecule(2, 'endogenous', 'unknown'),
      molecule(3, undefined),
      molecule(4, 'endogenous'),
    ].map((m) => [m.id, m]),
  )
  const ions = [
    ion(0, 3, [1, 2, 3, 4]),
    ion(1, 1, [0]),
    ion(2, 5, [0]),
    ion(3, 2, [0]),
    ion(4, 4, [0]),
  ]
  const ionById = new Map(ions.map((i) => [i.id, i]))

  it('lists other annotations on the peak by origin, then by rank', () => {
    expect(samePeakIons(ions[0]!, ionById, molecules).map((i) => i.id)).toEqual([4, 2, 3, 1])
  })

  it('exports the origin of the displayed name and keeps the same-peak order', () => {
    const csv = buildAnnotationCsv([ions[0]!, ions[3]!], molecules, ionById, new Map())
    const [header, first, second] = csvLines(csv).map((line) => splitCsvLine(line, ','))
    expect(header!.slice(0, 4)).toEqual(['Rank', 'Name', 'Origin', 'Candidates'])
    const origin = header!.indexOf('Origin')
    expect(first![origin]).toBe('expected')
    expect(second![origin]).toBe('')
    const samePeak = header!.indexOf('Same-peak annotations')
    expect(first![samePeak]!.split('; ').map((s) => s.split(' [')[0])).toEqual([
      'Compound 4a',
      'Compound 2a',
      'Compound 3a',
      'Compound 1a',
    ])
  })
})
