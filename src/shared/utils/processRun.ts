/**
 * 处理任务（process run）的公共判定。
 *
 * 直转任务指 datasets 页「Explore」的一键 Zarr 可视化任务，由
 * POST /processes/raw-convert 创建，后端约定 params_json 固定为
 * `__RAW_CONVERT__`。工作台列表、计数与直转展示都依赖这个标记。
 */
export const RAW_CONVERT_MARKER = '__RAW_CONVERT__'

export function isDirectRun(paramsJson: string | null | undefined): boolean {
  return paramsJson === RAW_CONVERT_MARKER
}
