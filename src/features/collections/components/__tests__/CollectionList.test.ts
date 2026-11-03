import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import CollectionList from '../CollectionList.vue'
import CollectionCard from '../CollectionCard.vue'
import type { CollectionSummary } from '../../types/collection'

const collection = (publicId: string, ownerUsername: string) =>
  ({ publicId, ownerUsername }) as CollectionSummary

describe('CollectionList', () => {
  it('tells each card whether it belongs to the current user', () => {
    const wrapper = shallowMount(CollectionList, {
      props: {
        collections: [collection('mine', 'me'), collection('theirs', 'other')],
        loading: false,
        error: '',
        meta: { current_page: 1, total_pages: 1, total_records: 2, current_records: 2 },
        size: 10,
        pagination: [1],
        searchApplied: '',
        canEdit: () => false,
        isMine: (c: CollectionSummary) => c.ownerUsername === 'me',
      },
      global: {
        mocks: { $t: (key: string) => key },
        stubs: { PaginationFooter: { template: '<div />' } },
      },
    })
    const cards = wrapper.findAllComponents(CollectionCard)
    expect(cards.map((card) => card.props('isMine'))).toEqual([true, false])
  })
})
