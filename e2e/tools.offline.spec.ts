/* eslint-disable playwright/no-conditional-in-test, playwright/expect-expect --
   这是一次性抓取脚本，不是回归用例；「抓不到就报错」的守卫不是 expect 断言。 */
/**
 * 工具输出抓取（一次性工具，不是回归用例）。
 *
 * 在真实浏览器里装配助手的真实插件组合（baseBundle），对每个工具跑真实的
 * `ctx.tools.execute` 管线，把「模型实际看到的完整结果」原样落盘：
 * - 文本 content 原样（含单工具字符上限截断、存档桩、分页脚注）
 * - 图片走运行时真实链路 attachments.saveTools 落成文件（PNG/JPEG 原字节），
 *   并附上模型请求里对应的内容块形态
 *
 * 页面类工具前先 `page.goto('/vizworkbench')`，它们读的是该页的 zarr 共享状态与
 * 实例 provider 注册表；外部库/文献/文件工具走真实网络与 /kegg-rest、/hmdb-archive、
 * /api 代理（离线夹具提供后端与 LLM，不发真实模型请求）。
 *
 * 运行（先起 dev server，端口用 E2E_PORT 指定）：
 *   npx playwright test tools.offline --project=offline-chromium
 * 输出目录用 CAPTURE_OUT 指定（默认仓库根 tools-output）。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from './fixtures/offline.js'

const OUT = process.env.CAPTURE_OUT || 'tools-output'

interface CapturedImage {
  label?: string
  mime: string
  width: number
  height: number
  /** 落盘文件（相对 tools.json 所在目录），可直接打开核对 */
  file: string
  /** 解码后字节数（运行时上限 2MB） */
  bytes: number
  /** 模型请求里该图对应的内容块（不含 base64 本体）。 */
  modelBlock: Record<string, unknown>
}

interface Capture {
  id: string
  group: 'page' | 'chemistry' | 'biology' | 'literature' | 'files' | 'system' | 'web'
  tool: string
    /** 给人看的注释（一段一条）：为什么用这个参数、这段输出代表什么。模型看不到。 */
  note?: string | string[]
  args: Record<string, unknown>
  /** 抓取时的页面/数据上下文，帮助判断输出是否典型 */
  context?: Record<string, unknown>
  error?: string
  model?: {
    /** 模型在 tool_result 里看到的正文，原样 */
    text: string
    textChars: number
    /** 渲染文本被工具结果上限截断（全文进了存档，正文带 read_archived_result 指针） */
    truncated?: boolean
    maxResultChars?: number
    /** 附带的图片：与文本同在一个 tool_result 里 */
    images?: CapturedImage[]
  }
  /** 历史里的工具消息（真正持久化的形态：图片是附件引用） */
  wire?: { messages: unknown[]; shape: unknown }
  /** 本次调用在存档里的 id（仅本次抓取有效） */
  archiveId?: string
}

const captures: Capture[] = []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))


/** 等页面请求队列静下来，给 zarr 分块加载一个稳定的读数窗口 */
async function settle(page: import('@playwright/test').Page) {
  let inFlight = -1
  let stable = 0
  for (let i = 0; i < 90 && stable < 5; i++) {
    await sleep(1000)
    const next = await page.evaluate(() => (globalThis as { __capInFlight?: number }).__capInFlight ?? -1)
    if (next === inFlight) stable++
    else stable = 0
    inFlight = next
  }
}

const GROUPS = [
  { key: 'page', title: '页面信息（读当前 vizworkbench 的实时状态）' },
  { key: 'chemistry', title: '化学信息' },
  { key: 'biology', title: '生物信息' },
  { key: 'literature', title: '文献信息' },
  { key: 'files', title: '后端文件 / 任务 / 配额' },
  { key: 'web', title: '公网检索' },
  { key: 'system', title: '助手自身（存档读取、技能加载）' },
] as const

/** 每张附图「画的是什么」——按工具归类，便于读者不打开文件也能理解 */
const IMAGE_CONTENT: Partial<Record<string, string>> = {
  get_ion: '重渲染的离子栅格：颜色=强度（当前 colormap，默认 viridis），黑=0；含 24px 标签条。不含 ROI 高亮/通道混合/KMeans 叠加。',
  get_ion_image: '单目标离子热图：颜色=强度，标签烧在图下方；多目标时各图共享色阶。',
  get_kmeans: 'KMeans 叠加图：透明背景，只画选中的簇；底部色图例给出簇 id 与像素数（>12 簇截断为 +N more）。',
  get_umap: 'UMAP 叠加图：透明背景，前景由嵌入坐标的占用掩膜决定；最近邻放大。',
  get_pixel_spectrum: '全谱棒图：灰=全谱其余峰，橙=当前窗口的峰；上沿标 m/z 范围与最大强度；>2000 峰按强度截断但保留高亮峰。',
}

/**
 * 组装最终文件：抓取细节（capture 数组）→ 一份可读的目标 JSON。
 * 所有注释键统一 __ 前缀；工具正文与参数保持原样不动。
 */
