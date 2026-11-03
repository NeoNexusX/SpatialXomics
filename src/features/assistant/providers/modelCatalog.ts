/**
 * ctx.models 服务：端点的模型列表和多模态测试。
 *
 * 助手只支持能看图的模型，所以获取列表后要逐个发小图验证。默认只测前 BATCH_SIZE 个，
 * 更多的要用户点了才测。
 *
 * 测试状态存在这个服务里，和界面无关：切走视图、关掉面板时测试继续跑；结果按端点存进
 * localStorage，刷新后还在，没测完的（在用户允许的范围内）下次打开时接着测。
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ResolvedEndpoint, VisionProbeResult } from '../agenttypes/assistant'
import { endpointKey } from '../agentconfig/connectionConfig'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'

/** 一次测试的模型数：超过这个数量要用户允许才继续 */
export const PROBE_BATCH_SIZE = 10
/** 同时测试的模型数 */
const PROBE_CONCURRENCY = 4
/** 最多保留几个端点的测试结果 */
const MAX_SAVED_ENDPOINTS = 5

export type ProbeStatus = 'pending' | 'testing' | VisionProbeResult

export interface CatalogModel {
  id: string
  status: ProbeStatus
}

export interface CatalogSnapshot {
  /** 这份目录属于哪个端点（endpointKey）；没有端点时为 null */
  key: string | null
  /** 正在请求模型列表 */
  listing: boolean
  /** 请求模型列表失败的提示 */
  listError: string
  /** 顺序与端点返回的一致 */
  models: CatalogModel[]
  /** 用户允许测试的数量：只测前 allowed 个 */
  allowed: number
}

type SavedCatalogs = Record<string, { models: CatalogModel[]; allowed: number }>

/**
 * 没有结论的状态：不保存，离开页面后放回待测。
 * no-response 也在内，因为离开页面时 WebKit 在 pagehide 之前就让进行中的请求失败，
 * 这种失败和断网分不开。
 */
const isUnsettled = (status: ProbeStatus) => status === 'testing' || status === 'no-response'

declare module '@deepseek-ai/cordis' {
  interface Context {
    models: ModelCatalog
  }
  interface Events {
    'models/changed': () => void
  }
}

function readSaved(): SavedCatalogs {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.assistantModelCatalog)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as SavedCatalogs) : {}
  } catch {
    return {}
  }
}

export class ModelCatalog extends Service {
  private endpoint: ResolvedEndpoint | null = null
  private key: string | null = null
  private models: CatalogModel[] = []
  private allowed = 0
  private listing = false
  private listError = ''
  /** 进行中的请求归属这个控制器；切换端点时中止，迟到的结果据此丢弃 */
  private controller = new AbortController()
  private running = 0

