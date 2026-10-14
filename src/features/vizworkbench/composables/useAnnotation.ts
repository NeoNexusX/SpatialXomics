/**
 * 注释面板的状态与流程。三样输入：
 *  - 峰（待注释的对象）：数据集平均轴上的点，强度取平均谱。强度为 0 的点不参与匹配，
 *    其余按强度从小到大排、去掉最低的 n%（滑动条，utils/annotation/peaks）
 *  - 注释库（被匹配的对象）：用户选择的本地库 CSV（dbStore 记住），网站不提供数据库
 *  - 条件：采集元数据（useResultMeta 的 acquisition）推出的极性、容差、加合物
 * 条件在主线程实时解析；库 CSV 的解析与匹配、打分、FDR 都在 worker 里跑；空间评分的
 * 离子图由 useAnnotationSpatial 在主线程读取后交给 worker。
 *
 * 每次都由「开始注释」按钮运行；输入变化会清除旧结果，等待再次点击。按结果页记住条件。
 * 表格一行 = 一个加合离子；同一分子的其他加合离子通过 moleculeId 关联，可互相跳转。
 */

import { computed, onUnmounted, ref, shallowRef, watch, type InjectionKey, type Ref } from 'vue'
import {
  dataModeRef,
  meanSpectrumRef,
  mzAxisRef,
  spectrumError,
} from '@/features/vizworkbench/composables/useZarrIonImage'
import { useAnnotationSpatial } from '@/features/vizworkbench/composables/useAnnotationSpatial'
import {
  buildAcquisitionContext,
  normalizePolarity,
} from '@/features/vizworkbench/utils/annotation/acquisitionContext'
import { resolveAdducts } from '@/features/vizworkbench/utils/annotation/adductRules'
import { AnnotationDbCsvError } from '@/features/vizworkbench/utils/annotation/annotationDb'
import { decodeCsvBytes } from '@/features/vizworkbench/utils/annotation/csv'
import {
  clearStoredDb,
  loadStoredDb,
  saveStoredDb,
} from '@/features/vizworkbench/utils/annotation/dbStore'
import { createEngineClient } from '@/features/vizworkbench/utils/annotation/engineClient'
import {
  adductLabel,
  buildAnnotationCsv,
  moleculeName,
  samePeakIons,
  siblingIons,
} from '@/features/vizworkbench/utils/annotation/format'
import {
  MAX_CUT_PCT,
  rankByIntensity,
  selectPeaks,
} from '@/features/vizworkbench/utils/annotation/peaks'
import { pairKey } from '@/features/vizworkbench/utils/annotation/pearson'
import { compareIons, targetJobKey } from '@/features/vizworkbench/utils/annotation/pipeline'
import { DEFAULT_ENGINE_CONFIG } from '@/features/vizworkbench/utils/annotation/score'
import {
  sharedAnnotationIons,
  sharedAnnotationMolecules,
} from '@/features/vizworkbench/utils/annotation/sharedResults'
import { resolveTolerance } from '@/features/vizworkbench/utils/annotation/tolerance'
import type { Acquisition } from '@/features/vizworkbench/types/acquisition'
import type {
  AdductOverride,
  AnnotationDbInfo,
  AnnotationResult,
  IonAnnotation,
  IonPatch,
  Molecule,
  PeakTable,
  RunSummary,
  SpatialPatch,
} from '@/features/vizworkbench/types/annotation'
import type { AdductId } from '@/shared/chem/adducts'
import {
  registerContextProviders,
  unregisterContextProviders,
} from '@/features/assistant/providers/analysisContext'
import type { AnnotationRow } from '@/features/assistant/agenttypes/assistant'
import { STORAGE_KEYS } from '@/shared/config/storageKeys'
import { downloadBlob } from '@/shared/utils/download'
import { useToast } from '@/shared/composables/useToast'
import { t } from '@/i18n'

export type QLevel = 'all' | 0.05 | 0.1 | 0.2
/** 每个排序键的默认方向都是「好的在前」（m/z 为从小到大），sortReverse 反过来 */
export type AnnotationSortKey = 'total' | 'q' | 'spatial' | 'error' | 'mz' | 'intensity'
export type DbState = 'idle' | 'loading' | 'ready' | 'error'
export type RunState = 'idle' | 'running' | 'done' | 'error'
/** 平均谱：加载中 / 数据集没有（或和 m/z 轴对不上）/ 可用 */
export type MeanState = 'loading' | 'missing' | 'ready'