function buildDocument(captures: Capture[], pageState: Record<string, unknown>) {
  const byGroup = new Map<string, unknown[]>(GROUPS.map((group) => [group.title, []]))
  for (const capture of captures) {
    const title = GROUPS.find((group) => group.key === capture.group)!.title
    const notes = Array.isArray(capture.note) ? capture.note : capture.note ? [capture.note] : []
    const images = (capture.model?.images ?? []).map((image) => ({
      ...image,
      __whatItShows: IMAGE_CONTENT[capture.tool] ?? '工具附图',
    }))
    byGroup.get(title)!.push({
      __tool: capture.tool,
      __instance: capture.id,
      __argsNote: capture.context,
      __whatThisIs: notes,
      args: capture.args,
      ...(capture.error ? { __error: capture.error } : {}),
      model: {
        __note:
          'ToolRuntime 交给 agent-loop 的 content（原样）：已按单工具上限截断；超过上限时正文末尾是存档指针，全文在存档里。',
        text: capture.model?.text ?? '',
        textChars: capture.model?.textChars ?? 0,
        ...(capture.model?.truncated ? { truncated: true } : {}),
        ...(capture.model?.maxResultChars
          ? { maxResultChars: capture.model.maxResultChars }
          : {}),
        ...(images.length ? { images } : {}),
      },
      wire: {
        __note:
          '同一次调用在历史里与 llm-anthropic 协议层的实际形态：历史消息里图片只是附件引用，发请求时还原成 data URL，图片块与正文同在一个 tool_result 里。base64 已换成占位符，图片本体见 model.images[].file。',
        messages: slimWire(capture.wire!).messages,
        toolResult: slimWire(capture.wire!).shape?.[1]?.content?.[0] ?? null,
      },
    })
  }
  const registered = new Set(captures.map((capture) => capture.tool))
  return {
    __whatThisFileIs: [
      '助手每个已注册工具在一次真实调用里「模型实际看到的那部分」的逐工具实录。',
      '每个工具一条记录：调用参数、模型收到的正文（原样）、附带的图片（本体以文件另存 + 模型请求里的块形态）、以及流水线形态。',
      '所有以 __ 开头的键都是本文件的注释；不带 __ 的 model.text / args / error 是工具输出的真实内容。',
    ],
    __howTheseOutputsWereProduced: [
      '真实前端（vite dev server）+ Chromium，装配助手的真实插件组合 baseBundle（28 个工具），对每个工具调用真实的 ctx.tools.execute 管线。',
      '管线顺序：validateArgs → tools/pre-execute 闸门 → 超时包裹 → execute → output.render → 字符上限截断 → agent/tool-result waterfall（tool-archive 写全文存档、必要时替换为截断桩）→ 工具消息 → 发请求前附件还原。',
      '页面类工具：数据由一份确定性示例数据集注入 vizworkbench 的 zarr 共享状态与实例 provider 注册表；工具代码、注册表、canvas 渲染、字符预算与截断链路都是真实的。',
      '外部工具：真实网络（PubChem / ChEBI-OLS4 / KEGG 经 /kegg-rest 代理 / HMDB 经 /hmdb-archive 代理 / PubMed / Europe PMC / OpenAlex / Exa）；后端与 LLM 用 e2e 离线夹具，不发真实模型请求。',
      '失败与超时只在真实发生时记录（本轮 Europe PMC 有一次真实 15s 超时），不人为构造。',
    ],
    __whyImages: [
      '有 7 个工具会返回图片：get_page（旧版行为）、get_ion、get_ion_image、get_kmeans、get_umap、get_pixel_spectrum。图片不是文本，而是作为图片附件随 tool_result 一起进入上下文。',
      '工具返回 1–4 张 PNG/JPEG（解码后单张 ≤2MB，尺寸为正整数）；ToolRuntime 校验后交给 agent-loop。',
      'agent-loop 用 attachments.saveTools 把图片写进会话存储，历史里只留附件引用（不持久化 base64）。',
      '下次请求前 attachments.hydrate 把引用还原成 data URL；llm-anthropic 的 toModelMessages 把正文与图片一起包进同一个 tool_result：output = { type: "content", value: [ {type:"text"}, {type:"file", mediaType, data:{type:"data", data:"<base64>"}} ] }。',
      '所以模型看到的是「正文 + 图片」在同一条工具消息里，图片按图片模态进入上下文（不是被转成文字）。',
      '本文件的 JSON 里不内嵌 base64：图片按 PNG/JPEG 原字节放在 images/ 下（与 JSON 同目录），每条记录的 model.images[] 给出文件、尺寸、字节数与模型请求里的块形态；wire.toolResult 中 base64 替换为 "<base64 N chars>" 占位。',
      '要逐字复现某次模型请求：把 model.images[].file 的字节 base64 编码，填回 wire.toolResult 里对应 {"type":"data","data":…} 的 data 字段即可。',
    ],
    __fieldGuide: {
      '__tool / __instance': '工具名 / 这一次抓取实例的 id（同一工具有多组参数时用来区分）',
      '__whatThisIs': '给人看的解释：为什么用这组参数、这段输出代表什么（模型看不到）',
      '__argsNote': '这次抓取用的页面/数据上下文',
      'args': '实际传给工具的 JSON 参数',
      'model.text': '模型收到的正文，原样（含错误正文；错误时另有 __error 给出原始错误消息）',
      'model.truncated / maxResultChars': '正文被单工具上限截断过时为 true；上限是 4000（默认）或 12000（证据类，见 tools/limits.ts）',
      'model.images': '同一 tool_result 里附带的图片：文件、MIME、尺寸、字节数、画的是什么、模型请求里的块形态',
      'wire.messages': '历史里的助手 tool-call 消息与工具消息（图片是附件引用）',
      'wire.toolResult': '协议层 llm-anthropic 的 tool_result 块（真正发给模型的形态）',
    },
    __coverage: {
      registeredTools: 28,
      capturedTools: registered,
      groups: GROUPS.map((group) => ({
        group: group.title,
        tools: [...new Set(captures.filter((c) => c.group === group.key).map((c) => c.tool))],
      })),
      pageData: pageState,
      capturedAt: new Date().toISOString(),
      capturedOn: 'Chromium headless + vite dev server',
    },
    __limitations: [
      'list_files / list_my_files / list_my_processes / get_user_quota 的输出来自 e2e 离线夹具（没有文件、任务与配额数据），只代表格式，不代表真实数据量。',
      'get_file_metadata 返回夹具里的单个数据集元数据。',
      '页面类工具的数据是注入的示例数据集，数值只用于展示格式与量级。',
      'read_archived_result 用的 archiveId 只在抓取时有效，不能拿来复跑。',
      'HMDB 走 Internet Archive 快照，快照时间（snapshot 行）会随归档变化。',
      'KEGG / PubChem / 文献结果是实时数据，重跑会得到不同条目（格式不变）。',
    ],
    tools: Object.fromEntries(byGroup),
  }
}

