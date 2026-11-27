import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }))

vi.mock('@/shared/composables/useToast', () => ({
  useToast: () => ({ showToast: showToastMock }),
}))

// 路由与数据集列表在这里只是装配依赖：本用例不搜索、不翻页，也不需要离开守卫
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  onBeforeRouteLeave: vi.fn(),
}))

vi.mock('@/features/datasets/api/datasetApi', () => ({ listFiles: vi.fn() }))

vi.mock('@/features/datasets/composables/useDatasetList', () => ({
  useDatasetList: () => ({
    datasets: { value: [] },
    loading: { value: false },
    error: { value: '' },
    meta: { value: { current_page: 1, total_pages: 1, total_records: 0 } },
    size: { value: 10 },
    pagination: { value: [] },
    fetchFiles: vi.fn(async () => {}),
    applyFilters: vi.fn(),
    goToPage: vi.fn(),
    changeSize: vi.fn(),
  }),
}))

vi.mock('../../api/collectionApi', () => ({
  createCollection: vi.fn(),
  collectionErrorMessage: (err: unknown, fallback: string) =>
    (err as Error | undefined)?.message || fallback,
}))

import { useCreateCollection } from '../useCreateCollection'
import { COLLECTION_MEMBER_LIMIT } from '../../constants/collectionLimits'
import type { File } from '@/features/datasets/types/dataset'
import { loadCoreMessages, loadFeatureMessages } from '@/i18n'

const fileAt = (i: number): File =>
  ({ publicId: `pid${String(i).padStart(13, '0')}`, status: 'completed' }) as File

// 被测代码用 t() 取文案：预先加载英文语言包，断言保持英文原文
beforeAll(() => Promise.all([loadCoreMessages('en'), loadFeatureMessages('collections')]))

describe('useCreateCollection', () => {
  beforeEach(() => {
    showToastMock.mockReset()
  })

  // 创建接口的 file_public_ids ≤ 300（后端写入校验）：选满后不再追加，并提示上限
  it('caps the selection at the backend member limit and explains why', () => {
    const { selected, toggle } = useCreateCollection()
    const files = Array.from({ length: COLLECTION_MEMBER_LIMIT + 1 }, (_, i) => fileAt(i))

    for (const file of files.slice(0, COLLECTION_MEMBER_LIMIT)) toggle(file)
    expect(selected.value).toHaveLength(COLLECTION_MEMBER_LIMIT)
    expect(showToastMock).not.toHaveBeenCalled()

    toggle(files[COLLECTION_MEMBER_LIMIT]!)
    expect(selected.value).toHaveLength(COLLECTION_MEMBER_LIMIT)
    expect(showToastMock).toHaveBeenCalledWith(
      'A collection can hold at most 300 datasets.',
      'error',
    )

    // 取消选中不受上限影响：腾出名额后再追加即可成功
    toggle(files[0]!)
    expect(selected.value).toHaveLength(COLLECTION_MEMBER_LIMIT - 1)
    toggle(files[COLLECTION_MEMBER_LIMIT]!)
    expect(selected.value).toHaveLength(COLLECTION_MEMBER_LIMIT)
  })
})
