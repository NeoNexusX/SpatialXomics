/**
 * useModelCatalog：ctx.models 的 Vue 桥（模块级单例）。
 * 测试状态由插件持有，这里只同步快照并派生界面要显示的数字。
 */

import { computed, shallowRef } from 'vue'
import type { ResolvedEndpoint } from '../plugins/connection'
import type { CatalogSnapshot } from '../plugins/model-catalog'
import { whenAgentReady } from '../bootstrap'

const snapshot = shallowRef<CatalogSnapshot>({
  key: null,
  listing: false,
  listError: '',
  models: [],
  allowed: 0,
})

let bound = false
function bindEvents(): void {
  if (bound) return
  bound = true
  void whenAgentReady().then((ctx) => {
    snapshot.value = ctx.models.snapshot()
    ctx.on('models/changed', () => {
      snapshot.value = ctx.models.snapshot()
    })
  })
}

const models = computed(() => snapshot.value.models)
const available = computed(() =>
  models.value.filter((model) => model.status === 'vision').map((model) => model.id),
)
const countOf = (status: string) => models.value.filter((model) => model.status === status).length

/** 已允许测试的数量（不超过总数） */
const allowedCount = computed(() => Math.min(snapshot.value.allowed, models.value.length))
const unavailableCount = computed(() => countOf('unavailable') + countOf('no-response'))
const testedCount = computed(
  () => available.value.length + countOf('no-vision') + unavailableCount.value,
)
/** 还没得到用户允许测试的数量 */
const remainingCount = computed(() => models.value.length - allowedCount.value)
const isTesting = computed(() =>
  models.value
    .slice(0, snapshot.value.allowed)
    .some((model) => model.status === 'pending' || model.status === 'testing'),
)

export function useModelCatalog() {
  bindEvents()

  async function open(endpoint: ResolvedEndpoint | null): Promise<void> {
    const ctx = await whenAgentReady()
    ctx.models.open(endpoint)
  }

  async function refresh(): Promise<void> {
    const ctx = await whenAgentReady()
    await ctx.models.refresh()
  }

  async function testMore(): Promise<void> {
    const ctx = await whenAgentReady()
    ctx.models.testMore()
  }

  async function retest(): Promise<void> {
    const ctx = await whenAgentReady()
    ctx.models.retest()
  }

  async function addModel(id: string): Promise<void> {
    const ctx = await whenAgentReady()
    ctx.models.addModel(id)
  }

  return {
    snapshot,
    models,
    available,
    allowedCount,
    testedCount,
    remainingCount,
    isTesting,
    unsupportedCount: computed(() => countOf('no-vision')),
    unavailableCount,
    open,
    refresh,
    testMore,
    retest,
    addModel,
  }
}
