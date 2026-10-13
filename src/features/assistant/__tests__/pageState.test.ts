/**
 * buildPageState（get_page_state 工具的数据源）单测。
 *
 * 验证：轻量实时汇总只读 provider 直接字段，不依赖重统计；
 * provider 未注册 / 返回 null 时逐段优雅降级。
 */

import { describe, expect, it, afterEach } from 'vitest'
import {
  buildPageState,
  registerContextProviders,
  unregisterContextProviders,
} from '../providers/analysisContext'

describe('buildPageState', () => {
  afterEach(() => {
    unregisterContextProviders()
  })

  it('nothing loaded/registered → all sections absent, spectrum unavailable', () => {
    const s = buildPageState()
    expect(s.dataset).toBeUndefined()
    expect(s.selectedIon).toBeUndefined()
    expect(s.kmeans).toBeUndefined()
    expect(s.annotationCount).toBeUndefined()
    expect(s.meanSpectrumAvailable).toBe(false)
  })

  it('reads selectedIon / kmeans / annotations from providers (direct fields only)', () => {
    registerContextProviders({
      selectedIon: () => ({
        mz: 741.531,
        tolerance: 0.01,
        matrix: new Float32Array([1, 2, 3]),
        width: 3,
        height: 1,
      }),
      kmeans: () => ({ k: 4, clusterSizes: [10, 20, 30, 40], selectedIds: [1, 2] }),
      annotations: () => ({
        count: 1,
        rows: () => [
          {
            id: 0,
            rank: 1,
            name: 'PC 34:1',
            candidates: [{ id: '', name: 'PC 34:1' }],
            formula: 'C42H82NO8P',
            adduct: '[M+H]+',
            theoMz: 760.5851,
            obsMz: 760.5856,
            errPpm: 0.6,
            intensity: null,
            massScore: 0.97,
            adductFit: 1,
            chaos: null,
            coloc: null,
            spatialScore: null,
            totalScore: 0.79,
            q: 0.01,
            siblings: [],
            samePeak: [],
            missingAdducts: [],
          },
        ],
      }),
    })

    const s = buildPageState()
    expect(s.selectedIon).toEqual({ mz: 741.531, tolerance: 0.01 })
    expect(s.kmeans).toEqual({ k: 4, clusterCount: 4, selectedCount: 2 })
    expect(s.annotationCount).toBe(1)
  })

  it('degrades gracefully when a provider returns null', () => {
    registerContextProviders({
      selectedIon: () => null,
      kmeans: () => ({ k: 2, clusterSizes: [1, 1], selectedIds: [] }),
    })

    const s = buildPageState()
    expect(s.selectedIon).toBeUndefined()
    expect(s.kmeans).toEqual({ k: 2, clusterCount: 2, selectedCount: 0 })
  })

  it('re-evaluates on every call (always live, no snapshot)', () => {
    registerContextProviders({
      selectedIon: () => ({
        mz: 100,
        tolerance: 0.5,
        matrix: new Float32Array(1),
        width: 1,
        height: 1,
      }),
    })
    expect(buildPageState().selectedIon).toEqual({ mz: 100, tolerance: 0.5 })

    // 模拟用户切换选中离子后再次调用
    unregisterContextProviders(['selectedIon'])
    registerContextProviders({
      selectedIon: () => ({
        mz: 200,
        tolerance: 0.5,
        matrix: new Float32Array(1),
        width: 1,
        height: 1,
      }),
    })
    expect(buildPageState().selectedIon).toEqual({ mz: 200, tolerance: 0.5 })
  })
})
