import { describe, expect, it } from 'vitest'
import { parseUserDbCsv } from '../annotationDb'

describe('parseUserDbCsv legacy formula_ion format', () => {
  it('reads the lipidmaps_candidates header (formula_ion + Ion type + Exp. m/z + Candidate_N)', () => {
    const csv = [
      'formula_ion,Ion type,Exp. m/z,Candidate_1,Candidate_2,Candidate_3,Candidate_4,Candidate_5',
      'C40H66O5,[M+H]+,627.498302,2-methoxy-12-methyloctadec-17-en-5-ynoyl anhydride,FA 40:7;O3,,,',
      'C40H66O5,[M+K]+,665.454733,2-methoxy-12-methyloctadec-17-en-5-ynoyl anhydride,FA 40:7;O3,,,',
      'C42H82NO8P,[M+H]+,760.5856,PC 34:1,,,,',
    ].join('\n')
    const db = parseUserDbCsv('lipidmaps_candidates_s2fmt.csv', csv)
    // C40H66O5 两行合并为一个分子（候选去重），C42H82NO8P 一个
    expect(db.formula.length).toBe(2)
    expect(db.formula).toContain('C40H66O5')
    expect(db.formula).toContain('C42H82NO8P')
    const i = db.formula.indexOf('C40H66O5')
    const names = db.candidates[i]!.map((c) => c.name)
    expect(names).toContain('2-methoxy-12-methyloctadec-17-en-5-ynoyl anhydride')
    expect(names).toContain('FA 40:7;O3')
    // 质量按分子式计算（不用 Exp. m/z）
    expect(db.mass[i]!).toBeGreaterThan(600)
  })
})
