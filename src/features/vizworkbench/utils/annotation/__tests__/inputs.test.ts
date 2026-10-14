import { describe, expect, it } from 'vitest'
import { decodeCsvBytes } from '../csv'
import { AnnotationDbCsvError, buildAnnotationDb, parseAnnotationDbCsv } from '../annotationDb'
import { keptCount, MAX_CUT_PCT, rankByIntensity, selectPeaks } from '../peaks'
import { compoundUrl } from '../format'
import { buildTestDb } from '../__fixtures__/testDb'
import { formulaMass } from '@/shared/chem/elements'

describe('peaks from the mean spectrum', () => {
  const axis = new Float64Array([100, 150, 200, 250, 300, 350])
  const mean = new Float32Array([5, 0, 1, NaN, 3, 2])

  it('ranks only peaks with intensity > 0, weakest first', () => {
    expect(Array.from(rankByIntensity(mean))).toEqual([2, 5, 4, 0])
    // 强度相同时按下标
    expect(Array.from(rankByIntensity(new Float32Array([2, 1, 2, 1])))).toEqual([1, 3, 0, 2])
  })

  it('drops the weakest n% (rounded down) and keeps m/z order', () => {
    const ranked = rankByIntensity(mean)
    const all = selectPeaks(axis, mean, ranked, 0)
    expect(Array.from(all.axisIndex)).toEqual([0, 2, 4, 5])
    expect(Array.from(all.mz)).toEqual([100, 200, 300, 350])
    expect(Array.from(all.intensity)).toEqual([5, 1, 3, 2])
    // 4 个非零峰去掉 50% → 去掉最弱的 2 个（强度 1、2）
    const half = selectPeaks(axis, mean, ranked, 50)
    expect(Array.from(half.axisIndex)).toEqual([0, 4])
    // 4 × 30% = 1.2 → 去掉 1 个
    expect(Array.from(selectPeaks(axis, mean, ranked, 30).axisIndex)).toEqual([0, 4, 5])
  })

  it('counts kept peaks and clamps the percentage', () => {
    expect(keptCount(1000, 0)).toBe(1000)
    expect(keptCount(1000, 25)).toBe(750)
    expect(keptCount(7, 50)).toBe(4)
    expect(keptCount(1000, 150)).toBe(1000 - (1000 * MAX_CUT_PCT) / 100)
    expect(keptCount(1000, -5)).toBe(1000)
    expect(keptCount(0, 50)).toBe(0)
  })
})

describe('csv', () => {
  it('decodes GBK bytes when the file is not UTF-8', () => {
    // 「质荷比」的 GBK 编码
    const gbk = new Uint8Array([0xd6, 0xca, 0xba, 0xc9, 0xb1, 0xc8])
    expect(decodeCsvBytes(gbk.buffer)).toBe('质荷比')
  })
})

