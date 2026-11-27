import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef, type ShallowRef } from 'vue'

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }))

vi.mock('@/shared/composables/useToast', () => ({
  useToast: () => ({ showToast: showToastMock }),
}))

vi.mock('../../api/collectionApi', () => ({
  addMembers: vi.fn(),
  removeMembers: vi.fn(),
  reorderMembers: vi.fn(),
  updateCollection: vi.fn(),
  collectionErrorMessage: (err: any, fallback: string) => err?.message || fallback,
}))

import {
  addMembers,
  removeMembers,
  reorderMembers,
  updateCollection,
} from '../../api/collectionApi'
import { useCollectionMembers } from '../useCollectionMembers'
import type {
  CollectionApiError,
  CollectionDetail,
  CollectionMetadata,
} from '../../types/collection'
import { loadCoreMessages, loadFeatureMessages } from '@/i18n'

const addMembersMock = vi.mocked(addMembers)
const removeMembersMock = vi.mocked(removeMembers)
const reorderMembersMock = vi.mocked(reorderMembers)
const updateCollectionMock = vi.mocked(updateCollection)

/** 造 16 位 public_id：pid + 13 位数字补齐 */
const PID = (n: number) => `pid${String(n).padStart(13, '0')}`

/** 集合的 16 位 public_id（对外唯一标识） */
const CID = 'aB3xK9mQ2rT7wY1z'

/** 成员行没带的样本 / 采集元数据 */
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

type MemberMeta = Partial<Record<keyof typeof NO_METADATA, string>>

interface DetailOptions {
  /** 各成员携带的样本 / 采集元数据（按成员序号） */
  memberMeta?: Record<number, MemberMeta>
  /** 集合当前的汇总字段 */
  summary?: Partial<CollectionMetadata>
}

function makeDetail(ids: number[], options: DetailOptions = {}): CollectionDetail {
  return {
    name: 'X',
    title: null,
    description: null,
    memberCount: ids.length,
    totalSize: 0,
    ownerUsername: 'u',
    organism: [],
    createdAt: null,
    updatedAt: null,
    publicId: CID,
    doi: [],
    journalName: null,
    publishTime: null,
    access: [],
    organismPart: [],
    ionisationSource: [],
    metadata: { name: 'X', ...options.summary },
    members: ids.map((id) => ({
      publicId: PID(id),
      imagePath: null,
      filename: `f${id}.imzML`,
      size: 0,
      status: 'completed',
      isPublic: true,
      experimentType: 'imzML',
      ...NO_METADATA,
      ...options.memberMeta?.[id],
    })),
  }
}

function apiError(status: number, backendMessage: string): CollectionApiError {
  const e = new Error(backendMessage) as CollectionApiError
  e.status = status
  e.backendMessage = backendMessage
  return e
}

// 被测代码用 t() 取文案：预先加载英文语言包，断言保持英文原文
beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('collections')]))

