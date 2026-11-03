/**
 * 浏览器存储（localStorage / sessionStorage）键名统一常量。
 *
 * 收口所有存储键的字符串字面量，避免在多个文件里手写、拼写不一致导致读写不到一起。
 */

/** localStorage 键名 */
export const STORAGE_KEYS = {
  /** 登录令牌 */
  accessToken: 'access_token',
  /** 用户信息 */
  userDetails: 'user_details',
  /** 主题（'light' | 'dark'） */
  theme: 'theme',
  /** 界面语言（'en' | 'zh-CN'）；未设置时按浏览器语言探测，见 shared/composables/useLocale.ts */
  locale: 'locale',
  /** GitHub 提交热力图缓存「前缀」；实际键为 前缀 + `owner/repo|branch|days`（见 features/home/api/githubApi.ts） */
  githubCommitHeatmap: 'gh-commit-heatmap:',
  /** Agent connection credentials and model catalog preferences. */
  agentConnection: 'assistant_connection',
  agentModelCatalog: 'assistant_model_catalog',
  agentModelLimits: 'assistant_model_limits_v1',
  /** 注释面板的容差 / 加合物开关 / 极性「前缀」；实际键为 前缀 + runId（见 vizworkbench/composables/useAnnotation.ts） */
  annotationSettings: 'annotation-settings:',
} as const

/**
 * sessionStorage 键名 —— 用于验证码发送次数计数（见 useCountdown），
 * 仅在当前会话内有效，关闭标签页即清空。
 */
export const SESSION_KEYS = {
  /** 注册页验证码尝试次数 */
  registerCodeAttempts: 'register_code_attempts',
  /** 个人资料页邮箱验证码尝试次数 */
  profileEmailCode: 'profile_email_code',
  /** 忘记密码页验证码尝试次数 */
  forgotPasswordCodeAttempts: 'forgot_password_code_attempts',
} as const