describe('annotation database', () => {
  const META = { id: 'x', label: 'X', version: '1' }
  const INCHI =
    'InChI=1S/C9H17N3O6/c1-12(2-5(14)15)9(10)11-8-7(17)6(16)4(3-13)18-8/h4,6-8,13,16-17H,' +
    '2-3H2,1H3,(H2,10,11)(H,14,15)/t4-,6-,7-,8-/m1/s1'

  it('reads the template row as pasted from a spreadsheet (trailing tabs, quoted InChI)', () => {
    const csv =
      'ID,Name,Formula,InChI,Mass' +
      '\t'.repeat(15) +
      '\n' +
      `HMDB0240254,Creatine riboside,C9H17N3O6,"${INCHI}",263.1117353` +
      '\t'.repeat(5) +
      '\n'
    const db = parseAnnotationDbCsv(csv, META)
    expect(db.formula).toEqual(['C9H17N3O6'])
    expect(db.mass[0]).toBe(263.1117353)
    expect(db.candidates[0]).toEqual([
      { id: 'HMDB0240254', name: 'Creatine riboside', inchi: INCHI },
    ])
    // 模板里的 Mass 就是按分子式算的单同位素中性质量
    expect(db.mass[0]).toBeCloseTo(formulaMass('C9H17N3O6')!, 6)
  })

  it('groups isomers by formula and falls back to the formula mass', () => {
    const csv = [
      'ID,Name,Formula,InChI,Mass',
      'A1,Glucose,C6H12O6,,180.0633881',
      'A2,Galactose,C6H12O6,,',
      'A2,Galactose (duplicate),C6H12O6,,',
      'B1,,C2H6O,,',
      ',No formula,,,',
    ].join('\n')
    const db = parseAnnotationDbCsv(csv, META)
    expect(db.formula).toEqual(['C2H6O', 'C6H12O6'])
    expect(db.mass[0]).toBeCloseTo(formulaMass('C2H6O')!, 9)
    expect(db.candidates[1]!.map((c) => c.id)).toEqual(['A1', 'A2'])
    // 只有编号没有名称时用编号当名称
    expect(db.candidates[0]).toEqual([{ id: 'B1', name: 'B1', inchi: '' }])
  })

  it('reads the optional Origin column and lists candidates endogenous first', () => {
    const csv = [
      'ID,Name,Formula,InChI,Mass,Origin',
      'H6,Hexose U1,C6H12O6,,,unknown',
      'H5,Hexose X,C6H12O6,,,Exogenous',
      'H4,Hexose E1,C6H12O6,,,endogenous',
      'H3,Hexose P,C6H12O6,,,expected',
      'H2,Hexose E2,C6H12O6,,,endogenous',
      'H1,Hexose U2,C6H12O6,,,not a level',
    ].join('\n')
    const db = parseAnnotationDbCsv(csv, META)
    // 按等级排，同级保持文件里的先后；认不出的值不带标签，排在未定一级
    expect(db.candidates[0]!.map((c) => [c.name, c.origin])).toEqual([
      ['Hexose E1', 'endogenous'],
      ['Hexose E2', 'endogenous'],
      ['Hexose P', 'expected'],
      ['Hexose U1', 'unknown'],
      ['Hexose U2', undefined],
      ['Hexose X', 'exogenous'],
    ])
    expect('origin' in db.candidates[0]![4]!).toBe(false)
  })

  it('still reads the older adduct-expanded format by formula', () => {
    const csv = [
      'formula,Ion type,Exp. m/z,Candidate_1,Candidate_2,Candidate_3',
      'C40H66O5,[M+H]+,627.498302,anhydride,FA 40:7;O3,',
      'C40H66O5,[M+K]+,665.454733,anhydride,FA 40:7;O3,',
      'C6H12O6,[M+Na]+,203.052610,Glucose,Galactose,nan',
      'C6H12O6,[M+H]+,181.070665,Fructose,-,',
      'Xx2,[M+H]+,1,Bad,,',
    ].join('\n')
    const db = parseAnnotationDbCsv(csv, META)
    expect(db.formula).toEqual(['C6H12O6', 'C40H66O5'])
    expect(db.mass[1]).toBeCloseTo(formulaMass('C40H66O5')!, 9)
    expect(db.candidates.map((cs) => cs.map((c) => c.name))).toEqual([
      ['Glucose', 'Galactose', 'Fructose'],
      ['anhydride', 'FA 40:7;O3'],
    ])
  })

  it('rejects CSVs that are not a database, with a code the panel can translate', () => {
    const code = (csv: string) => {
      try {
        parseAnnotationDbCsv(csv, META)
      } catch (e) {
        return e instanceof AnnotationDbCsvError ? e.code : 'other'
      }
      return 'ok'
    }
    expect(code('')).toBe('empty')
    // 峰列表（m/z, intensity）放进了数据库的位置
    expect(code('m/z,intensity\n536.1682,1200\n')).toBe('noFormulaColumn')
    expect(code('ID,Name,Formula\nA,No formula,\n')).toBe('noRows')
  })

  it('loads the template-format test fixture', () => {
    const db = buildTestDb()
    expect(db.formula.length).toBe(31)
    const pc = db.formula.indexOf('C42H82NO8P')
    expect(db.candidates[pc]!.map((c) => c.name)).toEqual([
      'PC 34:1',
      'PC 16:0_18:1',
      'PC 18:1_16:0',
    ])
  })

  it('links well-known database IDs', () => {
    expect(compoundUrl('HMDB0240254')).toBe('https://hmdb.ca/metabolites/HMDB0240254')
    expect(compoundUrl('LMGP01010005')).toContain('lipidmaps.org')
    expect(compoundUrl('C00031')).toContain('kegg.jp')
    expect(compoundUrl('CHEBI:17234')).toContain('ebi.ac.uk')
    expect(compoundUrl('TEST0001')).toBeNull()
  })

  it('merges entries built in code the same way', () => {
    const db = buildAnnotationDb(META, [
      { formula: 'C2H6O', mass: 46.5, candidates: [{ id: '', name: 'A', inchi: '' }] },
      { formula: 'C2H6O', candidates: [{ id: '', name: 'B', inchi: '' }] },
    ])
    expect(Array.from(db.mass)).toEqual([46.5])
    expect(db.candidates[0]!.map((c) => c.name)).toEqual(['A', 'B'])
  })
})
