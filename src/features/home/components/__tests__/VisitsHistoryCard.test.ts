import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { i18n, loadCoreMessages, loadFeatureMessages } from '@/i18n'
import { getVisitsHistory } from '../../api/statsApi'
import type { VisitsHistoryStats } from '../../types/stats'
import VisitsHistoryCard from '../VisitsHistoryCard.vue'

vi.mock('../../api/statsApi', () => ({ getVisitsHistory: vi.fn() }))
const get = vi.mocked(getVisitsHistory)
enableAutoUnmount(afterEach)
beforeAll(async () => {
  i18n.global.locale.value = 'zh-CN'
  await Promise.all([loadCoreMessages('zh-CN'), loadFeatureMessages('home')])
})
beforeEach(() => get.mockReset())

function response(): VisitsHistoryStats {
  const items = Array.from({ length: 90 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 10, 18 - 90 + index)).toISOString().slice(0, 10),
    count: index === 89 ? 60 : 0,
    missing: index < 88,
    is_partial: index === 89,
  }))
  return {
    timezone: 'UTC',
    start_date: items[0]!.date,
    end_date: '2026-11-17',
    days: 90,
    range_total: 60,
    missing_days: 88,
    items,
  }
}
const render = () => mount(VisitsHistoryCard, { global: { plugins: [i18n] } })

describe('visit history card', () => {
  it('distinguishes missing data, observed zero and the partial UTC day', async () => {
    get.mockResolvedValue(response())
    const wrapper = render()
    await flushPromises()
    const rows = wrapper.findAll('tbody tr').slice(-3)
    expect(rows[0]!.text()).toContain('2026-11-15 UTC')
    expect(rows[0]!.text()).toContain('数据缺失，不代表零访问')
    expect(rows[1]!.get('td').text()).toBe('0')
    expect(rows[2]!.get('td').text()).toContain('今日截至当前')
    expect(wrapper.get('strong').text()).toBe('60')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.get('footer').text()).toBe('今日截至当前 · UTC')
  })

  it('shows a recoverable unavailable state on 503 without a zero total or chart', async () => {
    get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 503 } })
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('统计暂不可用')
    expect(wrapper.get('strong').text()).toBe('—')
    expect(wrapper.find('table').exists()).toBe(false)

    get.mockResolvedValueOnce(response())
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('strong').text()).toBe('60')
  })

  it('does not describe an entirely missing interval as zero requests', async () => {
    const data = response()
    data.items = data.items.map((day) => ({ ...day, count: 0, missing: true }))
    data.range_total = 0
    data.missing_days = data.days
    get.mockResolvedValueOnce(data)
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('strong').text()).toBe('—')
    expect(wrapper.text()).toContain('该时段暂无已采集数据')
    expect(wrapper.get('footer').text()).not.toContain('天数据缺失')
  })
})