  constructor(ctx: Context) {
    super(ctx, 'models')
    // 离开页面时浏览器会中断进行中的请求，那些失败不代表模型不可用。
    // 先把它们放回待测，下次打开时接着测
    const onPageHide = () => this.suspend()
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) this.pump()
    }
    ctx.effect(() => {
      window.addEventListener('pagehide', onPageHide)
      window.addEventListener('pageshow', onPageShow)
      return () => {
        window.removeEventListener('pagehide', onPageHide)
        window.removeEventListener('pageshow', onPageShow)
      }
    })
  }

  snapshot(): CatalogSnapshot {
    return {
      key: this.key,
      listing: this.listing,
      listError: this.listError,
      models: this.models.map((model) => ({ ...model })),
      allowed: this.allowed,
    }
  }

  /** 切换到一个端点：恢复它保存过的结果，接着测上次没测完的 */
  open(endpoint: ResolvedEndpoint | null): void {
    const key = endpoint ? endpointKey(endpoint) : null
    if (key === this.key) {
      this.endpoint = endpoint
      return
    }
    this.controller.abort()
    this.controller = new AbortController()
    this.running = 0
    this.endpoint = endpoint
    this.key = key
    const saved = key ? readSaved()[key] : undefined
    this.models = saved?.models.map((model) => ({ ...model })) ?? []
    this.allowed = saved?.allowed ?? 0
    this.listing = false
    this.listError = ''
    this.changed()
    this.pump()
  }

  /** 获取模型列表并开始测试。已有结果的模型不重测 */
  async refresh(): Promise<void> {
    const endpoint = this.endpoint
    if (!endpoint) return
    const { signal } = this.controller
    this.listing = true
    this.listError = ''
    this.changed()
    try {
      const ids = await this.ctx.llm.listModels(endpoint, signal)
      if (signal.aborted) return
      const known = new Map(
        this.models
          .filter((model) => model.status !== 'no-response')
          .map((model) => [model.id, model]),
      )
      this.models = ids.map((id) => known.get(id) ?? { id, status: 'pending' })
      this.allowed = Math.max(this.allowed, PROBE_BATCH_SIZE)
    } catch (err) {
      if (signal.aborted) return
      this.listError = (err as Error).message
    }
    this.listing = false
    this.changed()
    this.pump()
  }

  /** 用户允许后，继续测下一批 */
  testMore(): void {
    this.allowed += PROBE_BATCH_SIZE
    this.changed()
    this.pump()
  }

  /** 清掉结果，从头测第一批 */
  retest(): void {
    for (const model of this.models) {
      if (model.status !== 'testing') model.status = 'pending'
    }
    this.allowed = PROBE_BATCH_SIZE
    this.changed()
    this.pump()
  }

  /** 测试一个手动输入的模型。它排到最前面，不占用户允许的额度 */
  addModel(id: string): void {
    const existing = this.models.find((model) => model.id === id)
    if (existing?.status === 'testing') return
    this.models = [{ id, status: 'pending' }, ...this.models.filter((model) => model.id !== id)]
    this.allowed += 1
    this.changed()
    this.pump()
  }

  private suspend(): void {
    this.controller.abort()
    this.controller = new AbortController()
    this.running = 0
    for (const model of this.models) {
      if (isUnsettled(model.status)) model.status = 'pending'
    }
    this.persist()
  }

  private pump(): void {
    const endpoint = this.endpoint
    if (!endpoint) return
    while (this.running < PROBE_CONCURRENCY) {
      const next = this.models.slice(0, this.allowed).find((model) => model.status === 'pending')
      if (!next) return
      next.status = 'testing'
      this.running++
      this.changed()
      void this.probe(next, endpoint, this.controller.signal)
    }
  }

  private async probe(
    model: CatalogModel,
    endpoint: ResolvedEndpoint,
    signal: AbortSignal,
  ): Promise<void> {
    let result: VisionProbeResult = 'unavailable'
    try {
      result = await this.ctx.llm.probeVision({ ...endpoint, model: model.id }, signal)
    } catch {
      // 探测本身失败按没测出结论处理
    }
    if (signal.aborted) return
    model.status = result
    this.running--
    this.changed()
    this.pump()
  }

  private changed(): void {
    this.persist()
    this.ctx.emit('models/changed')
  }

  private persist(): void {
    if (!this.key) return
    try {
      const saved = readSaved()
      delete saved[this.key]
      if (this.models.length > 0) {
        saved[this.key] = {
          // 没有结论的存成待测，下次打开时接着测
          models: this.models.map(({ id, status }) => ({
            id,
            status: isUnsettled(status) ? 'pending' : status,
          })),
          allowed: this.allowed,
        }
      }
      const entries = Object.entries(saved).slice(-MAX_SAVED_ENDPOINTS)
      localStorage.setItem(
        STORAGE_KEYS.assistantModelCatalog,
        JSON.stringify(Object.fromEntries(entries)),
      )
    } catch {
      // localStorage 不可用时结果只留在内存里
    }
  }
}

export const modelCatalogProvider = (ctx: Context) => {
  new ModelCatalog(ctx)
}
// 探测和列表都经 ctx.llm，fiber 内必须声明 inject
modelCatalogProvider.inject = ['llm']
