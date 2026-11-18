import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { i18n, loadFeatureMessages } from '@/i18n'
import type { VisitsHistoryDay } from '../../types/stats'
import VisitsHistoryChart from '../VisitsHistoryChart.vue'

const chart = vi.hoisted(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }))
vi.mock('echarts/core', async (original) => ({
  ...(await original<typeof import('echarts/core')>()),
  init: () => chart,
}))
enableAutoUnmount(afterEach)
beforeAll(async () => {
  i18n.global.locale.value = 'zh-CN'
  await loadFeatureMessages('home')
})
beforeEach(() => vi.clearAllMocks())

const items: VisitsHistoryDay[] = [
  { date: '2026-11-15', count: 0, missing: true, is_partial: false },
  { date: '2026-11-16', count: 0, missing: false, is_partial: false },
  { date: '2026-11-17', count: 60, missing: false, is_partial: true },
]

describe('visit history chart semantics', () => {
  it('leaves a gap for missing counts, draws confirmed zeros, and keeps UTC dates', () => {
    mount(VisitsHistoryChart, { props: { items }, global: { plugins: [i18n] } })
    const option = chart.setOption.mock.calls[0]![0]
    expect(option.xAxis.data).toEqual(['2026-11-15', '2026-11-16', '2026-11-17'])
    expect(option.series[0].data.map((point: { value: number | null }) => point.value)).toEqual([
      null,
      0,
      60,
    ])
    expect(option.series[0].connectNulls).toBe(false)
    expect(option.tooltip.formatter([{ dataIndex: 0 }])).toContain('数据缺失，不代表零访问')
    expect(option.tooltip.formatter([{ dataIndex: 1 }])).toContain('0 次请求')
    expect(option.tooltip.formatter([{ dataIndex: 2 }])).toBe(
      '2026-11-17  UTC\n60 次请求\n今日截至当前',
    )
  })

  it('replaces the series after refreshed data and disposes the canvas on unmount', async () => {
    const wrapper = mount(VisitsHistoryChart, { props: { items }, global: { plugins: [i18n] } })
    await wrapper.setProps({ items: [items[2]!] })
    const option = chart.setOption.mock.lastCall![0]
    expect(option.xAxis.data).toEqual(['2026-11-17'])
    expect(option.series[0].data).toHaveLength(1)
    wrapper.unmount()
    expect(chart.dispose).toHaveBeenCalledOnce()
  })
})