/** 去 base64：JSON 里不留图片本体（图片另存为文件） */
function slimWire(wire: { messages: unknown[]; shape: unknown }): Record<string, unknown> & {
  messages: unknown[]
  shape: { content?: { content?: unknown[] }[] }[]
} {
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string')
      return value.length > 2000 && /^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 128))
        ? `<base64 ${value.length} chars>`
        : value
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]))
    return value
  }
  return replace(wire) as never
}

test('capture every agent tool’s model-visible output', async ({ page }) => {
  test.setTimeout(900_000)
  await mkdir(OUT, { recursive: true })
  // 页面类工具要真实画布（离子热图/叠加/谱图都是 canvas 渲染）
  if (!(await page.evaluate(() => !!document.createElement('canvas').getContext('2d'))))
    throw new Error('Canvas 2D is unavailable; page-tool images cannot be captured')

  // 统计页面在途请求，供 settle() 判稳（只加钩子，不改应用行为）
  await page.addInitScript(() => {
    const state = globalThis as { __capInFlight?: number }
    state.__capInFlight = 0
    const original = fetch.bind(globalThis)
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      state.__capInFlight!++
      const done = () => {
        state.__capInFlight!--
      }
      try {
        const result = original(input, init)
        result.then(done, done)
        return result
      } catch (error) {
        done()
        throw error
      }
    }
  })

  await page.goto('/vizworkbench')
  await page.waitForLoadState('load').catch(() => {})

  // 页面类工具需要一块连续模式数据：注入一份确定性的小数据集（64×48、80 个 m/z 的
  // 高斯斑点离子，mean spectrum 取 3 个显著峰），并注册页面在真实边栏里会注册的那组
  // provider —— 形状与字段都走生产类型，不是为工具定制的数据。
  await page.evaluate(async () => {
    const zarr = await import('/src/services/zarr/zarrSharedState.ts')
    const providers = await import('/src/features/agent/bridge/analysisContext.ts')

    const width = 64
    const height = 48
    const mzAxis = new Float64Array([180.0634, 744.5252, 796.5854])
    const ion = (index: number) => {
      const [cx, cy, sigma, amp] = [
        [18, 14, 6, 1200],
        [44, 30, 8, 900],
        [50, 12, 5, 400],
      ][index]!
      const matrix = new Float32Array(width * height)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          matrix[y * width + x] =
            Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma ** 2)) * amp +
            ((x * 7 + y * 13) % 11) // 低幅纹理，让分位数统计不平坦
      return matrix
    }
    const ions = [ion(0), ion(1), ion(2)]
    zarr.setZarrStore({
      getSummedIonImageByMzIndices: async (indices: number[]) => {
        const sum = new Float32Array(width * height)
        for (const index of indices) for (let i = 0; i < sum.length; i++) sum[i]! += ions[index]![i]!
        return sum
      },
      getPixelSpectrum: async (pixelIndex: number) => ({
        pixelIndex,
        x: (pixelIndex % width) + 1,
        y: Math.floor(pixelIndex / width) + 1,
        mz: mzAxis,
        intensity: new Float32Array([ions[0]![pixelIndex]!, ions[1]![pixelIndex]!, 12 + (pixelIndex % 5)]),
      }),
      loadCoordinates: async () => {
        const coords = new Uint32Array(width * height * 3)
        for (let i = 0; i < width * height; i++) {
          coords[i * 3] = (i % width) + 1
          coords[i * 3 + 1] = Math.floor(i / width) + 1
          coords[i * 3 + 2] = 1
        }
        return coords
      },
    } as never)
    zarr.dataModeRef.value = 'continuous'
    zarr.ionDims.value = { width, height }
    zarr.mzAxisRef.value = mzAxis
    zarr.polarityRef.value = 'positive'
    zarr.metadataAttrsRef.value = {
      name: 'mouse-brain-example',
      filename: 'mouse-brain-example.imzML',
      spectrum_count_num: width * height,
      pixel_size_horizontal: 50,
      pixel_size_vertical: 50,
      analyzer: 'timsTOF fleX',
      ionisation_source: 'MALDI-2',
      polarity: 'Positive',
      organism: 'Mouse (Mus musculus)',
      organism_part: 'Brain',
      spectrum_mode: 'centroid',
      storage_mode: 'continuous',
    } as never
    ;(zarr as unknown as { ticMatrix: { value: Float32Array | null } }).ticMatrix.value = (
      await zarr.getSharedZarrContext().store!.getSummedIonImageByMzIndices([0, 1, 2])
    )

    const matrixFor = (mz: number, tolerance: number) => {
      const index = Math.abs(mz - mzAxis[0]!) <= tolerance ? 0 : Math.abs(mz - mzAxis[1]!) <= tolerance ? 1 : 2
      return { ...zarr.ionDims.value!, matrix: ions[index]!, mz, tolerance }
    }
    const annotation = (id: number, rank: number, name: string, obsMz: number, adduct: string) => ({
      id,
      rank,
      name,
      origin: rank % 3 === 0 ? 'exogenous' : 'endogenous',
      candidates: [
        { id: `HMDB00000${id}`, name, origin: rank % 3 === 0 ? 'exogenous' : 'endogenous' },
        ...(rank === 1 ? [{ id: 'HMDB0000122', name: 'D-Glucose', origin: 'endogenous' }] : []),
      ],
      formula: 'C6H12O6',
      adduct,
      theoMz: obsMz + 0.0004,
      obsMz,
      errPpm: 0.54,
      intensity: 2400 - rank * 37,
      massScore: 0.92,
      adductFit: 0.81,
      chaos: rank <= 2 ? 0.64 : null,
      coloc: rank <= 2 ? 0.72 : null,
      spatialScore: rank <= 2 ? 0.7 : null,
      totalScore: 0.9 - rank * 0.02,
      q: 0.012,
      siblings: rank === 1 ? [{ adduct: '[M+Na]+', obsMz: 766.5, r: 0.81, rank: 4 }] : [],
      samePeak: rank === 1 ? [{ name: 'Fructose', adduct: '[M+H]+', origin: 'endogenous' }] : [],
      missingAdducts: rank === 1 ? ['[M+K]+'] : [],
    })
    const rows = [
      annotation(1, 1, 'D-Glucose', 180.0631, '[M+H]+'),
      annotation(2, 2, 'D-Fructose', 180.0633, '[M+H]+'),
      annotation(3, 3, 'Linoleic acid', 279.2329, '[M-H]-'),
      annotation(4, 4, 'Phosphatidylcholine PC(32:0)', 734.5694, '[M+H]+'),
      annotation(5, 5, 'Sphingomyelin SM(d18:1/18:0)', 731.6061, '[M+H]+'),
      annotation(6, 6, 'Cholesterol', 369.3516, '[M+H-H2O]+'),
      annotation(7, 7, 'Trehalose', 341.1084, '[M+H]+'),
      annotation(8, 8, 'Glutathione', 307.0838, '[M+H]+'),
      annotation(9, 9, 'Adenosine triphosphate', 506.995, '[M-H]-'),
      annotation(10, 10, 'Citric acid', 191.0197, '[M-H]-'),
      annotation(11, 11, 'Glutamine', 145.0614, '[M-H]-'),
      annotation(12, 12, 'Oleic acid', 281.2486, '[M-H]-'),
    ]
    providers.registerContextProviders({
      pageHeader: () => ({ datasetName: 'mouse-brain-example', status: 'completed' }),
      datasetInfo: () => ({
        attrs: {
          name: 'mouse-brain-example',
          filename: 'mouse-brain-example.imzML',
          spectrum_count_num: width * height,
          analyzer: 'timsTOF fleX',
          ionisation_source: 'MALDI-2',
          polarity: 'Positive',
          organism: 'Mouse (Mus musculus)',
          organism_part: 'Brain',
          sample_stabilization: 'Fresh frozen',
          maldi_matrix: 'DHB (2,5-Dihydroxybenzoic acid)',
          spectrum_mode: 'centroid',
          storage_mode: 'continuous',
        },
        acquisition: { analyzer: 'timsTOF fleX', ionisation_source: 'MALDI-2', polarity: 'Positive' },
        sourceFile: {
          filename: 'mouse-brain-example.imzML',
          organism: 'Mouse (Mus musculus)',
          organism_part: 'Brain',
          condition: 'Control',
          raw: { filename: 'mouse-brain-example.imzML', organism: 'Mouse (Mus musculus)', organism_part: 'Brain' },
        },
        methods: ['baseline removal', 'peak picking (centroid)'],
        displayRange: { globalMin: 0, globalMax: 1620, displayMin: 0, displayMax: 900 },
        imageInfo: { pixels: '3072', nonZero: '2901', totalIon: '1.2e6', pixelSize: '50 × 50 µm' },
      }),
      selectedIon: () => {
        const mz = 744.5252
        const tolerance = 0.01
        return {
          ...matrixFor(mz, tolerance),
          view: {
            mz,
            tolerance,
            dataMode: 'continuous' as const,
            display: {
              colormap: 'viridis',
              intensityScale: 'linear',
              gamma: 1,
              displayMin: 0,
              displayMax: 900,
              globalMin: 0,
              globalMax: 1620,
            },
            spectrum: { view: 'mean' as const, selectedPixel: null },
            roi: { confirmed: 2, selected: 1 },
            masks: { imported: 0 },
          },
        }
      },
      annotations: () => ({
        count: rows.length,
        rows: () => rows,
        panelRows: () => rows,
        weights: { mass: 0.6, adduct: 0.1, spatial: 0.3 },
        panel: () => ({
          summary: {
            totalIons: rows.length,
            annotated: rows.length,
            fdr: '5%',
            library: 'HMDB',
            runtimeMs: 1200,
          } as never,
          conditions: {
            tolValue: 10,
            tolUnit: 'ppm' as const,
            cutPct: 0,
            spatialPct: 50,
            polarityOverride: null,
            adductOverrides: {},
            scoreRatio: { mass: 0.6, adduct: 0.1, spatial: 0.3 },
          },
          filters: {
            qLevel: 'all' as const,
            adductFilter: [],
            siblingsOnly: false,
            moleculeFilter: null,
            searchQuery: '',
            sortKey: 'total',
            sortReverse: false,
          },
          visibleRows: rows.length,
          runState: 'done',
          dbInfo: { label: 'HMDB', count: 114000 },
          peakStats: { axis: 44, nonZero: 42, kept: 44 },
        }),
      }),
      kmeans: () => ({
        k: 5,
        clusterSizes: [812, 903, 604, 377, 376],
        selectedIds: [0, 2],
        view: {
          clusters: [
            { id: 0, color: [31, 119, 180] as [number, number, number], count: 812 },
            { id: 1, color: [255, 127, 14] as [number, number, number], count: 903 },
            { id: 2, color: [44, 160, 44] as [number, number, number], count: 604 },
            { id: 3, color: [214, 39, 40] as [number, number, number], count: 377 },
            { id: 4, color: [148, 103, 189] as [number, number, number], count: 376 },
          ],
          labelsAvailable: true,
          computing: false,
          visible: true,
          labels: () => new Int32Array(Array.from({ length: width * height }, (_, i) => (i * 5) % 5)),
          rgb: () => new Uint8Array(Array.from({ length: width * height * 3 }, (_, i) => (i * 37) % 256)),
          dims: () => ({ width, height }),
        },
      }),
      umap: () => ({
        ready: true,
        visible: true,
        computing: false,
        error: null,
        grid: { width: 32, height: 24 },
        rgb: () => new Uint8Array(32 * 24 * 3).fill(255),
        occupancyMask: () => new Uint8Array(32 * 24).fill(1),
      }),
    })
    // 选中像素：供 get_pixel_spectrum 的无参路径与显式 x/y 一致
    ;(zarr as unknown as { pixelSpectrum: { value: unknown } }).pixelSpectrum.value = {
      pixelIndex: 15 * width + 18,
      x: 19,
      y: 16,
      mz: mzAxis,
      intensity: new Float32Array([ions[0]![15 * width + 18]!, ions[1]![15 * width + 18]!, 13]),
    }

    // 平均谱的真实形态：meanChartData 是全轴的 [mz, intensity]（谱图区的原始数据），
    // meanSpectrumRef 是平均谱强度——两者同索引、共享离子图的 m/z 轴。
    const meanIntensity = new Float32Array([2400.5, 1500, 640.25])
    ;(zarr as unknown as { meanSpectrumRef: { value: Float32Array | null } }).meanSpectrumRef.value =
      meanIntensity
    zarr.meanChartData.value = [...mzAxis].map((mz, i) => [mz, meanIntensity[i]!] as [number, number])
  })

  await settle(page)

  // 真实组合表 + 真实会话服务；页面类工具通过 goto 读该页真实状态。
  const dom = await page.evaluate(async () => {
    const { whenAgentReady } = await import('/src/features/agent/bootstrap.ts')
    const session = await import('/src/features/agent/plugins/session-persistence/index.ts')
    const llmAnthropic = await import('/src/features/agent/plugins/llm-anthropic/index.ts')
    const ctx = await whenAgentReady()
    const storage = session.createMemoryStorage()
    const events: unknown[] = []
    const state = globalThis as unknown as {
      __cap: {
        tools: { execute(call: unknown): Promise<unknown> }
        attachments: {
          saveTools(
            storage: unknown,
            images: unknown[],
            signal: AbortSignal,
          ): Promise<
            { id: string; mime: string; bytes: number; width: number; height: number; label?: string }[]
          >
          hydrate(storage: unknown, messages: unknown[]): Promise<unknown[]>
        }
        storage: unknown
        session: { storage: unknown; events: unknown[] }
        skills: () => string[]
        state: () => Record<string, unknown>
        pixel: () => { x: number; y: number }
        /** 按真实事件流水线重放一次工具调用，拿到历史消息与协议层 tool_result */
        chat: (input: {
          id: string
          tool: string
          args: unknown
          result: {
            content: string
            isError: boolean
            fullContent?: string
            maxResultChars?: number
            attachments: unknown[]
          }
        }) => Promise<{ messages: unknown[]; shape: unknown; archiveId?: string }>
      }
    }
    state.__cap = {
      tools: ctx.tools,
      attachments: ctx.attachments,
      storage,
      // 工具只读 session.storage（存档/附件）与 session.events（turn/start 绑定离子）
      session: { storage, events },
      skills: () => ctx.skills.catalog().map((skill) => skill.name),
      state: () => ({}),
      pixel: () => ({ x: 1, y: 1 }),
      chat: async ({ id, tool, args, result }) => {
        // 与 AgentLoop 同序：运行时结果 → agent/tool-result waterfall（tool-archive 在此
        // 写全文存档、必要时把正文换成截断桩）→ 工具消息 → 发请求前的图片还原。
        const stored = (await ctx.waterfall(
          'agent/tool-result',
          { session: state.__cap.session, signal: new AbortController().signal, result },
          async () => ({ content: result.content, attachments: result.attachments }),
        )) as { content: string; attachments?: unknown[]; isError?: boolean; archiveId?: string }
        const transcript = [
          {
            role: 'assistant',
            parts: [
              { type: 'tool-call', id, name: tool, arguments: JSON.stringify(args) },
            ],
          },
          {
            role: 'tool',
            toolCallId: id,
            name: tool,
            content: stored.content,
            isError: stored.isError ?? result.isError,
            ...(stored.attachments?.length ? { attachments: stored.attachments } : {}),
          },
        ]
        const hydrated = await state.__cap.attachments.hydrate(state.__cap.session.storage, transcript)
        return {
          messages: hydrated,
          shape: llmAnthropic.toModelMessages(hydrated as never, 'verbatim'),
          ...(stored.archiveId ? { archiveId: stored.archiveId } : {}),
        }
      },
    }
    return ctx.tools.list().map((def) => def.name)
  })
  if (!dom.includes('get_page')) throw new Error(`Agent not bootstrapped: ${dom.join(', ')}`)

  // 页面上下文与实际可读像素：先读共享 zarr 状态（不含大矩阵）
  await page.evaluate(async () => {
    const zarr = await import('/src/services/zarr/zarrSharedState.ts')
    const cap = (globalThis as unknown as { __cap: Record<string, unknown> }).__cap
    cap.state = () => {
      const shared = zarr.getSharedZarrContext()
      const axis = zarr.mzAxisRef.value
      const mean = zarr.meanSpectrumRef.value
      const d1 = zarr.meanChartData.value
      // 均值谱可能有自己的 m/z 轴（meanChartData），与离子轴不是一回事
      const peaks = mean && d1.length === mean.length
        ? [...d1].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([mz]) => mz)
        : []
      return {
        dataMode: shared.dataMode,
        ionShape: shared.ionShape,
        mzAxis: axis ? [...axis] : [],
        meanSpectrumMzs: peaks,
        meanChartDataLength: d1.length,
        ticLoaded: zarr.ticMatrix.value != null,
      }
    }
    cap.pixel = () => {
      const ps = zarr.pixelSpectrum.value
      return ps ? { x: ps.x, y: ps.y, pixelIndex: ps.pixelIndex } : { x: 1, y: 1, pixelIndex: 0 }
    }
  })

  const pageContext = (await page.evaluate(() =>
    (globalThis as unknown as { __cap: { state: () => Record<string, unknown> } }).__cap.state(),
  )) as Record<string, unknown>

  const capture = async (entry: Omit<Capture, 'model'> & { args: Record<string, unknown> }) => {
    const raw = await page.evaluate(
      async ({ tool: target, args, id }) => {
        const tool = target
        const cap = (
          globalThis as unknown as {
            __cap: {
              tools: { execute(call: unknown): Promise<unknown> }
              attachments: {
                saveTools(
                  storage: unknown,
                  images: unknown[],
                  signal: AbortSignal,
                ): Promise<
                  { id: string; mime: string; bytes: number; width: number; height: number; label?: string }[]
                >
              }
              storage: unknown
              session: unknown
              chat: (input: unknown) => Promise<{ messages: unknown[]; shape: unknown; archiveId?: string }>
            }
          }
        ).__cap
        const result = (await cap.tools.execute({
          callId: id,
          name: tool.startsWith('harness:') ? tool.split(':')[1] : tool,
          arguments: args,
          signal: new AbortController().signal,
          // harness: 前缀 = 不传 session，让 renderBatch 走「整项正文 + 运行时归档」分支
          ...(tool.startsWith('harness:') ? {} : { session: cap.session }),
        })) as {
          isError: boolean
          error?: { message: string }
          content: string
          fullContent?: string
          images?: { label?: string; mime: string; width: number; height: number }[]
          maxResultChars?: number
        }
        // 运行时链路：工具图先经 attachments.saveTools 存进会话存储（校验 MIME/尺寸 ≤2MB），
        // 历史里只留附件引用，发请求前再还原成 data URL 放进 tool_result。
        const images: {
          label?: string
          mime: string
          width: number
          height: number
          bytes: number
          dataUrl: string
        }[] = []
        let attachments: unknown[] = []
        if (result.images?.length) {
          const refs = await cap.attachments.saveTools(
            cap.storage,
            result.images,
            new AbortController().signal,
          )
          attachments = refs
          const storage = cap.storage as { getArtifact(id: string): Promise<Blob> }
          for (const [index, ref] of refs.entries()) {
            const blob = await storage.getArtifact(ref.id)
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result))
              reader.onerror = () => reject(reader.error)
              reader.readAsDataURL(blob)
            })
            images.push({ ...result.images[index]!, bytes: ref.bytes, dataUrl })
          }
        }
        // 历史 + 协议层形态：走真实 waterfall/存档/图片还原与 llm-anthropic 转换
        const wire = await cap.chat({
          id,
          tool: tool.startsWith('harness:') ? tool.split(':')[1] : tool,
          args,
          result: {
            content: result.content,
            isError: result.isError,
            ...(result.fullContent != null ? { fullContent: result.fullContent } : {}),
            ...(result.maxResultChars != null ? { maxResultChars: result.maxResultChars } : {}),
            attachments,
          },
        })
        return {
          isError: result.isError,
          error: result.error?.message,
          content: result.content,
          truncated: result.fullContent != null,
          maxResultChars: result.maxResultChars,
          images,
          wire,
        }
      },
      { tool: entry.tool, args: entry.args, id: entry.id },
    )

    const model: Capture['model'] = {
      text: raw.content,
      textChars: raw.content.length,
      ...(raw.truncated ? { truncated: true } : {}),
      ...(raw.maxResultChars != null ? { maxResultChars: raw.maxResultChars } : {}),
    }
    if (raw.images.length) {
      model.images = []
      for (const [index, image] of raw.images.entries()) {
        const match = /^data:(image\/(?:png|jpeg));base64,(.*)$/s.exec(image.dataUrl)!
        const ext = match[1] === 'image/png' ? 'png' : 'jpg'
        const file = `images/${entry.id}-${index + 1}.${ext}`
        await mkdir(join(OUT, 'images'), { recursive: true })
        const bytes = Buffer.from(match[2]!, 'base64')
        await writeFile(join(OUT, file), bytes)
        model.images.push({
          label: image.label,
          mime: image.mime,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
          file,
          // 运行时与 llm-anthropic 适配器：工具图包进 tool_result 的 content 数组，形如
          // { type: 'file', data: { type: 'data', data: '<base64>' }, mediaType }
          modelBlock: {
            type: 'file',
            mediaType: image.mime,
            dataSegments: [{ type: 'data', bytes: bytes.byteLength }],
          },
        })
      }
    }
    captures.push({
      ...entry,
      context: { ...datasetContext, ...entry.context },
      ...(raw.isError ? { error: raw.error ?? 'error' } : {}),
      model,
      wire: slimWire(raw.wire),
      ...(raw.wire.archiveId ? { archiveId: raw.wire.archiveId } : {}),
    })
    return raw
  }

  // ---- 页面类：真实 vizworkbench 状态（任务开始时注入的示例数据集） ----
  /** 每页共用的数据集上下文：让读者知道这些端口数字出自哪份数据 */
  const datasetContext = {
    data:
      'stub mouse-brain — continuous, 64×48 px, 3 m/z on the ion axis ' +
      '(180.0634 / 744.5252 / 796.5854); mean spectrum 150–1047 with 3 tall peaks; ' +
      'selected ion 744.5252 @ ±0.01 Da; 12 annotation rows; k=5 KMeans; UMAP ready',
    note: '这些页面类是经 page.evaluate 注入的确定性问题实例：工具代码、注册表、渲染与截断链路都是真实的，只有数据是注入的。',
  }
  // 提问时绑定：turn/start 事件里的捕获离子 —— get_page / get_ion_image 的默认目标依赖它
  await page.evaluate(() => {
    const cap = (globalThis as unknown as { __cap: { session: { events: unknown[] } } }).__cap
    cap.session.events.push({
      type: 'turn/start',
      turnId: 'capture',
      binding: { page: { selectedIon: { mz: 744.5252, tolerance: 0.01 } } },
    })
  })

  const pageNotes: Record<string, string> = {
    get_page: '页面整体快照：header/dataset/ion/kmeans/umap/annotation 预览，附图 = 提问时捕获的离子。',
    get_dataset: '数据集信息面板整体（zarr attrs 全量透传 + 采集/源文件/方法/显示范围/图像统计）。',
    get_ion: '选中离子视图 + 按当前显示参数重渲染的离子栅格（非画布截图）。',
    get_annotation: '默认窗口 rank 1–10 + 注释面板状态头；一行 = 一个加合离子。',
    get_mean_spectrum_top_peaks: '均值谱按强度降序的默认窗口（仅 continuous 模式）。',
    get_ion_image: '无参数：绘制提问时捕获的离子 + 每目标定量统计。',
  }
  for (const tool of Object.keys(pageNotes)) {
    await capture({ id: tool, group: 'page', tool, note: pageNotes[tool], args: {} })
  }

  // 像素谱：显式按采集坐标读（不改动页面选择）
  const pixel = await page.evaluate(() =>
    (globalThis as unknown as { __cap: { pixel: () => { x: number; y: number } } }).__cap.pixel(),
  )
  await capture({
    id: 'get_pixel_spectrum',
    group: 'page',
    tool: 'get_pixel_spectrum',
    note: [
      '显式 x/y（1 起采集坐标）读取单像素谱的默认 rank 1–10 窗口。',
      '附图是一张全谱棒图：灰格=全谱，橙色=本窗口的峰；图的上沿标 m/z 范围与最大强度。',
      '文本与图在同一个 tool_result 里，模型先读 JSON 再看图。',
    ],
    args: { x: pixel.x, y: pixel.y },
  })

  // 多目标：3 个 m/z（数据集离子轴上的真实值）→ 各自独立图、共享色阶便于对比
  await capture({
    id: 'get_ion_image-mzs',
    group: 'page',
    tool: 'get_ion_image',
    note: [
      '显式传 3 个 m/z（mzs）：每个目标一张独立 PNG，共用同一色阶（normalize=shared），便于横向比较。',
      '每张图上都烧了标签「#n m/z …」，正文里的 summaries 与图一一对应。',
      '超过 4 个目标会拼成 montage；选择器 mz/mzs/rowIds 互斥。',
    ],
    args: { mzs: ['180.0634', '744.5252', '796.5854'].map(Number) },
  })

  await capture({
    id: 'get_ion_image-turn-start',
    group: 'page',
    tool: 'get_ion_image',
    note: [
      '不带选择器：目标是提问时（turn/start 绑定）捕获的离子，而不是此刻页面选中的离子。',
      '本轮里页面中途换过离子也仍用捕获值——这是「提问时快照」语义。',
    ],
    args: {},
  })

  // 叠加类：页面没算 KMeans/UMAP 时，输出就是「不可用」提示，照原样记
  for (const tool of ['get_kmeans', 'get_umap']) {
    await capture({
      id: tool,
      group: 'page',
      tool,
      note:
        tool === 'get_kmeans'
          ? [
              'get_kmeans：簇列表（颜色/像素数/选中态）与就绪/计算状态，正文末尾带 imageAttached: true。',
              '附图是透明背景的叠加 PNG：只画选中的簇，底部色图例给出簇 id 与像素数。',
            ]
          : [
              'get_umap：ready/visible/computing/error 与栅格尺寸，正文末尾带 imageAttached: true。',
              '附图是透明背景的 UMAP 叠加 PNG；前景由嵌入坐标的占用掩膜决定，不看颜色。',
            ],
      args: {},
    })
  }

  // ---- 化学/生物/文献/文件：真实网络 ----
  const external: (Omit<Capture, 'model'> & { args: Record<string, unknown> })[] = [
    { id: 'pubchem-compound', group: 'chemistry', tool: 'pubchem_compound_lookup', args: { name: 'glucose' },
      note: [
      '按名称查 PubChem 属性，返回紧凑的 key: value 行（不是 JSON）。',
      '末尾的 page/source 是可直接引用的官方 CID 链接；名称命中 ≠ 身份确认。',
    ] },
    { id: 'pubchem-formula', group: 'chemistry', tool: 'pubchem_formula_search', args: { formula: 'C6H12O6', maxResults: 3 },
      note: [
      '按分子式检索候选：先报 total_matches，再列 ≤maxResults 条（cid | formula | 质量 | InChIKey | 官方页）。',
      '候选列表只枚举，不做加合物判断；无命中会抛错而不是返回空表。',
    ] },
    { id: 'chebi', group: 'chemistry', tool: 'chebi_lookup', args: { query: 'glucose', maxResults: 3 },
      note: [
      'ChEBI 本体检索（EBI OLS4）：每条是「标签 (CHEBI:id) | page | syn: …」加上定义摘录。',
      '结果按 OLS4 相关性排序，第一条不保证是查询分子本身。',
    ] },
    { id: 'kegg-find', group: 'biology', tool: 'kegg_find', args: { query: 'glucose', db: 'compound', limit: 3 },
      note: [
      'KEGG 关键词检索：返回 JSON {query, window, entries:[{id,name}]} + 实时来源行。',
      'window 是完整结果集的零基分页窗口；limit 只是页大小，不是总量上限。',
    ] },
    { id: 'kegg-compound', group: 'biology', tool: 'kegg_compound', args: { id: 'C00031' },
      note: [
      '按 C 编号取官方条目：names / formula / exact_mass / mol_weight / pathways / dblinks，全用 Markdown 链接。',
      '这是身份核验的首选：对照 formula 与 exact_mass，而不是信关键词排名。',
    ] },
    { id: 'kegg-pathway', group: 'biology', tool: 'kegg_pathway', args: { id: 'map00010', limit: 3 },
      note: [
      '通路的 NAME / CLASS / DESCRIPTION 摘录 + 成员化合物窗口（每通路独立分页）。',
      '只接受 map 编号；hsa 等 organism 编号会被拒。',
    ] },
    { id: 'kegg-mass', group: 'biology', tool: 'kegg_mass_search', args: { mz: 180.0634, polarity: 'positive', ppm: 10, limit: 3 },
      note: [
      '按观测 m/z 的加合物感知搜索：JSON {queryMz, polarity, window, matches:[…]}。',
      'matches 已按 |Δppm| 排序并用条目 EXACT_MASS 复核过，每项带 adduct 与 deltaPpm。',
    ] },
    { id: 'hmdb', group: 'biology', tool: 'hmdb_lookup', args: { id: 'HMDB0000122' },
      note: [
      'HMDB 归档 XML 档案，输出按 HMDB 页面的分区标签逐行给出（Record Information / Metabolite Identification / Taxonomy / Role / Biological Properties / Concentrations / External Links）。',
      'description 按句界截断到 1000 字符；最后四行 page/snapshot/archive/source 是工具自己的出处标注。',
    ] },
    { id: 'pubmed', group: 'literature', tool: 'pubmed_search', args: { query: 'mass spectrometry imaging lipidomics', maxResults: 2 },
      note: [
      'PubMed：total_hits + 每条「标题 / 期刊 年份 | PMID | 链接」，没有摘要正文。',
      '需要摘要时改用 europepmc_search。',
    ] },
    { id: 'europepmc', group: 'literature', tool: 'europepmc_search', args: { query: 'mass spectrometry imaging lipidomics', maxResults: 2 },
      note: [
      'Europe PMC：每条 title / journal year / 标识符 + abstract 摘录（≤600 字符），OA 且有 PMCID 时附全文链接。',
      '这一轮出现了真实超时（工具默认 15s）：正文只有一行 "Tool execution timed out after 15000ms"，没有部分结果。',
    ] },
    { id: 'openalex', group: 'literature', tool: 'openalex_search', args: { query: 'mass spectrometry imaging lipidomics', maxResults: 2 },
      note: [
      'OpenAlex：每条「标题 / 来源 年份 | 类型 | doi | cited by N」+ OA 链接。',
      '被引数是发现线索，不是质量结论。',
    ] },
    { id: 'web-search', group: 'web', tool: 'web_search', args: { query: 'KEGG REST API documentation find compound', maxResults: 2 },
      note: [
      'Exa 公网检索：若干「Title / URL / Published / Excerpt」块，末尾附一段给模型的引用格式提醒与「摘录不是整页」的警告。',
      '这段提醒是工具输出的一部分（模型能看到），不是本文件的注释。',
    ] },
    { id: 'list-files', group: 'files', tool: 'list_files', args: { page: 1, size: 2 },
      note: [
      '公开数据集列表：一行表头 total | page + 每行「public_id | 文件名 | 大小 | 日期 | 状态」。',
      '离线夹具里没有数据集，所以这里是 total: 0 / (empty)；格式与真实部署一致。',
    ] },
    { id: 'list-my-files', group: 'files', tool: 'list_my_files', args: { page: 1, size: 2 },
      note: [
      '当前用户上传的数据集列表（需登录），格式同 list_files。',
      '离线夹具里该用户暂无文件，因此显示 (empty)。',
    ] },
    { id: 'file-metadata', group: 'files', tool: 'get_file_metadata', args: { fileId: 'E2eDataset0000001' },
      note: [
      '按 public_id 取数据集元数据：一层 key: value 摘要（≤30 字段、单值 ≤120 字符）。',
    ] },
    { id: 'list-my-processes', group: 'files', tool: 'list_my_processes', args: { page: 1, size: 2 },
      note: [
      '当前用户的分析任务：#id | 类型/算法 | 状态 | 创建时间，分页。',
      '离线夹具里没有任务，因此 (empty)。',
    ] },
    { id: 'user-quota', group: 'files', tool: 'get_user_quota', args: {},
      note: [
      '存储/处理配额的一层字段摘要（≤20 字段）。',
      '离线夹具配额对象为空，所以模型收到的是空字符串——这也是真实可能的输出形态。',
    ] },
  ]
  for (const entry of external) await capture(entry)

  // ---- 系统类：读存档（先制造一次被截断的结果）+ 加载技能 ----
  const batch = await capture({
    id: 'hmdb-batch',
    group: 'biology',
    tool: 'hmdb_lookup',
    args: { ids: ['HMDB0000122', 'HMDB0000123'], limit: 2 },
    note: [
      '批量 id（ids）：两项各取一次归档 XML，按输入顺序用「### id」分节拼接；整个批次一个 tool_result。',
      'HMDB0000123 在归档里没有快照，那一项就如实写 "No archived snapshot"，不会变成整批失败。',
      '批量预算见 EVIDENCE_BATCH_BUDGET；单批超过 11.7k 字符才会触发行内预览 + 存档指针。',
    ],
  })
  // agent/tool-result 中间件为每次成功结果都写一份存档；read_archived_result 读的就是它
  const archiveId = (batch.wire?.archiveId as string | undefined) ?? undefined
  if (archiveId)
    await capture({
      id: 'read-archived-result',
      group: 'system',
      tool: 'read_archived_result',
      args: { archiveId },
      note: [
        'read_archived_result：用 archiveId 取回存档原文，每次 ≤12k 的窗口 + 末尾续读脚注。',
        '本次存档 7149 字符，一页读完，所以脚注是 [end of archived result …]。',
        '注意：它只读存档、不重跑原工具；本文件里的 archiveId 只在抓取那一刻有效。',
      ],
    })
  const skills = (await page.evaluate(() =>
    (globalThis as unknown as { __cap: { skills: () => string[] } }).__cap.skills(),
  )) as string[]
  if (skills.length) {
    await capture({
      id: 'skill',
      group: 'system',
      tool: 'skill',
      args: { name: skills[0]! },
      note: [
        'skill：按名称返回该技能的完整 SKILL.md 正文（Markdown，单工具上限 12k）。',
        '技能目录本身在 system prompt 里，模型据此决定加载哪一个。',
      ],
    })
  }

  const committed = [...captures]
  // 页面类工具都必须真的拿到数据（否则抓到的是「不可用」提示，不是模型实际会看到的输出）
  for (const entry of committed.filter((c) => c.group === 'page'))
    if (entry.error || /is not available|unavailable/i.test(entry.model?.text ?? ''))
      throw new Error(`${entry.id} captured an unavailable-data placeholder: ${entry.model?.text}`)

  await writeFile(join(OUT, 'tool-outputs.json'), JSON.stringify(buildDocument(committed, pageContext), null, 2))
  console.log(`captured ${committed.length} tool outputs -> ${join(OUT, 'tool-outputs.json')}`)
})
