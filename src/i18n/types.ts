/**
 * i18n 的类型契约。
 *
 * **en 是 key 的唯一事实来源**：`locales/en/*.json` 的结构经 `typeof` 推导成
 * MessageSchema，再通过模块增强喂给 vue-i18n。于是 `t('common.action.save')` 的
 * key 会被逐段校验，拼错、用了不存在的命名空间，都在 `npm run type-check` 就报错，
 * 不必等到运行时看见页面上冒出一串裸 key。
 *
 * zh-CN 的键集合不参与类型推导（否则两边互相污染），改由 ESLint 的
 * `no-missing-keys-in-other-locales` 规则保证与 en 逐键对齐，见 eslint.config.ts。
 *
 * 新增一个命名空间时要同步改三处，缺一不可：
 *   1. 建 `locales/en/<ns>.json` 与 `locales/zh-CN/<ns>.json`，
 *      **文件内容的顶层键必须就是 <ns>**（见下方 MessageSchema 注释）
 *   2. 这里的 MessageSchema 交叉上这份文件的类型（决定 t() 认不认这个 key）
 *   3. i18n/index.ts 的 CORE_NS 或 FeatureNs 加一个成员（决定它什么时候被加载）
 */
import type enCommon from './locales/en/common.json'
import type enAuth from './locales/en/auth.json'
import type enDatasets from './locales/en/datasets.json'
import type enUsers from './locales/en/users.json'
import type enUpload from './locales/en/upload.json'
import type enCollections from './locales/en/collections.json'
import type enWorkspace from './locales/en/workspace.json'
import type enVizworkbench from './locales/en/vizworkbench.json'
import type enHome from './locales/en/home.json'
import type enDatabases from './locales/en/databases.json'

/**
 * 支持的界面语言。
 * en 同时承担 fallbackLocale：任何语言缺 key 都回退到它，因此 en 必须永远是全集。
 */
export type Locale = 'en' | 'zh-CN'

/**
 * 全量消息结构。
 *
 * 每份 json 自带命名空间顶层键（common.json 的内容形如 `{ "common": { ... } }`），
 * 所以这里是各文件类型的**交叉**，而不是再包一层 `{ common: ... }`。
 * 这个约定同时让 ESLint 插件直读文件时看到的 key 路径与运行时一致，见 index.ts 的 loadNs。
 *
 * 注意这里声明的是**全集**，而 feature 命名空间是随路由懒加载的——也就是说
 * 在 A 路由里写 B 路由的 key，TS 和 ESLint 都不会拦，但运行时可能查不到。
 * 约定：会出现在多个 feature 界面上的文案一律放 common（启动即加载），
 * feature 命名空间只放本 feature 独有的文案。
 */
export type MessageSchema = typeof enCommon &
  typeof enAuth &
  typeof enDatasets &
  typeof enUsers &
  typeof enUpload &
  typeof enCollections &
  typeof enWorkspace &
  typeof enVizworkbench &
  typeof enHome &
  typeof enDatabases

declare module 'vue-i18n' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 模块增强的固定写法，接口体必须为空
  export interface DefineLocaleMessage extends MessageSchema {}
}
