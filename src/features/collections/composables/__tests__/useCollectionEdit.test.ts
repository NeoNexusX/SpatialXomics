import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef, type ShallowRef } from 'vue'

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }))

vi.mock('@/shared/composables/useToast', () => ({
  useToast: () => ({ showToast: showToastMock }),
}))

vi.mock('../../api/collectionApi', () => ({
  updateCollection: vi.fn(),
  collectionErrorMessage: (err: any, fallback: string) => err?.message || fallback,
}))

import { updateCollection } from '../../api/collectionApi'
import { useCollectionEdit } from '../useCollectionEdit'
import type { CollectionDetail } from '../../types/collection'
import { loadCoreMessages, loadFeatureMessages } from '@/i18n'

const updateMock = vi.mocked(updateCollection)

function makeDetail(): CollectionDetail {
  return {
    name: 'Kidney Atlas',
    title: 'MD',
    description: 'desc',
    memberCount: 0,
    totalSize: 0,
    ownerUsername: 'u',
    organism: [],
    createdAt: null,
    updatedAt: null,
    publicId: 'aB3xK9mQ2rT7wY1z',
    doi: [],
    journalName: null,
    publishTime: null,
    access: [],
    organismPart: [],
    ionisationSource: [],
    // metadata 里的 name 是旧值：基线应以顶层 name 为准
    metadata: { name: 'stale', description: 'desc', doi: ['10.1/x'] },
    members: [],
  }
}

// 被测代码用 t() 取文案：预先加载英文语言包，断言保持英文原文
beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('collections')]))

describe('useCollectionEdit', () => {
  let detail: ShallowRef<CollectionDetail | null>
  let saved: CollectionDetail[]
  let edit: ReturnType<typeof useCollectionEdit>

  beforeEach(() => {
    showToastMock.mockReset()
    updateMock.mockReset()
    detail = shallowRef(makeDetail())
    saved = []
    edit = useCollectionEdit({ detail, onSaved: (d) => saved.push(d) })
  })

  it('start 用顶层 name/description 初始化草稿，cancel 丢弃它', () => {
    edit.start()
    expect(edit.editing.value).toBe(true)
    expect(edit.draft.value?.name).toBe('Kidney Atlas')
    expect(edit.draft.value?.doi).toEqual(['10.1/x'])
    expect(edit.isDirty.value).toBe(false)

    edit.cancel()
    expect(edit.editing.value).toBe(false)
    expect(edit.draft.value).toBeNull()
  })

  it('只有真正改动过才算脏（改回原值重新变干净）', () => {
    edit.start()
    edit.draft.value!.name = 'Renamed'
    expect(edit.isDirty.value).toBe(true)

    edit.draft.value!.name = 'Kidney Atlas'
    expect(edit.isDirty.value).toBe(false)
  })

  it('save 只提交差量，成功后回写详情并退出编辑态', async () => {
    const updated = { ...makeDetail(), name: 'Renamed' }
    updateMock.mockResolvedValue(updated as any)

    edit.start()
    edit.draft.value!.name = 'Renamed'
    await edit.save()

    expect(updateMock).toHaveBeenCalledWith('aB3xK9mQ2rT7wY1z', { name: 'Renamed' })
    expect(saved).toEqual([updated])
    expect(edit.editing.value).toBe(false)
    expect(edit.draft.value).toBeNull()
    expect(showToastMock).toHaveBeenCalledWith('Updated', 'success')
  })

  it('name 为空时不发请求，留在页面上给出校验提示', async () => {
    edit.start()
    edit.draft.value!.name = '   '
    await edit.save()

    expect(updateMock).not.toHaveBeenCalled()
    expect(edit.validationError.value).toBe('Name is required.')
    expect(edit.editing.value).toBe(true)
  })

  // 上限与后端写入校验一致（128），文案带上限值
  it('名称超过字段表上限时不发请求，提示里带上限值', async () => {
    edit.start()
    edit.draft.value!.name = 'x'.repeat(129)
    await edit.save()

    expect(updateMock).not.toHaveBeenCalled()
    expect(edit.validationError.value).toBe('Name must be at most 128 characters.')
    expect(edit.editing.value).toBe(true)
  })

  it('名称恰好等于上限时正常保存', async () => {
    updateMock.mockResolvedValue(makeDetail())
    const atLimit = 'x'.repeat(128)

    edit.start()
    edit.draft.value!.name = atLimit
    await edit.save()

    expect(updateMock).toHaveBeenCalledWith('aB3xK9mQ2rT7wY1z', { name: atLimit })
    expect(edit.validationError.value).toBe('')
  })

  // 简介上限同样取自字段表（512），文案带上限值
  it('简介超过字段表上限时不发请求，提示里带上限值', async () => {
    edit.start()
    edit.draft.value!.description = 'd'.repeat(513)
    await edit.save()

    expect(updateMock).not.toHaveBeenCalled()
    expect(edit.validationError.value).toBe('Description must be at most 512 characters.')
    expect(edit.editing.value).toBe(true)
  })

  it('简介恰好等于上限时正常保存', async () => {
    updateMock.mockResolvedValue(makeDetail())
    const atLimit = 'd'.repeat(512)

    edit.start()
    edit.draft.value!.description = atLimit
    await edit.save()

    expect(updateMock).toHaveBeenCalledWith('aB3xK9mQ2rT7wY1z', { description: atLimit })
    expect(edit.validationError.value).toBe('')
  })

  // 回归：清空日期时曾发出 ""，后端当成非法日期返回 422（实测 "input is too short"）
  it('清空发表时间时发送 null 而不是空串', async () => {
    updateMock.mockResolvedValue(makeDetail())
    detail.value = {
      ...makeDetail(),
      publishTime: '2024-05-01',
      metadata: { name: 'Kidney Atlas', publish_time: '2024-05-01' },
    }

    edit.start()
    expect(edit.draft.value!.publish_time).toBe('2024-05-01')
    edit.draft.value!.publish_time = ''
    await edit.save()

    expect(updateMock).toHaveBeenCalledWith('aB3xK9mQ2rT7wY1z', { publish_time: null })
    expect(edit.editing.value).toBe(false)
  })

  it('保存失败留在编辑态，草稿不丢可重试', async () => {
    updateMock.mockRejectedValue(new Error('boom'))

    edit.start()
    edit.draft.value!.name = 'Renamed'
    await edit.save()

    expect(edit.editing.value).toBe(true)
    expect(edit.draft.value?.name).toBe('Renamed')
    expect(showToastMock).toHaveBeenCalledWith('boom', 'error')
  })
})
