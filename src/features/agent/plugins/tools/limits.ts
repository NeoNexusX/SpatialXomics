/** 查询类工具共用的上限 */

/** 平均谱 / 注释默认返回的 top 条目数 */
export const DEFAULT_TOP_N = 10
/** topN 参数上限 */
export const MAX_TOP_N = 20

/** 批量查询工具单次接受的最多查询数（数组参数的 maxItems，超出时参数校验报错） */
export const MAX_BATCH_QUERIES = 25

/**
 * 模型可见结果的字符上限。约束的不是上下文容量，而是每轮重发历史的边际成本与
 * 判据密度：工具输出进历史后每一轮都重发，长 dump 会线性累积延迟并稀释注意力。
 * 存档（read_archived_result）与分页游标仍是兜底，超限不丢证据。
 * 窗口可小到 MIN_CONTEXT_WINDOW，所以这里保留上限而不是取消。
 */
export const TOOL_RESULT_CHARS_DEFAULT = 16000
export const TOOL_RESULT_CHARS_EVIDENCE = 48000
