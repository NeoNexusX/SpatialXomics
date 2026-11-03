import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { buildOverviewShareUrl, isValidPublicId } from '../overviewShareLink'

// 只复刻分享链接用到的那条路由（与 router/index.ts 的 '/s/:shareToken' 一致），
// 避免为一个纯函数拉起整个应用路由表。
const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/s/:shareToken', name: 'SharedDatasetOverview', component: { template: '<div/>' } },
  ],
})

describe('isValidPublicId', () => {
  it('accepts exactly 16 alphanumeric chars', () => {
    expect(isValidPublicId('aBcDeFgHiJkLmNoP')).toBe(true)
    expect(isValidPublicId('0123456789abcdef')).toBe(true)
  })

  it('rejects wrong length, symbols, and non-strings', () => {
    for (const bad of ['', 'aBcDeFgHiJkLmNo', 'aBcDeFgHiJkLmNoPQ', 'aBcDeFgHiJkLmNo-', 42, null]) {
      expect(isValidPublicId(bad)).toBe(false)
    }
  })
})

describe('buildOverviewShareUrl', () => {
  it('builds an absolute /s/<publicId> link on the current origin', () => {
    expect(buildOverviewShareUrl(router, 'aBcDeFgHiJkLmNoP', 'https://massvision.example')).toBe(
      'https://massvision.example/s/aBcDeFgHiJkLmNoP',
    )
  })

  it('returns null for a value that is not a 16-char public id', () => {
    expect(buildOverviewShareUrl(router, '42', 'https://massvision.example')).toBeNull()
    expect(
      buildOverviewShareUrl(router, 'not-a-public-id', 'https://massvision.example'),
    ).toBeNull()
  })
})
