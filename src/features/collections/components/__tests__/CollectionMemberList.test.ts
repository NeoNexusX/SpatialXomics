import { beforeAll, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import CollectionMemberList from '../CollectionMemberList.vue'
import type { CollectionMember } from '../../types/collection'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'

// 成员行没带的样本 / 采集元数据一律归一成 null；成员列表只用 publicId / filename / imagePath
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

const members = (n: number): CollectionMember[] =>
  Array.from({ length: n }, (_, i) => ({
    publicId: `pub-${i}`,
    imagePath: `images/file_${i}/`,
    filename: `file-${i}.imzML`,
    size: 1024,
    status: 'completed',
    isPublic: true,
    experimentType: 'MALDI',
    ...NO_METADATA,
  }))

const mountList = (props: Record<string, unknown> = {}) =>
  mount(CollectionMemberList, {
    props: { members: members(2), ...props },
    global: { plugins: [i18n], stubs: { SvgIcon: true, DatasetThumb: true } },
  })

// 调序控件（手柄 .cursor-grab / 上移下移 .btn-square）按 manageMode × editMode 门控；
// 复选框只跟 manageMode。按钮文案走 i18n，这里用结构性选择器断言，不绑具体 locale 文本
beforeAll(() =>
  Promise.all([loadCoreMessages('en'), loadFeatureMessages('collections')]),
)

describe('CollectionMemberList 调序控件门控', () => {
  it('manageMode 下浏览态（未开 Edit）不显示调序控件，但显示多选框', () => {
    const w = mountList({ manageMode: true, editMode: false })
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(2)
    expect(w.findAll('.cursor-grab')).toHaveLength(0)
    expect(w.findAll('.btn-square')).toHaveLength(0)
  })

  it('manageMode + editMode（页头 Edit 进入编辑态）显示手柄与上移/下移', () => {
    const w = mountList({ manageMode: true, editMode: true })
    expect(w.findAll('.cursor-grab')).toHaveLength(2)
    expect(w.findAll('.btn-square')).toHaveLength(4)
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(2)
  })

  it('只读模式（公开页/非 owner）无任何管理控件', () => {
    const w = mountList({ manageMode: false, editMode: false })
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(w.findAll('.cursor-grab')).toHaveLength(0)
    expect(w.findAll('.btn-square')).toHaveLength(0)
  })
})
