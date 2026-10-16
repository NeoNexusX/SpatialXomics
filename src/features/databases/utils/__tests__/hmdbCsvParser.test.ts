import { describe, expect, it } from 'vitest'
import { HmdbCsvError, parseHmdbCsv } from '../hmdbCsvParser'

// InChI 含逗号，按 CSV 规则用双引号包起来；这是全量文件的真实形态。
// 最后补一行 id/name 均为空的残缺行，验证跳过逻辑。
const CSV = [
  'ID,Name,Formula,InChI,Mass,Origin',
  'HMDB0240254,Creatine riboside,C9H17N3O6,"InChI=1S/C9H17N3O6/c1-12(2-5(14)15)9(10)11-8,",263.1117353,endogenous',
  'HMDB0240253,N-Acetyltaurine,C4H9NO4S,"InChI=1S/C4H9NO4S/c1-4(6)5-2-3-10(7,8)9",167.0252289,unknown',
  ',,,,,',
].join('\n')

describe('parseHmdbCsv', () => {
  it('parses rows, keeping quoted InChI with embedded commas intact', () => {
    const rows = parseHmdbCsv(CSV)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      id: 'HMDB0240254',
      name: 'Creatine riboside',
      formula: 'C9H17N3O6',
      inchi: 'InChI=1S/C9H17N3O6/c1-12(2-5(14)15)9(10)11-8,',
      mass: 263.1117353,
      origin: 'endogenous',
    })
  })

  it('strips a UTF-8 BOM and tolerates CRLF line endings', () => {
    // String.fromCharCode(0xfeff) 即 U+FEFF（UTF-8 BOM），避免在源码里写不可见字符
    const rows = parseHmdbCsv(String.fromCharCode(0xfeff) + CSV.replace(/\n/g, '\r\n'))
    expect(rows).toHaveLength(2)
    expect(rows[1]!.id).toBe('HMDB0240253')
  })

  it('recognizes common header aliases case-insensitively', () => {
    const rows = parseHmdbCsv(
      [
        // 旧五列格式（无 Origin）：origin 解析为空串
        'hmdb id,Compound,Molecular Formula,inchi,monoisotopic mass',
        'HMDB0240254,Creatine riboside,C9H17N3O6,"InChI=1S/x",263.1117353',
      ].join('\n'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('Creatine riboside')
    expect(rows[0]!.mass).toBeCloseTo(263.1117353)
    expect(rows[0]!.origin).toBe('')
  })

  it('yields NaN mass for missing or unparsable cells', () => {
    const rows = parseHmdbCsv(
      ['ID,Name,Formula,InChI,Mass,Origin', 'HMDB0000001,X,C1O1,,n/a,exogenous'].join('\n'),
    )
    expect(rows[0]!.mass).toBeNaN()
    expect(rows[0]!.origin).toBe('exogenous')
  })

  it('throws coded errors for unusable input', () => {
    expect(() => parseHmdbCsv('')).toThrow(HmdbCsvError)
    expect(() => parseHmdbCsv('ID,Name\n')).toThrow(/is empty/)
    expect(() => parseHmdbCsv('a,b\n1,2\n')).toThrow(/no id column/)
    // 有表头但所有数据行的 id/name 均为空
    expect(() => parseHmdbCsv('ID,Name,Formula,InChI,Mass\n,,C1,,1\n')).toThrow(/no usable rows/)
  })
})