/** 按结果页记住的条件 */
interface StoredSettings {
  tolValue: number | null
  tolUnit: 'ppm' | 'Da'
  overrides: Partial<Record<AdductId, AdductOverride>>
  polarity: 'positive' | 'negative' | null
  /** 强度最低的百分之几不参与匹配 */
  cutPct?: number
  /** 空间计算覆盖的匹配行百分比；缺省 = 100% */
  spatialPct?: number
}

function readSettings(runId: string): StoredSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.annotationSettings + runId)
    return raw ? (JSON.parse(raw) as StoredSettings) : null
  } catch {
    return null
  }
}

function writeSettings(runId: string, s: StoredSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.annotationSettings + runId, JSON.stringify(s))
  } catch {
    // 存储不可用时只是不记住设置
  }
}

function normalizeSpatialPct(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : DEFAULT_ENGINE_CONFIG.spatialPct
}

/** runId → 32 位种子：同一结果页每次跑出的 decoy 相同 */
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** 搜索文本：名称、候选、分子式、加合物、m/z（小写） */
function buildSearchText(
  molecules: Map<number, Molecule>,
  ionById: Map<number, IonAnnotation>,
): Map<number, string> {
  const out = new Map<number, string>()
  for (const m of molecules.values()) {
    const base = [...m.candidates.flatMap((c) => [c.name, c.id]), m.formula].join('|')
    for (const id of m.ionIds) {
      const ion = ionById.get(id)
      if (ion) {
        out.set(id, `${base}|${adductLabel(ion.adduct)}|${ion.obsMz.toFixed(6)}`.toLowerCase())
      }
    }
  }
  return out
}

