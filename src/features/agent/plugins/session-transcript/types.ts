import type { ImageAttachment, TokenUsage } from '../llm'

/** 界面上一条助手消息的内容块，顺序就是实际发生的顺序 */
export type UiPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; active: boolean }
  | {
      type: 'tool'
      id: string
      name: string
      input: unknown
      state: 'running' | 'done' | 'error' | 'stopped'
      preview: string
      attachments?: ImageAttachment[]
      images?: string[]
    }

/** UI 层对话条目 */
export interface UiChatItem {
  id: string
  role: 'user' | 'assistant'
  /** Display/copy text derived from the transcript. */
  content: string
  /** user 消息附带的图片（base64 dataURL） */
  images?: string[]
  attachments?: ImageAttachment[]
  /** 模型回复的内容块 */
  parts?: UiPart[]
  /** 流式进行中 */
  pending?: boolean
  /** 被用户中断 */
  interrupted?: boolean
  /** Compaction lifecycle marker in the UI transcript. */
  compacted?: boolean
  /** 错误态（可重试） */
  error?: string
  /** 正在等待重试这一步 */
  retrying?: { retry: number; maxRetries: number }
  /** Main-model attempt usage for this turn. Summary usage stays on compaction events. */
  usage?: TokenUsage
}
