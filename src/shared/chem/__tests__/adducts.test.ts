import { describe, expect, it } from 'vitest'
import { ADDUCT_BY_ID, ADDUCT_DEFS, adductMz, adductShiftTable } from '../adducts'
import { formulaMass } from '../elements'

describe('adduct mass shifts', () => {
  // 参考值：离子质量 − 中性质量（含电子质量）
  it.each([
    ['M+H', 1.007276],
    ['M+Na', 22.989221],
    ['M+K', 38.963158],
    ['M+NH4', 18.033826],
    ['M+Li', 7.015455],
    ['M-H', -1.007276],
    ['M+Cl', 34.969401],
    ['M+HCOO', 44.998203],
    // 旧助手表里这一项少加了一个电子（59.013304）
    ['M+CH3COO', 59.013853],
    ['M-2H+Na', 20.974668],
    ['M-2H+K', 36.948605],
  ] as const)('%s shift is %f', (id, expected) => {
    expect(ADDUCT_BY_ID[id].shift).toBeCloseTo(expected, 5)
  })

  it('gives the textbook [M+H]+ / [M+Na]+ of PC 34:1', () => {
    const m = formulaMass('C42H82NO8P')!
    expect(m).toBeCloseTo(759.577805, 5)
    expect(adductMz(m, ADDUCT_BY_ID['M+H'])).toBeCloseTo(760.585082, 5)
    expect(adductMz(m, ADDUCT_BY_ID['M+Na'])).toBeCloseTo(782.567026, 5)
  })

  it('has one positive or negative charge per adduct and unique ids', () => {
    expect(new Set(ADDUCT_DEFS.map((d) => d.id)).size).toBe(ADDUCT_DEFS.length)
    for (const d of ADDUCT_DEFS) {
      expect(d.charge).toBe(1)
      expect(d.label.endsWith(d.polarity === 'positive' ? '+' : '-')).toBe(true)
    }
  })

  it('builds a label → shift table for a subset', () => {
    expect(adductShiftTable(['M+H', 'M-H'])).toEqual({
      '[M+H]+': ADDUCT_BY_ID['M+H'].shift,
      '[M-H]-': ADDUCT_BY_ID['M-H'].shift,
    })
  })
})

describe('formulaMass', () => {
  it('ignores whitespace and a trailing charge sign', () => {
    expect(formulaMass(' C6H12O6 ')).toBeCloseTo(180.063388, 5)
    expect(formulaMass('C24H50NO7P+')).toBeCloseTo(formulaMass('C24H50NO7P')!, 9)
  })

  it('rejects unknown elements and unparsable input', () => {
    expect(formulaMass('C6H12Xx')).toBeNull()
    expect(formulaMass('C6(H2O)6')).toBeNull()
    expect(formulaMass('')).toBeNull()
  })
})