export function useAnnotation(opts: {
  runId: Ref<string>
  acquisition: Ref<Acquisition>
  selectedMzIndex: Ref<number>
  selectMzIndex: (idx: number) => void | Promise<void>
}) {
  const { showToast } = useToast()
  let disposed = false
  /** 当前运行的编号；worker 回来的旧编号消息直接丢弃 */
  let runKey = 0
  // 每个空间任务一条 patch；合并后每 200 ms 替换一次数组，避免几百次逐条替换
  let patchQueue: SpatialPatch[] = []
  let patchTimer: ReturnType<typeof setTimeout> | null = null

  const engine = createEngineClient({
    onResult: (key, result) => {
      if (key === runKey && !disposed) applyResult(result)
    },
    onPatch: (key, patch) => {
      if (key === runKey && !disposed) queuePatch(patch)
    },
    onError: (key, message) => {
      if (key !== runKey || disposed) return
      runState.value = 'error'
      runError.value = message
    },
  })

  // ---- 条件 ----------------------------------------------------------------
  const polarityOverride = ref<'positive' | 'negative' | null>(null)
  const tolValue = ref<number | null>(null)
  const tolUnit = ref<'ppm' | 'Da'>('ppm')
  const spatialPct = shallowRef(DEFAULT_ENGINE_CONFIG.spatialPct)
  const adductOverrides = ref<Partial<Record<AdductId, AdductOverride>>>({})

  function setSpatialPct(value: number | null): void {
    spatialPct.value = normalizeSpatialPct(value)
  }

  const metadataPolarityMissing = computed(
    () => normalizePolarity(opts.acquisition.value.polarity) == null,
  )
  const context = computed(() =>
    buildAcquisitionContext(opts.acquisition.value, polarityOverride.value),
  )
  const tolerance = computed(() =>
    resolveTolerance({ value: tolValue.value, unit: tolUnit.value }, context.value.analyzer),
  )
  const adducts = computed(() => resolveAdducts(context.value, adductOverrides.value))
  const enabledAdducts = computed(() => adducts.value.filter((a) => a.enabled))
  const hasAdductOverrides = computed(() => Object.keys(adductOverrides.value).length > 0)

  function setAdductEnabled(id: AdductId, enabled: boolean): void {
    const current = adducts.value.find((a) => a.def.id === id)
    if (!current) return
    const next = { ...adductOverrides.value }
    // 与规则默认一致时去掉覆盖，规则条件变化后能自然跟上
    const ruleDefault = current.origin === 'rule' && current.fit > 0
    if (enabled === ruleDefault) delete next[id]
    else next[id] = enabled ? 'on' : 'off'
    adductOverrides.value = next
  }

  function resetAdducts(): void {
    adductOverrides.value = {}
  }

  /** 只支持对齐后的 centroid 数据（continuous 存储、共享 m/z 轴）；谱图模式未知时不拦 */
  const available = computed(() => {
    if (dataModeRef.value !== 'continuous') return false
    const mode = opts.acquisition.value.spectrumMode
    return !mode || mode === 'centroid'
  })

  // ---- 峰：平均轴上强度 > 0 的点，去掉强度最低的 cutPct% ------------------------
  const cutPct = ref(0)

  /** 平均强度 > 0 的点按强度排好序；只在换数据集或平均谱时重算，拖滑动条不用重排 */
  const ranked = computed(() => {
    const axis = mzAxisRef.value
    const mean = meanSpectrumRef.value
    if (!axis || !mean || mean.length !== axis.length) return null
    return { axis, mean, order: rankByIntensity(mean) }
  })

  const peaks = computed<PeakTable | null>(() => {
    const r = ranked.value
    return r ? selectPeaks(r.axis, r.mean, r.order, cutPct.value) : null
  })

  /** 面板显示用：轴上的点数、强度 > 0 的峰数、参与匹配的峰数 */
  const peakStats = computed(() => ({
    axis: mzAxisRef.value?.length ?? 0,
    nonZero: ranked.value?.order.length ?? 0,
    kept: peaks.value?.mz.length ?? 0,
  }))

  const meanState = computed<MeanState>(() => {
    if (ranked.value) return 'ready'
    return spectrumError.value || meanSpectrumRef.value ? 'missing' : 'loading'
  })

  // ---- 注释库 --------------------------------------------------------------
  const dbState = ref<DbState>('idle')
  /** 当前库的库名与分子式数（库本身在 worker 里解析和持有） */
  const db = shallowRef<AnnotationDbInfo | null>(null)
  /** 库每换一次加一，用来判断要不要重跑 */
  const dbRevision = ref(0)
  const importingDb = ref(false)
  /** 最近一次换库的请求编号：晚到的旧请求结果直接丢弃 */
  let dbRequest = 0
  /** 恢复与导入排队依次进行：worker 按收到的顺序换库，界面按同一顺序更新，两边的当前库一致 */
  let dbQueue: Promise<void> = Promise.resolve()

  function queueDb(task: () => Promise<void>): Promise<void> {
    const next = dbQueue.then(task)
    dbQueue = next.catch(() => {})
    return next
  }

  function applyDb(info: AnnotationDbInfo): void {
    db.value = info
    dbRevision.value++
    dbState.value = 'ready'
  }

  /** 仅恢复用户此前选择的本地库；没有保存的库时等待用户选择 CSV */
  function ensureDb(): Promise<void> {
    if (dbState.value === 'loading' || dbState.value === 'ready') return Promise.resolve()
    const request = ++dbRequest
    dbState.value = 'loading'
    const stale = () => disposed || request !== dbRequest
    return queueDb(async () => {
      try {
        const stored = await loadStoredDb()
        if (stale()) return
        if (stored) {
          let info: AnnotationDbInfo
          try {
            info = await engine.loadDb(stored.fileName, stored.text)
          } catch {
            // 解析期间清除了库：存储和状态都不再动
            if (stale()) return
            void clearStoredDb()
            dbState.value = 'error'
            return
          }
          if (!stale()) applyDb(info)
          return
        }
        dbState.value = 'idle'
      } catch {
        if (!stale()) dbState.value = 'error'
      }
    })
  }

  function dbErrorText(e: unknown): string {
    if (e instanceof AnnotationDbCsvError) {
      if (e.code === 'empty') return t('vizworkbench.annotation.dbCsvEmpty')
      if (e.code === 'noFormulaColumn') return t('vizworkbench.annotation.dbCsvNoFormula')
      return t('vizworkbench.annotation.dbCsvNoRows')
    }
    return t('vizworkbench.annotation.readFailed')
  }

  /** 用户通过按钮选择库 CSV；在本地读取并记住它，下次打开直接用 */
  function importDbFile(file: File): Promise<void> {
    importingDb.value = true
    return queueDb(async () => {
      try {
        const text = decodeCsvBytes(await file.arrayBuffer())
        const info = await engine.loadDb(file.name, text)
        if (disposed) return
        dbRequest++
        applyDb(info)
        showToast(
          t('vizworkbench.annotation.dbImported', { file: file.name, count: info.count }),
          'success',
        )
        void saveStoredDb({ fileName: file.name, text })
      } catch (e) {
        showToast(dbErrorText(e), 'error')
      } finally {
        importingDb.value = false
      }
    })
  }

  /** 清除当前浏览器保存的用户库，等待重新选择 CSV */
  function clearDb(): void {
    dbRequest++
    void clearStoredDb()
    db.value = null
    dbRevision.value++
    dbState.value = 'idle'
  }

  // ---- 运行 ----------------------------------------------------------------
  /** 当前条件是否由用户点击按钮开始过；不保存或自动恢复 */
  const started = ref(false)
  const runState = ref<RunState>('idle')
  const runError = ref<string | null>(null)
  const ions = shallowRef<IonAnnotation[]>([])
  const molecules = shallowRef<Map<number, Molecule>>(new Map())
  /** 峰对 → Pearson（空间评分逐步补全） */
  const pairR = shallowRef<Map<string, number | null>>(new Map())
  /** 详情卡按需算的峰对（只展示，不计入总分） */
  const onDemandR = shallowRef<Map<string, number | null>>(new Map())
  const summary = shallowRef<RunSummary | null>(null)
  /** 空间分已更新、但排名还没刷新的行数（全部完成时自动重排，期间可手动重排） */
  const pendingResort = ref(0)
  /** 每行的搜索文本：出结果时建一次（patch 不改其中的字段，不必随之重建） */
  const searchText = shallowRef<Map<number, string>>(new Map())

  const ionById = computed(() => new Map(ions.value.map((i) => [i.id, i])))

  // 发布到共享引用，供区域比较富集导出等跨面板消费者读取。
  // useAnnotation 的所有更新都是引用替换（shallowRef 天然触发）。
  watch(
    [ions, molecules],
    ([i, m]) => {
      sharedAnnotationIons.value = i
      sharedAnnotationMolecules.value = m
    },
    { immediate: true },
  )

  const spatial = useAnnotationSpatial({
    tolerance: () => tolerance.value,
    onImages: (job, images, width, height) =>
      engine.spatial(runKey, job.job, images, width, height),
  })

  /** 开始了却跑不起来的原因（面板提示） */
  const blockedReason = computed<'polarity' | 'adducts' | null>(() => {
    if (!context.value.polarity) return 'polarity'
    return enabledAdducts.value.length === 0 ? 'adducts' : null
  })

  function resetResult(): void {
    ions.value = []
    molecules.value = new Map()
    pairR.value = new Map()
    onDemandR.value = new Map()
    summary.value = null
    pendingResort.value = 0
    searchText.value = new Map()
    patchQueue = []
  }

  function applyResult(result: AnnotationResult): void {
    resetResult()
    ions.value = result.ions
    molecules.value = new Map(result.molecules.map((m) => [m.id, m]))
    searchText.value = buildSearchText(molecules.value, ionById.value)
    summary.value = result.summary
    runState.value = 'done'
    spatial.start(result.jobs)
  }

  function queuePatch(patch: SpatialPatch): void {
    patchQueue.push(patch)
    if (patch.final) flushPatches()
    else patchTimer ??= setTimeout(flushPatches, 200)
  }

  function flushPatches(): void {
    if (patchTimer) clearTimeout(patchTimer)
    patchTimer = null
    const queue = patchQueue
    patchQueue = []
    if (queue.length === 0) return
    const updates = new Map<number, IonPatch>()
    const nextPairs = new Map(pairR.value)
    for (const p of queue) {
      for (const u of p.ions) updates.set(u.id, { ...updates.get(u.id), ...u })
      for (const [k, r] of p.pairR) nextPairs.set(k, r)
    }
    let changed = 0
    ions.value = ions.value.map((ion) => {
      const u = updates.get(ion.id)
      if (!u) return ion
      if (u.scores && u.scores.total !== ion.scores.total) changed++
      return {
        ...ion,
        scores: u.scores ?? ion.scores,
        q: u.q !== undefined ? u.q : ion.q,
        rank: u.rank ?? ion.rank,
      }
    })
    pairR.value = nextPairs
    summary.value = queue[queue.length - 1]!.summary
    pendingResort.value = queue.some((p) => p.final) ? 0 : pendingResort.value + changed
  }

  /** 空间评分进行中，按当前总分立即重排 */
  function resortNow(): void {
    const rankOf = new Map([...ions.value].sort(compareIons).map((ion, i) => [ion.id, i + 1]))
    ions.value = ions.value.map((ion) => ({ ...ion, rank: rankOf.get(ion.id)! }))
    pendingResort.value = 0
  }

  /** 当前条件；含 runId：换了结果页，峰数相同也要清除旧结果 */
  const runInputsKey = computed(() => {
    const p = peaks.value
    if (!available.value || !p || !db.value || dbState.value !== 'ready') return null
    if (blockedReason.value) return null
    const tol = tolerance.value
    return JSON.stringify([
      opts.runId.value,
      p.mz.length,
      cutPct.value,
      dbRevision.value,
      tol.value,
      tol.unit,
      spatialPct.value,
      enabledAdducts.value.map((a) => [a.def.id, a.fit]),
    ])
  })

  function invalidateRun(): void {
    runKey++
    spatial.cancel()
    if (patchTimer) clearTimeout(patchTimer)
    patchTimer = null
    resetResult()
    runState.value = 'idle'
    runError.value = null
    started.value = false
  }

  // 条件和实际峰数据变化只使旧运行失效；不会自行启动。同步作废编号，忽略晚到的旧消息。
  watch([runInputsKey, peaks], invalidateRun, { flush: 'sync' })

  const canStart = computed(
    () => runInputsKey.value != null && !importingDb.value && runState.value !== 'running',
  )

  function start(): void {
    const p = peaks.value
    if (disposed || !p || !canStart.value) return
    invalidateRun()
    started.value = true
    runState.value = 'running'
    engine.run({
      runKey,
      peaks: p,
      adducts: enabledAdducts.value.map((a) => ({ id: a.def.id, fit: a.fit })),
      tolerance: { ...tolerance.value },
      config: {
        ...DEFAULT_ENGINE_CONFIG,
        spatialPct: spatialPct.value,
        seed: hashSeed(opts.runId.value),
      },
    })
  }

  // ---- 表格：筛选与排序 ------------------------------------------------------
  const qLevel = ref<QLevel>('all')
  /** 空列表表示全部；多选时保留任一选中加合物的行。 */
  const adductFilter = ref<AdductId[]>([])
  const siblingsOnly = ref(false)
  /** 「只看这个分子」：设了它其他筛选都不生效 */
  const moleculeFilter = ref<number | null>(null)
  const search = ref('')
  const searchQuery = ref('')
  const sortKey = ref<AnnotationSortKey>('total')
  const sortReverse = ref(false)

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  watch(search, (v) => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => (searchQuery.value = v.trim().toLowerCase()), 200)
  })

  const adductOptions = computed(() => [...new Set(ions.value.map((i) => i.adduct))])

  function passesFilters(ion: IonAnnotation): boolean {
    if (moleculeFilter.value != null) return ion.moleculeId === moleculeFilter.value
    if (qLevel.value !== 'all' && !(ion.q != null && ion.q <= qLevel.value)) return false
    if (adductFilter.value.length && !adductFilter.value.includes(ion.adduct)) return false
    if (siblingsOnly.value && (molecules.value.get(ion.moleculeId)?.ionIds.length ?? 0) < 2) {
      return false
    }
    const q = searchQuery.value
    return !q || (searchText.value.get(ion.id) ?? '').includes(q)
  }

  /** 排序值：越小越靠前；null 永远沉底 */
  function sortValue(ion: IonAnnotation): number | null {
    switch (sortKey.value) {
      case 'total':
        return ion.rank
      case 'q':
        return ion.q
      case 'spatial':
        return ion.scores.spatial == null ? null : -ion.scores.spatial
      case 'error':
        return Math.abs(ion.errPpm)
      case 'mz':
        return ion.obsMz
      case 'intensity':
        return Number.isFinite(ion.intensity) ? -ion.intensity : null
    }
  }

  const rows = computed<IonAnnotation[]>(() => {
    const sign = sortReverse.value ? -1 : 1
    return ions.value
      .filter(passesFilters)
      .map((ion) => ({ ion, v: sortValue(ion) }))
      .sort((a, b) => {
        if (a.v == null || b.v == null) {
          return a.v == null && b.v == null ? a.ion.rank - b.ion.rank : a.v == null ? 1 : -1
        }
        return (a.v - b.v) * sign || a.ion.rank - b.ion.rank
      })
      .map((x) => x.ion)
  })

  // ---- 选择与跳转 ----------------------------------------------------------
  const selectedIonId = ref<number | null>(null)
  /** 悬停行所在的分子：表格里同分子的其他行一起浅色高亮 */
  const hoverMoleculeId = ref<number | null>(null)
  /** 表格据此滚动到某一行（nonce 让同一行重复跳转也会触发） */
  const scrollRequest = ref<{ id: number; nonce: number } | null>(null)
  /** 跳转目标被当前筛选隐藏 */
  const hiddenJumpId = ref<number | null>(null)

  function requestScroll(id: number): void {
    scrollRequest.value = { id, nonce: (scrollRequest.value?.nonce ?? 0) + 1 }
  }

  /** 选中一行：离子图切到它的峰（每个峰都在平均轴上） */
  function selectIon(ion: IonAnnotation): void {
    selectedIonId.value = ion.id
    hiddenJumpId.value = null
    void opts.selectMzIndex(ion.axisIndex)
  }

  /** 跳到另一行（同分子离子、同峰注释）：选中、离子图切过去、表格滚动到它 */
  function jumpToIon(id: number): void {
    const ion = ionById.value.get(id)
    if (!ion) return
    selectIon(ion)
    if (rows.value.some((r) => r.id === id)) requestScroll(id)
    else hiddenJumpId.value = id
  }

  /** 清掉筛选，让被隐藏的跳转目标显示出来 */
  function revealHiddenJump(): void {
    const id = hiddenJumpId.value
    if (id == null) return
    qLevel.value = 'all'
    adductFilter.value = []
    siblingsOnly.value = false
    moleculeFilter.value = null
    search.value = ''
    searchQuery.value = ''
    hiddenJumpId.value = null
    requestScroll(id)
  }

  // 外部选中 m/z（点谱图、区域比较表）时同步选中对应行
  watch(opts.selectedMzIndex, (idx) => {
    const current = selectedIonId.value != null ? ionById.value.get(selectedIonId.value) : null
    if (current?.axisIndex === idx) return
    const hit = rows.value.find((r) => r.axisIndex === idx)
    selectedIonId.value = hit?.id ?? null
    if (hit) requestScroll(hit.id)
  })

  /** 两行之间的共定位 r：空间评分算过的优先，其次是按需算的；没算过为 undefined */
  function pairRFor(a: IonAnnotation, b: IonAnnotation): number | null | undefined {
    const key = pairKey(a.axisIndex, b.axisIndex)
    return pairR.value.has(key) ? pairR.value.get(key) : onDemandR.value.get(key)
  }

  async function computePairOnDemand(a: IonAnnotation, b: IonAnnotation): Promise<void> {
    if (pairRFor(a, b) !== undefined) return
    const key = pairKey(a.axisIndex, b.axisIndex)
    const r = await spatial
      .pairOnDemand(a.axisIndex, b.axisIndex, DEFAULT_ENGINE_CONFIG.minPixels)
      .catch(() => null)
    if (!disposed) onDemandR.value = new Map(onDemandR.value).set(key, r)
  }

  /** 悬停或滚动到的行：把它们所在分子组的空间任务提前 */
  function prioritize(ids: number[]): void {
    const jobs = new Set<string>()
    for (const id of ids) {
      const ion = ionById.value.get(id)
      if (ion?.scores.spatialState === 'queued') jobs.add(targetJobKey(ion.moleculeId))
    }
    spatial.bump([...jobs])
  }

  // ---- 导出（当前表格，含筛选与排序） -----------------------------------------
  function exportCsv(): void {
    const list = rows.value
    if (list.length === 0) {
      showToast(t('vizworkbench.annotation.nothingToExport'), 'info')
      return
    }
    const csv = buildAnnotationCsv(list, molecules.value, ionById.value, pairR.value)
    downloadBlob(
      new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }),
      `${opts.runId.value || 'result'}_annotations.csv`,
    )
    showToast(t('vizworkbench.annotation.exported', { count: list.length }), 'success')
  }

  // ---- 按结果页恢复条件 ------------------------------------------------------
  let restoring = false
  watch(
    opts.runId,
    (id) => {
      const s = id ? readSettings(id) : null
      restoring = true
      tolValue.value = s?.tolValue ?? null
      tolUnit.value = s?.tolUnit ?? 'ppm'
      spatialPct.value = normalizeSpatialPct(s?.spatialPct)
      adductOverrides.value = s?.overrides ?? {}
      polarityOverride.value = s?.polarity ?? null
      cutPct.value = Math.min(MAX_CUT_PCT, Math.max(0, s?.cutPct ?? 0))
      started.value = false
      restoring = false
    },
    { immediate: true },
  )

  // 进入面板时恢复用户自己的库；没有库时显示文件选择入口。
  void ensureDb()

  watch([tolValue, tolUnit, spatialPct, adductOverrides, polarityOverride, cutPct], () => {
    if (restoring || !opts.runId.value) return
    writeSettings(opts.runId.value, {
      tolValue: tolValue.value,
      tolUnit: tolUnit.value,
      spatialPct: spatialPct.value,
      overrides: adductOverrides.value,
      polarity: polarityOverride.value,
      cutPct: cutPct.value,
    })
  })

  // ---- AI 助手 -------------------------------------------------------------
  function toAssistantRow(ion: IonAnnotation): AnnotationRow {
    const m = molecules.value.get(ion.moleculeId)
    return {
      id: ion.id,
      rank: ion.rank,
      name: moleculeName(m),
      candidates: (m?.candidates ?? []).map((c) => ({ id: c.id, name: c.name })),
      formula: m?.formula ?? '',
      adduct: adductLabel(ion.adduct),
      theoMz: ion.theoMz,
      obsMz: ion.obsMz,
      errPpm: ion.errPpm,
      intensity: Number.isFinite(ion.intensity) ? ion.intensity : null,
      massScore: ion.scores.mass,
      adductFit: ion.scores.adduct,
      chaos: ion.scores.chaos,
      coloc: ion.scores.coloc,
      spatialScore: ion.scores.spatial,
      totalScore: ion.scores.total,
      q: ion.q,
      siblings: siblingIons(ion, molecules.value, ionById.value).map((s) => ({
        adduct: adductLabel(s.adduct),
        obsMz: s.obsMz,
        r: pairRFor(ion, s) ?? null,
        rank: s.rank,
      })),
      samePeak: samePeakIons(ion, ionById.value).map((s) => ({
        name: moleculeName(molecules.value.get(s.moleculeId)),
        adduct: adductLabel(s.adduct),
      })),
      missingAdducts: (m?.missing ?? []).map((x) => adductLabel(x.adduct)),
    }
  }

  registerContextProviders({
    annotations: () =>
      ions.value.length > 0
        ? { count: ions.value.length, rows: () => ions.value.map(toAssistantRow) }
        : null,
  })

  onUnmounted(() => {
    disposed = true
    if (searchTimer) clearTimeout(searchTimer)
    if (patchTimer) clearTimeout(patchTimer)
    engine.dispose()
    unregisterContextProviders(['annotations'])
  })

  return {
    // 条件
    acquisition: opts.acquisition,
    context,
    metadataPolarityMissing,
    polarityOverride,
    tolerance,
    tolValue,
    tolUnit,
    spatialPct,
    setSpatialPct,
    adducts,
    enabledAdducts,
    hasAdductOverrides,
    setAdductEnabled,
    resetAdducts,
    available,
    // 峰
    cutPct,
    peakStats,
    meanState,
    // 注释库
    dbState,
    db,
    importingDb,
    ensureDb,
    importDbFile,
    clearDb,
    // 运行与结果
    started,
    canStart,
    start,
    blockedReason,
    runState,
    runError,
    ions,
    ionById,
    molecules,
    summary,
    pendingResort,
    resortNow,
    // 表格
    rows,
    qLevel,
    adductFilter,
    adductOptions,
    siblingsOnly,
    moleculeFilter,
    search,
    sortKey,
    sortReverse,
    // 选择与跳转
    selectedIonId,
    selectedMzIndex: opts.selectedMzIndex,
    hoverMoleculeId,
    scrollRequest,
    hiddenJumpId,
    selectIon,
    jumpToIon,
    revealHiddenJump,
    pairRFor,
    computePairOnDemand,
    prioritize,
    exportCsv,
  }
}

export type AnnotationController = ReturnType<typeof useAnnotation>

export const ANNOTATION_KEY: InjectionKey<AnnotationController> = Symbol('annotation')
