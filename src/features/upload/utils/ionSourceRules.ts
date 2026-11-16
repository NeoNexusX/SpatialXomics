/**
 * Ion source normalization and dynamic field rule resolution for the upload form.
 *
 * 家族定义原先在 `public/config.json` 的 `ionSourceFieldRules`，现随代码走 —— 理由同
 * `datasetMetadata.ts`：这是学科规则而非部署差异，且新增一个家族本就要同步维护
 * `ION_SOURCES`，两者放在一起才不容易改漏。
 *
 * FAMILIES 按数组顺序匹配、先命中先生效，因此 'maldi' 这类宽泛关键词必须排在
 * 'ap-maldi' / 'ap-smaldi' / 'maldi-2' 之后，否则会把它们提前吃掉。
 */

/** 单个字段的规则片段（是否必填及展示文案） */
interface IonSourceFieldRule {
  required: boolean
  label: string
  placeholder?: string
}

/** 一个离子源家族的匹配规则；未声明的字段沿用 DEFAULTS */
interface IonSourceFamily {
  /** 家族标识，如 'maldi'、'desi' */
  key: string
  /** 归一化后用于匹配的关键词，命中任一即属于该家族 */
  match: string[]
  solvent?: Partial<IonSourceFieldRule>
  maldiMatrix?: Partial<IonSourceFieldRule>
  maldiMatrixApplication?: Partial<IonSourceFieldRule>
}

/** 三个动态字段的默认规则：都不必填 */
const DEFAULTS: {
  solvent: IonSourceFieldRule
  maldiMatrix: IonSourceFieldRule
  maldiMatrixApplication: IonSourceFieldRule
} = {
  solvent: {
    required: false,
    label: 'Solvent',
    placeholder: 'e.g. 70% ACN / 30% H2O / 0.1% TFA',
  },
  maldiMatrix: {
    required: false,
    label: 'MALDI Matrix',
  },
  maldiMatrixApplication: {
    required: false,
    label: 'MALDI Matrix Application',
  },
}

const FAMILIES: IonSourceFamily[] = [
  {
    key: 'ir-maldesi',
    match: ['ir-maldesi', 'maldesi'],
    solvent: {
      required: true,
      label: 'Solvent',
      placeholder: 'e.g. 50% MeOH / 50% H2O',
    },
  },
  {
    key: 'nano-desi',
    match: ['nano-desi', 'nanodesi'],
    solvent: {
      required: true,
      label: 'Solvent',
      placeholder: 'e.g. MeOH / H2O',
    },
  },
  {
    key: 'desi',
    match: ['desi'],
    solvent: {
      required: true,
      label: 'Solvent',
      placeholder: 'e.g. 95% MeOH / 5% H2O',
    },
  },
  {
    key: 'ap-smaldi',
    match: ['ap-smaldi', 'smaldi'],
    solvent: {
      required: true,
      label: 'Solvent',
      placeholder: 'e.g. 70% ACN / 30% H2O / 0.1% TFA',
    },
    maldiMatrix: {
      required: true,
    },
    maldiMatrixApplication: {
      required: true,
    },
  },
  {
    key: 'ap-maldi',
    match: ['ap-maldi'],
    solvent: {
      required: true,
      label: 'Solvent',
      placeholder: 'e.g. 70% ACN / 30% H2O / 0.1% TFA',
    },
    maldiMatrix: {
      required: true,
    },
    maldiMatrixApplication: {
      required: true,
    },
  },
  {
    key: 'maldi-2',
    match: ['maldi-2', 'maldi2'],
    solvent: {
      required: true,
      label: 'Solvent',
      placeholder: 'e.g. 70% ACN / 30% H2O / 0.1% TFA',
    },
    maldiMatrix: {
      required: true,
    },
    maldiMatrixApplication: {
      required: true,
    },
  },
  {
    key: 'maldi',
    match: ['maldi'],
    solvent: {
      required: true,
      label: 'Solvent',
      placeholder: 'e.g. 70% ACN / 30% H2O / 0.1% TFA',
    },
    maldiMatrix: {
      required: true,
    },
    maldiMatrixApplication: {
      required: true,
    },
  },
  {
    key: 'laesi',
    match: ['laesi'],
  },
  {
    key: 'sims',
    match: ['sims'],
  },
  {
    key: 'saldi',
    match: ['saldi'],
  },
  {
    key: 'ldi',
    match: ['ldi'],
  },
]

function normalize(value?: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[–—_]+/g, '-')
    .replace(/\s+/g, '-')
}

function resolveKey(ionSource: string): string {
  const source = normalize(ionSource)
  if (!source || source === 'other') return 'unknown'

  for (const family of FAMILIES) {
    if (family.match.some((p) => source.includes(p))) {
      return family.key
    }
  }

  return 'unknown'
}

export function getIonSourceFieldRules(ionSource: string) {
  const key = resolveKey(ionSource)
  const family = FAMILIES.find((f) => f.key === key)

  return {
    solvent: {
      ...DEFAULTS.solvent,
      ...(family?.solvent ?? {}),
    },
    maldiMatrix: {
      ...DEFAULTS.maldiMatrix,
      ...(family?.maldiMatrix ?? {}),
    },
    maldiMatrixApplication: {
      ...DEFAULTS.maldiMatrixApplication,
      ...(family?.maldiMatrixApplication ?? {}),
    },
  }
}
