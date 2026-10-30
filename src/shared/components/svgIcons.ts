/**
 * 图标注册表：业务用的语义名 → Iconify 图标名（heroicons 集合）。
 * 抽成独立模块（而非塞在 SvgIcon.vue 里）是为了导出 {@link IconType} 联合类型，
 * 让任何传 `type` 的地方都能在编译期校验图标名（拼错即报错，而非静默回退问号）。
 *
 * 新增条目时记得同步把图标名加进 scripts/iconNames.mjs 并跑 `npm run icons:bundle`，
 * 否则运行时会因为本地缓存里没有这个图标而回退去请求 Iconify 公共 API。
 */
export const ICON_MAP = {
  user: 'heroicons:user',
  'user-circle': 'heroicons:user-circle',
  signin: 'heroicons:arrow-right-end-on-rectangle',
  link: 'heroicons:link',
  'document-text': 'heroicons:document-text',
  home: 'heroicons:home',
  research: 'heroicons:academic-cap',
  institution: 'heroicons:building-library',
  position: 'heroicons:map-pin',
  region: 'heroicons:globe-alt',
  'id-card': 'heroicons:identification',
  password: 'heroicons:lock-closed',
  email: 'heroicons:envelope',
  verify_code: 'heroicons:key',
  // Toast / status
  info: 'heroicons:information-circle',
  success: 'heroicons:check-circle',
  warning: 'heroicons:exclamation-triangle',
  error: 'heroicons:x-circle',
  // Common UI
  search: 'heroicons:magnifying-glass',
  chevron_down: 'heroicons:chevron-down',
  chevron_up: 'heroicons:chevron-up',
  chevron_left: 'heroicons:chevron-left',
  chevron_right: 'heroicons:chevron-right',
  plus: 'heroicons:plus',
  minus: 'heroicons:minus',
  pencil: 'heroicons:pencil',
  lasso: 'lucide:lasso',
  square: 'lucide:square',
  upload: 'heroicons:arrow-up-tray',
  download: 'heroicons:arrow-down-tray',
  refresh: 'heroicons:arrow-path',
  back: 'heroicons:arrow-left',
  share: 'heroicons:arrow-top-right-on-square',
  jump: 'heroicons:arrow-right-circle',
  trash: 'heroicons:trash',
  duplicate: 'heroicons:document-duplicate',
  layers: 'heroicons:square-3-stack-3d',
  check: 'heroicons:check',
  bolt: 'heroicons:bolt',
  sparkles: 'heroicons:sparkles',
  scale: 'heroicons:scale',
  close: 'heroicons:x-mark',
  photo: 'heroicons:photo',
  circle_stack: 'heroicons:circle-stack',
  queue_list: 'heroicons:queue-list',
  rectangle_stack: 'heroicons:rectangle-stack',
  squares_2x2: 'heroicons:squares-2x2',
  folder: 'heroicons:folder',
  users: 'heroicons:users',
  user_plus: 'heroicons:user-plus',
  bars3: 'heroicons:bars-3',
  sun: 'heroicons:sun',
  moon: 'heroicons:moon',
  settings: 'heroicons:cog-6-tooth',
  'paper-clip': 'heroicons:paper-clip',
  'code-bracket': 'heroicons:code-bracket',
  book: 'heroicons:book-open',
} satisfies Record<string, string>

/** 所有合法图标名的联合类型，供 SvgIcon 的 `type` 及各处图标字段引用 */
export type IconType = keyof typeof ICON_MAP
