/** 提问的词汇：服务、工具、投影和界面共用 */

/** 一个选项。label 原样作为回答；推荐项在 label 末尾带 `(Recommended)` */
export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  id: string
  question: string
  /** 简短的小标题，如「确认」「选择模式」 */
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

/**
 * 一道题的回答。selected 是选中的选项原标签；custom 是自由文本，单选时取代选项，
 * 多选时补充选项；两者都为空表示用户跳过了这道题。
 */
export interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
  /** 不是用户选的：到点时按推荐项自动填入，或没有推荐项而记为跳过 */
  auto?: true
}

/** 工具返回给模型的一批回答，每道题一条，按提问顺序 */
export interface AnswerBatch {
  /** 用户没有在时限内提交，整批是自动提交的 */
  timedOut?: true
  answers: QuestionAnswer[]
}

/** 卡片上一道题的草稿 */
export interface QuestionDraft {
  selected: string[]
  custom: string
  skipped: boolean
  /** 用户动过这道题；没动过的题到点时按推荐提交并标 auto */
  touched: boolean
}

/** 正在等待回答的一次提问 */
export interface PendingQuestion {
  sessionId: string
  callId: string
  questions: Question[]
  /** 自动提交的时间（epoch ms） */
  deadline: number
  timeoutMs: number
  drafts: QuestionDraft[]
}

/** 一次提问在对话里的记录，从会话日志折叠出来 */
export interface QuestionRecord {
  callKey: string
  turnId: string
  questions: Question[]
  /** waiting：等用户回答；answered：已有回答；unanswered：没回答这一轮就结束了 */
  state: 'waiting' | 'answered' | 'unanswered'
  answers?: QuestionAnswer[]
  timedOut?: true
}
