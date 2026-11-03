/**
 * assistant 模块的默认常量（token 预算、步数上限、历史条数等）。
 *
 * 与人类可编辑的运行时配置（public/config.json 的 llm 块）和部署环境变量
 * （env/ 的 VITE_LLM_*）职责不同：这里是「写死在代码里的工程常量」。
 */

/** localStorage 中保留的最近对话条数（不含 system/context）。
 *  完整历史（含工具调用/推理）持久化在 OPFS（utils/opfsStore.ts）。 */
export const MAX_HISTORY_MESSAGES = 20

/** 内存/UI 中保留的最大消息条数；更早的仍在 OPFS 会话文件中（loadEarlier 取回） */
export const MAX_UI_MESSAGES = 100

/** 回喂模型的历史字符预算：超出后从最旧开始把超长 tool 结果替换为
 *  OPFS 存根（read_archived_result 可取回全文） */
export const HISTORY_CHAR_BUDGET = 60_000

/** 单次模型调用的输出上限。思考也计入这个上限，所以不能给小 */
export const MAX_OUTPUT_TOKENS = 64_000

/** 一张图片占用的历史字符预算。模型按尺寸而不是 base64 长度计费，单张约几千 token */
export const IMAGE_HISTORY_COST = 8_000

/** 单 turn 内 LLM step 上限（防工具回环死循环） */
export const MAX_AGENT_STEPS = 8

/** ---- 自动 Compact（上下文主动压缩）----
 *  trimHistory 是被动兜底（超预算把旧内容截断成存根，丢细节）；compact 是
 *  主动一步到位：turn 边界（send 内、推入新 user 前）历史总量超过
 *  COMPACT_TRIGGER_CHARS 时，先让模型把整段对话总结成结构化摘要，再用
 *  「压缩标记 user + 摘要 assistant」两条消息替换全部旧历史。阈值刻意低于
 *  HISTORY_CHAR_BUDGET——compact 成功则永远走不到 trim 的粗暴截断；
 *  compact 失败（网络/空流）则照旧走 trimHistory 兜底。 */
export const COMPACT_TRIGGER_CHARS = 40_000
/** compact 摘要请求的输出上限。摘要本身由提示词限制在 2000 token 内，
 *  思考也计入这个上限，给小了可能只有思考没有正文 */
export const COMPACT_SUMMARY_MAX_TOKENS = 8_000

/** 单个工具返回文本的最大字符数（超出截断） */
export const TOOL_RESULT_CHARS = 2000

/** 界面上展示的工具结果摘要字符数 */
export const TOOL_PREVIEW_CHARS = 1200

/** read_archived_result 单次返回的窗口字符数（超出经 offset 翻页取回） */
export const ARCHIVE_WINDOW_CHARS = 8000

/** 历史字符预算吃紧时，超长 tool 结果压缩成存根保留的前缀字符数；
 *  压缩前全文写入 OPFS 存档（read_archived_result 按 tool_call_id 取回） */
export const TOOL_STUB_KEEP = 500

/** 工具执行超时（ms） */
export const TOOL_TIMEOUT_MS = 15000

/** 大矩阵统计采样像素数（等距抽样后排序取分位数） */
export const STATS_SAMPLE_PIXELS = 10000

/** 平均谱 / 注释默认返回的 top 条目数 */
export const DEFAULT_TOP_N = 10
/** topN 参数上限 */
export const MAX_TOP_N = 20

/** 批量查询工具单次接受的最多查询数（数组参数 maxItems，超出静默截断） */
export const MAX_BATCH_QUERIES = 25
