/** 连接的类型：端点协议、解析后的端点和连接 */

/** 端点协议，决定请求由哪个适配器发出。支持新协议时在这里加一项并注册对应的适配器插件。 */
export type EndpointType = 'anthropic'

/** 解析完成的端点：地址和密钥已确定，还没选模型 */
export interface ResolvedEndpoint {
  endpoint: EndpointType
  /** 规范化后的基地址，末尾带版本段，如 https://api.anthropic.com/v1 */
  baseUrl: string
  apiKey: string
  /** 凭据来自用户设置还是部署默认 */
  source: 'user' | 'deployment'
}

/** 可以直接发请求的连接 */
export interface ResolvedConnection extends ResolvedEndpoint {
  model: string
}