describe('useCollectionMembers', () => {
  let detail: ShallowRef<CollectionDetail | null>
  let refresh: () => Promise<unknown>

  beforeEach(() => {
    showToastMock.mockReset()
    addMembersMock.mockReset()
    removeMembersMock.mockReset()
    reorderMembersMock.mockReset()
    updateCollectionMock.mockReset()
    detail = shallowRef<CollectionDetail | null>(makeDetail([1, 2, 3]))
    refresh = vi.fn(async () => undefined)
  })

  it('add writes back the returned detail and clears the reorder override', async () => {
    addMembersMock.mockResolvedValue(makeDetail([1, 2, 3, 4]))
    const ops = useCollectionMembers({ detail, refresh })

    await expect(ops.add([PID(4)])).resolves.toBe(true)

    expect(addMembersMock).toHaveBeenCalledWith(CID, [PID(4)])
    expect(ops.members.value.map((m) => m.publicId)).toEqual([1, 2, 3, 4].map(PID))
    expect(showToastMock).toHaveBeenCalledWith('Added', 'success')
  })

  it('add on 409 shows the backend message, refreshes, and reports failure', async () => {
    addMembersMock.mockRejectedValue(apiError(409, 'collection member limit exceeded'))
    const ops = useCollectionMembers({ detail, refresh })

    // 返回 false：调用方据此保持选集弹窗打开（选择仍在，便于重试）
    await expect(ops.add([PID(4)])).resolves.toBe(false)

    expect(showToastMock).toHaveBeenCalledWith('collection member limit exceeded', 'error')
    expect(refresh).toHaveBeenCalled()
    // 成员没有变化，也就没有汇总字段要确认
    expect(ops.summaryChanges.value).toEqual([])
  })

  it('remove reports the removed/skipped reconciliation and refreshes', async () => {
    removeMembersMock.mockResolvedValue({
      publicId: CID,
      removed: [PID(1), PID(2)],
      skipped: [PID(9)],
    })
    const ops = useCollectionMembers({ detail, refresh })

    await ops.remove([PID(1), PID(2), PID(9)])

    expect(removeMembersMock).toHaveBeenCalledWith(CID, [PID(1), PID(2), PID(9)])
    expect(showToastMock).toHaveBeenCalledWith(
      'Removed 2 · 1 were no longer in the collection',
      'success',
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('reorder optimistically reorders then writes back the full-rewrite response', async () => {
    reorderMembersMock.mockResolvedValue(makeDetail([3, 1, 2]))
    const ops = useCollectionMembers({ detail, refresh })

    await ops.reorder(2, 0)

    // 全量数组按乐观顺序提交
    expect(reorderMembersMock).toHaveBeenCalledWith(CID, [3, 1, 2].map(PID))
    expect(ops.members.value.map((m) => m.publicId)).toEqual([3, 1, 2].map(PID))
  })

  it('reorder 409 order conflict refreshes to the server order instead of keeping the optimistic one', async () => {
    reorderMembersMock.mockRejectedValue(apiError(409, 'collection member order conflict'))
    // refresh 模拟拉到服务端最新（成员已变：1 被移走）
    refresh = vi.fn(async () => {
      detail.value = makeDetail([2, 3])
    })
    const ops = useCollectionMembers({ detail, refresh })

    await ops.reorder(0, 2)

    expect(showToastMock).toHaveBeenCalledWith(
      'Members were changed elsewhere. Refreshed to the latest order.',
      'warning',
    )
    // 乐观顺序被服务端版本覆盖
    expect(ops.members.value.map((m) => m.publicId)).toEqual([2, 3].map(PID))
  })

  it('reorder network failure rolls back to the server version', async () => {
    reorderMembersMock.mockRejectedValue(new Error('network down'))
    const ops = useCollectionMembers({ detail, refresh })

    await ops.reorder(0, 2)

    expect(refresh).toHaveBeenCalled()
    expect(ops.members.value.map((m) => m.publicId)).toEqual([1, 2, 3].map(PID))
  })
})

// 后端不按成员汇总样本 / 采集字段：增删成员后由前端比对，用户确认后才提交
describe('summary fields after member changes', () => {
  let detail: ShallowRef<CollectionDetail | null>
  let refresh: () => Promise<unknown>

  beforeEach(() => {
    showToastMock.mockReset()
    addMembersMock.mockReset()
    removeMembersMock.mockReset()
    reorderMembersMock.mockReset()
    updateCollectionMock.mockReset()
    detail = shallowRef<CollectionDetail | null>(makeDetail([1, 2, 3]))
    refresh = vi.fn(async () => undefined)
  })

  /** 走到「新成员带来了新物种、等待确认」的状态 */
  async function addRat() {
    detail.value = makeDetail([1], {
      memberMeta: { 1: { organism: 'Mouse' } },
      summary: { organism: ['Mouse'] },
    })
    addMembersMock.mockResolvedValue(
      makeDetail([1, 2], {
        memberMeta: { 1: { organism: 'Mouse' }, 2: { organism: 'Rat' } },
        summary: { organism: ['Mouse'] },
      }),
    )
    const ops = useCollectionMembers({ detail, refresh })
    await ops.add([PID(2)])
    return ops
  }

  it('add proposes appending the values a new member brings', async () => {
    const ops = await addRat()

    expect(ops.summaryChanges.value).toEqual([
      { key: 'organism', before: ['Mouse'], after: ['Mouse', 'Rat'] },
    ])
    expect(updateCollectionMock).not.toHaveBeenCalled()
  })

  it('confirm submits only the changed fields and writes back the response', async () => {
    const ops = await addRat()
    updateCollectionMock.mockResolvedValue(
      makeDetail([1, 2], { summary: { organism: ['Mouse', 'Rat'] } }),
    )

    await ops.confirmSummaryUpdate()

    expect(updateCollectionMock).toHaveBeenCalledTimes(1)
    expect(updateCollectionMock).toHaveBeenCalledWith(CID, { organism: ['Mouse', 'Rat'] })
    expect(detail.value?.metadata.organism).toEqual(['Mouse', 'Rat'])
    expect(ops.summaryChanges.value).toEqual([])
    expect(showToastMock).toHaveBeenLastCalledWith(
      'Sample and acquisition fields updated from the current members.',
      'success',
    )
  })

  it('cancel keeps the current values and sends nothing', async () => {
    const ops = await addRat()

    ops.cancelSummaryUpdate()

    expect(ops.summaryChanges.value).toEqual([])
    expect(updateCollectionMock).not.toHaveBeenCalled()
  })

  it('keeps the confirmation open when the update fails, so it can be retried', async () => {
    const ops = await addRat()
    updateCollectionMock.mockRejectedValue(apiError(403, 'permission denied'))

    await ops.confirmSummaryUpdate()

    expect(ops.summaryChanges.value).toHaveLength(1)
    expect(ops.updatingSummary.value).toBe(false)
    expect(showToastMock).toHaveBeenLastCalledWith('permission denied', 'error')
  })

  it('remove proposes dropping the values that left with the removed member', async () => {
    const polarityOf = (negative: boolean) => ({ polarity: negative ? 'Negative' : 'Positive' })
    const summary = { polarity: ['Negative', 'Positive'] }
    detail.value = makeDetail([1, 2], {
      memberMeta: { 1: polarityOf(true), 2: polarityOf(false) },
      summary,
    })
    removeMembersMock.mockResolvedValue({ publicId: CID, removed: [PID(1)], skipped: [] })
    // 重拉后成员 1 已不在集合里
    refresh = vi.fn(async () => {
      detail.value = makeDetail([2], { memberMeta: { 2: polarityOf(false) }, summary })
    })
    const ops = useCollectionMembers({ detail, refresh })

    await ops.remove([PID(1)])

    expect(ops.summaryChanges.value).toEqual([
      { key: 'polarity', before: ['Negative', 'Positive'], after: ['Positive'] },
    ])
  })

  it('does not interrupt when the member change leaves every summary field alone', async () => {
    // 新成员没有填写任何样本 / 采集元数据
    const memberMeta = { 1: { organism: 'Mouse' } }
    const summary = { organism: ['Mouse'] }
    detail.value = makeDetail([1], { memberMeta, summary })
    addMembersMock.mockResolvedValue(makeDetail([1, 2], { memberMeta, summary }))
    const ops = useCollectionMembers({ detail, refresh })

    await ops.add([PID(2)])

    expect(ops.summaryChanges.value).toEqual([])
  })

  it('does not raise a difference that this member change did not cause', async () => {
    // 创建时物种被手改成「My own label」；新成员的物种与已有成员相同，推导值没变
    const memberMeta = { 1: { organism: 'Mouse' }, 2: { organism: 'Mouse' } }
    const summary = { organism: ['My own label'] }
    detail.value = makeDetail([1], { memberMeta, summary })
    addMembersMock.mockResolvedValue(makeDetail([1, 2], { memberMeta, summary }))
    const ops = useCollectionMembers({ detail, refresh })

    await ops.add([PID(2)])

    expect(ops.summaryChanges.value).toEqual([])
  })

  it('reorder never proposes a summary update', async () => {
    reorderMembersMock.mockResolvedValue(makeDetail([3, 1, 2]))
    const ops = useCollectionMembers({ detail, refresh })

    await ops.reorder(0, 2)

    expect(ops.summaryChanges.value).toEqual([])
  })
})
