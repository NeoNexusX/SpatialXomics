import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useOrderedSelection } from '../useOrderedSelection'

interface Stub {
  publicId: string
  label: string
}

describe('useOrderedSelection', () => {
  it('appends on toggle in selection order and removes when already selected', () => {
    const { selected, isSelected, toggle } = useOrderedSelection<Stub>()

    toggle({ publicId: 'aB3xK9mQ2rT7wY1a', label: 'a' })
    toggle({ publicId: 'aB3xK9mQ2rT7wY1b', label: 'b' })
    toggle({ publicId: 'aB3xK9mQ2rT7wY1c', label: 'c' })
    expect(selected.value.map((d) => d.publicId)).toEqual([
      'aB3xK9mQ2rT7wY1a',
      'aB3xK9mQ2rT7wY1b',
      'aB3xK9mQ2rT7wY1c',
    ])

    toggle({ publicId: 'aB3xK9mQ2rT7wY1b', label: 'b' })
    expect(selected.value.map((d) => d.publicId)).toEqual(['aB3xK9mQ2rT7wY1a', 'aB3xK9mQ2rT7wY1c'])
    expect(isSelected('aB3xK9mQ2rT7wY1b')).toBe(false)
  })

  it('move implements splice semantics and ignores out-of-range/no-op indices', () => {
    const { selected, toggle, move } = useOrderedSelection<Stub>()
    const items: Stub[] = [
      { publicId: 'aB3xK9mQ2rT7wY1a', label: '1' },
      { publicId: 'aB3xK9mQ2rT7wY1b', label: '2' },
      { publicId: 'aB3xK9mQ2rT7wY1c', label: '3' },
    ]
    items.forEach(toggle)

    move(0, 2)
    expect(selected.value.map((d) => d.publicId)).toEqual([
      'aB3xK9mQ2rT7wY1b',
      'aB3xK9mQ2rT7wY1c',
      'aB3xK9mQ2rT7wY1a',
    ])

    move(1, 1)
    expect(selected.value.map((d) => d.publicId)).toEqual([
      'aB3xK9mQ2rT7wY1b',
      'aB3xK9mQ2rT7wY1c',
      'aB3xK9mQ2rT7wY1a',
    ])

    move(-1, 0)
    move(0, 99)
    expect(selected.value.map((d) => d.publicId)).toEqual([
      'aB3xK9mQ2rT7wY1b',
      'aB3xK9mQ2rT7wY1c',
      'aB3xK9mQ2rT7wY1a',
    ])
  })

  it('moveUp/moveDown clamp by no-op at the edges', () => {
    const { selected, toggle, moveUp, moveDown } = useOrderedSelection<Stub>()
    ;[
      { publicId: 'aB3xK9mQ2rT7wY1a', label: '1' },
      { publicId: 'aB3xK9mQ2rT7wY1b', label: '2' },
    ].forEach(toggle)

    moveUp(0)
    expect(selected.value.map((d) => d.publicId)).toEqual(['aB3xK9mQ2rT7wY1a', 'aB3xK9mQ2rT7wY1b'])
    moveDown(1)
    expect(selected.value.map((d) => d.publicId)).toEqual(['aB3xK9mQ2rT7wY1a', 'aB3xK9mQ2rT7wY1b'])
    moveDown(0)
    expect(selected.value.map((d) => d.publicId)).toEqual(['aB3xK9mQ2rT7wY1b', 'aB3xK9mQ2rT7wY1a'])
  })

  it('removeById drops the matching public id', () => {
    const { selected, toggle, removeById } = useOrderedSelection<Stub>()
    toggle({ publicId: 'aB3xK9mQ2rT7wY1a', label: 'a' })
    toggle({ publicId: 'aB3xK9mQ2rT7wY1b', label: 'b' })

    removeById('aB3xK9mQ2rT7wY1a')
    expect(selected.value.map((d) => d.publicId)).toEqual(['aB3xK9mQ2rT7wY1b'])
  })

  it('clear empties the selection', () => {
    const { selected, toggle, clear } = useOrderedSelection<Stub>()
    toggle({ publicId: 'aB3xK9mQ2rT7wY1a', label: 'a' })
    clear()
    expect(selected.value).toEqual([])
  })

  it('starts from the initial items', () => {
    const { selected } = useOrderedSelection<Stub>([{ publicId: 'aB3xK9mQ2rT7wY1z', label: 'x' }])
    expect(selected.value).toEqual([{ publicId: 'aB3xK9mQ2rT7wY1z', label: 'x' }])
  })

  // 集合成员上限：达到后追加被拒绝，取消选中不受影响；返回 false 供调用方提示
  describe('max', () => {
    const stub = (id: string): Stub => ({ publicId: id, label: id })

    it('rejects appends beyond the max and reports it, while removal still works', () => {
      const { selected, toggle } = useOrderedSelection<Stub>([], { max: 2 })

      expect(toggle(stub('aB3xK9mQ2rT7wY1a'))).toBe(true)
      expect(toggle(stub('aB3xK9mQ2rT7wY1b'))).toBe(true)
      expect(toggle(stub('aB3xK9mQ2rT7wY1c'))).toBe(false)
      expect(selected.value.map((d) => d.publicId)).toEqual([
        'aB3xK9mQ2rT7wY1a',
        'aB3xK9mQ2rT7wY1b',
      ])

      // 已达上限时取消选中照常生效
      expect(toggle(stub('aB3xK9mQ2rT7wY1a'))).toBe(true)
      expect(selected.value.map((d) => d.publicId)).toEqual(['aB3xK9mQ2rT7wY1b'])
      expect(toggle(stub('aB3xK9mQ2rT7wY1c'))).toBe(true)
    })

    it('evaluates a getter on every toggle, so the remaining quota can shrink', () => {
      // 如「300 − 集合现有成员数」：名额被现有成员占掉后不能再追加
      const limit = ref(2)
      const { selected, toggle } = useOrderedSelection<Stub>([], { max: () => limit.value })

      toggle(stub('aB3xK9mQ2rT7wY1a'))
      limit.value = 1
      expect(toggle(stub('aB3xK9mQ2rT7wY1b'))).toBe(false)
      expect(selected.value).toHaveLength(1)
    })

    it('does not limit when max is not set', () => {
      const { toggle } = useOrderedSelection<Stub>()
      expect(toggle(stub('aB3xK9mQ2rT7wY1a'))).toBe(true)
      expect(toggle(stub('aB3xK9mQ2rT7wY1b'))).toBe(true)
    })
  })
})
