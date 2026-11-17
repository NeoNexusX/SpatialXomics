import {
  ANALYZERS,
  CONDITIONS,
  ION_SOURCES,
  MALDI_MATRICES,
  MALDI_MATRIX_APPLICATIONS,
  ORGANISMS,
  ORGANISM_PARTS,
  POLARITIES,
  SAMPLE_GROWTH_CONDITIONS,
  SAMPLE_STABILIZATIONS,
  TISSUE_MODIFICATIONS,
} from '@/features/datasets/constants/datasetMetadata'
import { t } from '@/i18n'
import type { FileMetadataTextKey, FileMetadataNumberKey } from '../utils/fileMetadataPatch'

export const getMetadataTextFields = (): {
  key: FileMetadataTextKey
  label: string
  suggestions: readonly string[]
}[] => [
  { key: 'organism', label: t('common.meta.organism'), suggestions: ORGANISMS },
  { key: 'organism_part', label: t('common.meta.organismPart'), suggestions: ORGANISM_PARTS },
  { key: 'condition', label: t('common.meta.condition'), suggestions: CONDITIONS },
  {
    key: 'sample_growth_conditions',
    label: t('common.meta.growthConditions'),
    suggestions: SAMPLE_GROWTH_CONDITIONS,
  },
  {
    key: 'sample_stabilization',
    label: t('datasets.field.stabilization'),
    suggestions: SAMPLE_STABILIZATIONS,
  },
  {
    key: 'tissue_modification',
    label: t('common.meta.tissueModification'),
    suggestions: TISSUE_MODIFICATIONS,
  },
  { key: 'maldi_matrix', label: t('common.meta.maldiMatrix'), suggestions: MALDI_MATRICES },
  {
    key: 'maldi_matrix_application',
    label: t('datasets.field.matrixApplication'),
    suggestions: MALDI_MATRIX_APPLICATIONS,
  },
]

export const getMetadataInstrumentFields = () =>
  [
    { key: 'polarity', label: t('common.meta.polarity'), suggestions: [...POLARITIES, 'Other'] },
    {
      key: 'ionisation_source',
      label: t('common.meta.ionisationSource'),
      suggestions: ION_SOURCES,
    },
    { key: 'analyzer', label: t('common.meta.analyzer'), suggestions: ANALYZERS },
  ] satisfies { key: FileMetadataTextKey; label: string; suggestions: readonly string[] }[]

export const getMetadataNumberFields = () =>
  [
    { key: 'pixel_size_horizontal', label: t('upload.form.pixelSizeX'), example: 50 },
    { key: 'pixel_size_vertical', label: t('upload.form.pixelSizeY'), example: 50 },
    { key: 'mz', label: 'm/z', example: 200 },
    { key: 'resolving_power', label: t('common.meta.resolvingPower'), example: 140000 },
  ] satisfies { key: FileMetadataNumberKey; label: string; example: number }[]
