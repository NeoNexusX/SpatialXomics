import { describe, expect, it } from 'vitest'
import {
  FILE_METADATA_MAX_STRING_LENGTH,
  buildFileMetadataPatch,
  changedFileMetadataKeys,
  findFileMetadataNumberAdjustments,
  countFileMetadataChars,
  isValidFileMetadataNumber,
  isValidFileMetadataString,
  parseFileMetadataNumber,
  parseFileMetadataValidationIssues,
  toFileMetadataDraft,
  validateFileMetadataDraft,
} from '../fileMetadataPatch'
import type { File } from '@/features/datasets/types/dataset'

const baseFile = {
  publicId: 'qW3rT5yU7iO9pA1s',
  imagePath: 'images/file_7/',
  name: 'kidney',
  submitTime: '2026-09-10T00:00:00',
  submitter: 'u',
  status: 'completed',
  isPublic: true,
  organism: 'Mouse',
  organismPart: 'Kidney',
  polarity: 'Positive',
  ionSource: 'MALDI',
  analyzer: 'TOF',
  pixelSizeHorizontal: 50,
  pixelSizeVertical: 50,
  resolvingPower: 140000,
  mz: 200,
  spectrumMode: 'profile',
  storageMode: 'processed',
} as File

describe('toFileMetadataDraft', () => {
  it('maps camelCase File fields into snake_case draft with "" / string defaults', () => {
    const draft = toFileMetadataDraft(baseFile)

    expect(draft).toMatchObject({
      organism: 'Mouse',
      organism_part: 'Kidney',
      polarity: 'Positive',
      ionisation_source: 'MALDI',
      analyzer: 'TOF',
      pixel_size_horizontal: '50',
      pixel_size_vertical: '50',
      resolving_power: '140000',
      mz: '200',
      maldi_matrix: '', // 未填字段归一
      sample_stabilization: '',
    })
    expect(draft).not.toHaveProperty('spectrum_mode')
    expect(draft).not.toHaveProperty('storage_mode')
  })

  it('keeps numeric zero and missing numbers as "0" / "" respectively', () => {
    const file = { ...baseFile, pixelSizeHorizontal: 0, pixelSizeVertical: undefined } as File
    const draft = toFileMetadataDraft(file)

    expect(draft.pixel_size_horizontal).toBe('0')
    expect(draft.pixel_size_vertical).toBe('')
  })
})

describe('buildFileMetadataPatch', () => {
  it('returns an empty patch when nothing changed', () => {
    expect(buildFileMetadataPatch(baseFile, toFileMetadataDraft(baseFile))).toEqual({})
  })

  it('includes only changed text keys with snake_case names', () => {
    const draft = toFileMetadataDraft(baseFile)
    draft.organism = 'Rat'
    draft.maldi_matrix = 'DHB (2,5-Dihydroxybenzoic acid)'
    draft.polarity = 'Negative'
    draft.analyzer = 'Orbitrap'

    expect(buildFileMetadataPatch(baseFile, draft)).toEqual({
      organism: 'Rat',
      maldi_matrix: 'DHB (2,5-Dihydroxybenzoic acid)',
      polarity: 'Negative',
      analyzer: 'Orbitrap',
    })
  })

  it('sends text fields even when cleared to empty string', () => {
    const draft = toFileMetadataDraft(baseFile)
    draft.organism = ''

    expect(buildFileMetadataPatch(baseFile, draft)).toEqual({ organism: '' })
  })

  it('sends a changed numeric field as a number, not a string', () => {
    const draft = toFileMetadataDraft(baseFile)
    draft.mz = '500'

    const patch = buildFileMetadataPatch(baseFile, draft)

    expect(patch).toEqual({ mz: 500 })
    expect(typeof patch.mz).toBe('number')
  })

  it('sends only the one instrument field the user changed', () => {
    const draft = toFileMetadataDraft(baseFile)
    draft.pixel_size_vertical = '40'

    expect(buildFileMetadataPatch(baseFile, draft)).toEqual({ pixel_size_vertical: 40 })
  })

  it('sends 0 (not null) when a numeric field is cleared', () => {
    const draft = toFileMetadataDraft(baseFile)
    draft.pixel_size_horizontal = ''
    draft.mz = ''

    const patch = buildFileMetadataPatch(baseFile, draft)

    expect(patch).toEqual({ pixel_size_horizontal: 0, mz: 0 })
    expect(Object.values(patch)).not.toContain(null)
  })

  it('skips invalid numeric input instead of emitting NaN / Infinity / null', () => {
    for (const invalid of ['-1', 'abc', 'NaN', 'Infinity', '-Infinity', '1e309']) {
      const draft = toFileMetadataDraft(baseFile)
      draft.mz = invalid
      expect(buildFileMetadataPatch(baseFile, draft)).toEqual({})
    }
  })

  it('never sends spectrum_mode / storage_mode even if they exist on the draft', () => {
    const draft = {
      ...toFileMetadataDraft(baseFile),
      spectrum_mode: 'centroid',
      storage_mode: 'continuous',
    } as unknown as Parameters<typeof buildFileMetadataPatch>[1]

    expect(buildFileMetadataPatch(baseFile, draft)).toEqual({})
  })

  // 回归：solvent 曾被漏出可改字段清单（其余样本属性都能改，只有它改不了）
  it('round-trips solvent and sends it as a plain text field when changed', () => {
    const file = { ...baseFile, solvent: '50% Methanol (MeOH), 50% Water' } as File

    expect(toFileMetadataDraft(file).solvent).toBe('50% Methanol (MeOH), 50% Water')

    const draft = toFileMetadataDraft(file)
    draft.solvent = '100% Water'
    expect(buildFileMetadataPatch(file, draft)).toEqual({ solvent: '100% Water' })
  })
})

