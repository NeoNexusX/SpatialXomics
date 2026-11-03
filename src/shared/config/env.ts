/**
 * 构建/部署环境变量（唯一出口）。
 *
 * 仅保留「与部署环境、构建工具链相关」的地址类配置；这些在 `env/` 目录的
 * `.env` / `.env.development` / `.env.production` 中定义，由 Vite 在构建时注入（类型见 env.d.ts）。
 *
 * 应用偏好（名称、分页、验证码、下拉选项等「人来配置」的内容）已移至运行时
 * `public/config.json`，见 runtimeConfig.ts —— 两者职责不同，请勿混放。
 */
const env = import.meta.env

export const ENV = {
  /** 后端 API 基地址；开发环境经 vite proxy 转发到真实后端 */
  apiBase: env.VITE_API_BASE || '/api',
  /** OSS 加速域名（可选）；为空则使用默认 region 拼接 */
  ossEndpoint: env.VITE_OSS_ENDPOINT || '',
  /** 提供 /v1/messages 的中转站基地址；部署级默认，用户在助手里填了密钥后不再使用，两者皆空则助手不可用 */
  llmProxyUrl: env.VITE_LLM_PROXY_URL || '',
  /** 中转站共享子 key；会被打进前端包，不要放官方 API key；放 env/.env.*.local，不进 git */
  llmApiKey: env.VITE_LLM_API_KEY || '',
  /** 部署默认连接使用的模型名（用户设置 > config.json llm 块 > 此处） */
  llmModel: env.VITE_LLM_MODEL || '',
  /** 可选 Exa 搜索子 key；留空走官方 MCP 匿名额度，与模型密钥独立。 */
  exaApiKey: env.VITE_EXA_API_KEY || '',
} as const
