import { describe, expect, it } from 'vitest'
import { getRegionName, getRegionOptions } from '../regionOptions'

describe('regionOptions', () => {
  it('shows Taiwan without the "Province of China" suffix', () => {
    const options = getRegionOptions()

    expect(options.Taiwan).toBe('TW')
    expect(Object.keys(options)).not.toContain('Taiwan, Province of China')
  })

  // 显示名可以改，但下拉值始终是 ISO 代码，后端收到的仍是 TW
  it('keeps TW as the option value and resolves it back to the display name', () => {
    expect(getRegionOptions().Taiwan).toBe('TW')
    expect(getRegionName('TW')).toBe('Taiwan')
  })
})