describe('changedFileMetadataKeys', () => {
  it('reports only raw draft values that differ from the file', () => {
    const draft = toFileMetadataDraft(baseFile)
    expect(changedFileMetadataKeys(baseFile, draft)).toEqual([])

    draft.analyzer = 'FTICR'
    draft.mz = '300'

    expect(changedFileMetadataKeys(baseFile, draft)).toEqual(['analyzer', 'mz'])
  })
})

describe('server numeric precision', () => {
  it('reports changed submitted numbers using the persisted values', () => {
    expect(
      findFileMetadataNumberAdjustments(
        { resolving_power: 140000.5, mz: 123456.789, pixel_size_horizontal: 12.5 },
        { ...baseFile, resolvingPower: 140000, mz: 123457, pixelSizeHorizontal: 12.5 },
      ),
    ).toEqual([
      { key: 'resolving_power', submitted: 140000.5, stored: 140000 },
      { key: 'mz', submitted: 123456.789, stored: 123457 },
    ])
  })

  it('does not flag omitted fields, equivalent numeric strings, or missing response values', () => {
    expect(findFileMetadataNumberAdjustments({ mz: 200 }, { ...baseFile, mz: '200' })).toEqual([])
    expect(findFileMetadataNumberAdjustments({ mz: 200 }, { ...baseFile, mz: undefined })).toEqual(
      [],
    )
    expect(findFileMetadataNumberAdjustments({}, { ...baseFile, mz: 123457 })).toEqual([])
  })
})

describe('field validation', () => {
  it('accepts strings up to 128 code points and rejects longer ones', () => {
    expect(isValidFileMetadataString('a'.repeat(FILE_METADATA_MAX_STRING_LENGTH))).toBe(true)
    expect(isValidFileMetadataString('a'.repeat(FILE_METADATA_MAX_STRING_LENGTH + 1))).toBe(false)
    // emoji 是代理对，按码点计数才和 Python 的 len 一致
    expect(countFileMetadataChars('😀'.repeat(128))).toBe(128)
    expect(isValidFileMetadataString('😀'.repeat(129))).toBe(false)
  })

  it('accepts empty / zero / finite non-negative numbers and rejects the rest', () => {
    for (const value of ['', '0', '0.5', '.5', '1e3', '+2', ' 50 ']) {
      expect(isValidFileMetadataNumber(value)).toBe(true)
    }
    for (const value of ['-1', 'abc', 'NaN', 'Infinity', '-Infinity', '1e309']) {
      expect(isValidFileMetadataNumber(value)).toBe(false)
    }

    expect(parseFileMetadataNumber('')).toBe(0)
    expect(parseFileMetadataNumber('-1')).toBeNull()
    expect(parseFileMetadataNumber('Infinity')).toBeNull()
  })

  it('validates only changed fields and reports the error kind per field', () => {
    const draft = toFileMetadataDraft(baseFile)
    draft.organism = 'a'.repeat(FILE_METADATA_MAX_STRING_LENGTH + 1)
    draft.mz = '-1'

    expect(validateFileMetadataDraft(baseFile, draft)).toEqual([
      { key: 'organism', kind: 'tooLong' },
      { key: 'mz', kind: 'invalidNumber' },
    ])
  })
})

describe('parseFileMetadataValidationIssues', () => {
  it('maps FastAPI loc arrays to editable fields', () => {
    expect(
      parseFileMetadataValidationIssues([
        {
          loc: ['body', 'mz'],
          msg: 'Input should be greater than or equal to 0',
          type: 'greater_than_equal',
        },
        {
          loc: ['body', 'organism'],
          msg: 'String should have at most 128 characters',
          type: 'string_too_long',
        },
        { loc: ['body', 'spectrum_mode'], msg: 'Unknown field', type: 'extra_forbidden' },
        { msg: 'no loc' },
      ]),
    ).toEqual([
      { key: 'mz', msg: 'Input should be greater than or equal to 0', type: 'greater_than_equal' },
      {
        key: 'organism',
        msg: 'String should have at most 128 characters',
        type: 'string_too_long',
      },
      { key: null, msg: 'Unknown field', type: 'extra_forbidden' },
      { key: null, msg: 'no loc', type: '' },
    ])
  })

  it('returns [] for non-array detail (403/404 bodies)', () => {
    expect(parseFileMetadataValidationIssues('Permission denied')).toEqual([])
    expect(parseFileMetadataValidationIssues(null)).toEqual([])
  })
})
