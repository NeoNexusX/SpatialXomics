import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref, type Ref } from 'vue'

const { getPublicCollectionMock } = vi.hoisted(() => ({ getPublicCollectionMock: vi.fn() }))

vi.mock('../../api/collectionApi', () => ({ getPublicCollection: getPublicCollectionMock }))

import { useCollectionCovers } from '../useCollectionCovers'
import type { CollectionSummary } from '../../types/collection'

/** 造 16 位 public_id：pid + 13 位数字补齐，每个 n 对应唯一集合 */
const PID = (n: number) => `pid${String(n).padStart(13, '0')}`

const summary = (over: Partial<CollectionSummary>): CollectionSummary =>
  ({
    name: 'X',
    title: null,
    description: null,
    memberCount: 0,
    totalSize: 0,
    ownerUsername: 'u',
    organism: [],
    createdAt: null,
    updatedAt: null,
    publicId: '',
    doi: [],
    journalName: null,
    access: null,
    organismPart: [],
    ionisationSource: [],
    ...over,
  }) as CollectionSummary

const detailWith = (imagePaths: (string | null)[]) => ({
  members: imagePaths.map((imagePath, i) => ({
    publicId: `pub${i}abcdefghijk`,
    imagePath,
    filename: `f${i}.imzML`,
    size: 0,
    status: 'completed',
    isPublic: true,
    experimentType: 'imzML',
    // 成员行没带的样本 / 采集元数据（封面只用到 imagePath）
    organism: null,
    organismPart: null,
    sampleStabilization: null,
    sampleGrowthConditions: null,
    tissueModification: null,
    polarity: null,
    ionSource: null,
    analyzer: null,
  })),
})

function setup(initial: CollectionSummary[]) {
  const collections: Ref<CollectionSummary[]> = ref(initial)
  return { collections, ...useCollectionCovers(collections) }
}

describe('useCollectionCovers', () => {
  beforeEach(() => {
    getPublicCollectionMock.mockReset()
  })

  it('fetches members via the row public id and exposes ordered imagePaths', async () => {
    getPublicCollectionMock.mockResolvedValueOnce(detailWith(['images/file_42/', 'images/file_7/']))

    const { memberImagePaths } = setup([summary({ publicId: PID(1) })])
    await flushPromises()

    expect(getPublicCollectionMock).toHaveBeenCalledWith(PID(1))
    expect(memberImagePaths[PID(1)]).toEqual(['images/file_42/', 'images/file_7/'])
  })

  // 预览未生成的成员保留 null 槽位，由卡片/DatasetThumb 走占位图
  it('keeps null entries for members whose preview is not generated', async () => {
    getPublicCollectionMock.mockResolvedValueOnce(detailWith(['images/file_1/', null]))

    const { memberImagePaths } = setup([summary({ publicId: PID(2) })])
    await flushPromises()

    expect(memberImagePaths[PID(2)]).toEqual(['images/file_1/', null])
  })

  // 同一集合只请求一次：列表重渲染 / 重新赋值不应再打接口
  it('requests each collection at most once', async () => {
    getPublicCollectionMock.mockResolvedValue(detailWith(['images/file_1/']))
    const { collections, memberImagePaths } = setup([summary({ publicId: PID(1) })])
    await flushPromises()

    collections.value = [summary({ publicId: PID(1) })]
    await flushPromises()

    expect(getPublicCollectionMock).toHaveBeenCalledTimes(1)
    expect(memberImagePaths[PID(1)]).toEqual(['images/file_1/'])
  })

  // 后端将来若在列表里直接带上 members，就不该再发详情请求
  it('uses members already present on the list row without fetching', async () => {
    const { memberImagePaths } = setup([
      summary({ publicId: PID(9), members: detailWith(['images/file_5/']).members }),
    ])
    await flushPromises()

    expect(getPublicCollectionMock).not.toHaveBeenCalled()
    expect(memberImagePaths[PID(9)]).toEqual(['images/file_5/'])
  })

  it('skips fetching when the row carries no public id', async () => {
    const { memberImagePaths } = setup([summary({ publicId: '' })])
    await flushPromises()

    expect(getPublicCollectionMock).not.toHaveBeenCalled()
    // 无键可查：留空让卡片回退占位图
    expect(memberImagePaths['']).toEqual([])
  })

  it('falls back to an empty list when the detail request fails', async () => {
    getPublicCollectionMock.mockRejectedValueOnce(new Error('boom'))

    const { memberImagePaths } = setup([summary({ publicId: PID(3) })])
    await flushPromises()

    expect(memberImagePaths[PID(3)]).toEqual([])
  })
})
