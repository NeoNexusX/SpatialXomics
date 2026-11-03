import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import pluginPlaywright from 'eslint-plugin-playwright'
import pluginVueI18n from '@intlify/eslint-plugin-vue-i18n'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  globalIgnores([
    '**/dist/**',
    '**/dist-ssr/**',
    '**/coverage/**',
    'docs/.vitepress/cache/**',
    'docs/.vitepress/dist/**',
    'dist-docs/**',
  ]),

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  
  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/__tests__/*'],
    rules: {
      ...pluginVitest.configs.recommended.rules,
      // 断言封装在辅助函数里（如 expectRoundTrip）时，规则默认只认 expect，
      // 需显式把这类函数名加入白名单，否则会误报 "Test has no assertions"。
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect*'] }],
    },
  },
  
  {
    ...pluginPlaywright.configs['flat/recommended'],
    files: ['e2e/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    rules: {
      ...pluginPlaywright.configs['flat/recommended'].rules,
      // 断言封装在 expectXxx 辅助函数里时（如 i18n-zh.spec.ts 的 expectLocalizedPage），同上放行
      'playwright/expect-expect': ['warn', { assertFunctionPatterns: ['^expect'] }],
    },
  },

  {
    name: 'app/architecture-boundaries',
    files: ['src/**/*.{ts,mts,tsx,vue}'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/components/*',
                '@/components/**',
                '@/composables/*',
                '@/composables/**',
                '@/utils/*',
                '@/utils/**',
                '@/stores/*',
                '@/stores/**',
                '@/types/*',
                '@/types/**',
                '@/constants/*',
                '@/constants/**',
              ],
              message:
                'Root-level frontend folders are deprecated. Import from @/shared/* or the owning @/features/* module instead.',
            },
          ],
        },
      ],
      'vue/block-lang': 'warn',
      'vue/multi-word-component-names': 'warn',
      'vue/no-mutating-props': 'warn',
    },
  },

  {
    // 字号只许用全局档位 kawaru-text-*（定义见 src/style.css）。
    // 禁掉两类旧写法：相对父级的 text-[Nem]（会逐层叠乘，同一个值在不同深度不一样大），
    // 以及 Tailwind 原生固定档位（不随基准流动，且在产物里排在档位之后会把档位吃掉）。
    // 正当例外（依赖 vh / 容器查询单位 cqi-cqw / 作为后代 em 参照的缩放单位）
    // 一律收进 style.css 的具名特例区，不在模板里裸写。
    name: 'app/typography-scale',
    files: ['src/**/*.vue'],
    rules: {
      'vue/no-restricted-class': [
        'error',
        '/^text-\\[[\\d.]+(em|rem|px)\\]$/',
        '/^text-(xs|sm|base|lg|xl|[2-9]xl)$/',
      ],
    },
  },

  {
    // 品牌字标内部「X 比其余字母大 1.2 倍」是排版比例，父级已是绝对档位，
    // 整条链确定、只有一级，不属于要消灭的叠乘。
    name: 'app/typography-scale-exceptions',
    files: [
      'src/app/components/PageNavbar.vue',
      'src/app/components/NavDrawer.vue',
      // 首页装饰场景：Hero 的基准含 9.5vh、Footer 斜率 12vw、
      // FeatureGallery 悬停词要跟容器宽度(cqw)走，等比档位都复刻不了。
      'src/features/home/components/HeroScene.vue',
      'src/features/home/components/FooterScene.vue',
      'src/features/home/components/FeatureGallery.vue',
      // shadcn-vue 组件和基于它们的 AI Elements 模式：text-sm 等已在 assistant-scope 内
      // 接到全局档位（见 features/assistant/assets/shadcn-bridge.css）。
      'src/features/assistant/components/ui/**/*.vue',
      'src/features/assistant/components/ai-elements/**/*.vue',
    ],
    rules: {
      'vue/no-restricted-class': 'off',
    },
  },

  // 预设把 languageOptions.ecmaVersion 标成了宽泛的 number，与 @vue/eslint-config-typescript
  // 要求的 EcmaVersion 字面量联合对不上。纯类型口径差异，配置本身合法，故在此收敛类型。
  ...(pluginVueI18n.configs['flat/recommended'] as Parameters<typeof defineConfigWithVueTs>),
  {
    /**
     * 这块**不能加 files**：flat config 的 settings 只对匹配到的文件生效，
     * 一旦限定成 ts/vue，语言包自己（.json）就拿不到 localeDir，
     * 插件会对每个 json 报「You need to set 'localeDir' at 'settings'」。
     */
    name: 'app/i18n-settings',
    settings: {
      'vue-i18n': {
        localeDir: {
          pattern: './src/i18n/locales/*/*.json',
          // 语言由**目录名**决定（文件名是命名空间，不是语言），必须显式声明，
          // 否则插件默认按文件名取语言，会把 common.json 当成一门叫 common 的语言。
          localeKey: 'path',
          localePattern: /^.*[/\\]locales[/\\](?<locale>[A-Za-z0-9-]+)[/\\].*\.json$/,
        },
        messageSyntaxVersion: '^11.0.0',
      },
    },
  },
  {
    name: 'app/i18n',
    files: ['src/**/*.{ts,mts,tsx,vue}'],
    rules: {
      /**
       * 全站界面文案已迁移完毕，设为 error 锁住成果：新写的裸文案会直接卡住 `lint:check`。
       * attributes 的键是标签名，必须写成 `/.../` 形式的正则字符串；写成 '.*' 会被当成
       * 字面量标签名、永远匹配不上，属性检查就静默失效了。
       */
      '@intlify/vue-i18n/no-raw-text': [
        'error',
        {
          ignoreNodes: ['i', 'code', 'pre'],
          attributes: { '/.+/': ['title', 'placeholder', 'aria-label', 'alt'] },
          // 纯数字 / 标点 / 符号（含空串）不是文案（\p{M} 覆盖 ⏱️ 这类 emoji 自带的变体选择符）
          ignorePattern: '^[\\d\\s\\p{P}\\p{S}\\p{M}]*$',
          // 各语言下写法相同、不该报成待翻译的文字：
          // 质谱与学术领域的固有缩写、化学标识符、单位，以及 ℹ / 1.0x / (k= 这类记号
          ignoreText: [
            'm/z', 'TIC', 'PNG', 'CSV', 'DOI', 'ORCID', 'imzML', 'ibd', 'zarr',
            'v', 'MALDI', 'DESI', 'SIMS', 'ROI', 'PCA', 'UMAP', 'KMeans', 'k-means', 'GitHub', 'ID',
            'CID', 'SMILES', 'InChI', 'InChIKey', 'PubChem',
            'μm', 'ppm', 'Da', 'ℹ', 'x', '(k=',
            // 输入框里的格式示例
            'you@example.com', 'https://example.com',
          ],
        },
      ],
      // 这三条从一开始就 error：防的是「页面上冒出裸 key」与「中英不同步」，
      // 属于随时可能上线的硬伤，没有迁移期豁免的必要。
      '@intlify/vue-i18n/no-missing-keys': 'error',
      '@intlify/vue-i18n/no-missing-keys-in-other-locales': 'error',
      '@intlify/vue-i18n/key-format-style': ['error', 'camelCase'],
      // 动态 key 会让上面所有静态检查失效。词表查表那类确有需要的场景，
      // 在那个文件里单独 eslint-disable，而不是全局放开。
      '@intlify/vue-i18n/no-dynamic-keys': 'error',
    },
  },
  {
    /**
     * no-unused-keys 作用在**语言包文件本身**上（它要遍历 json 的每个 key 再回头
     * 去源码里找引用），所以必须单独用 json 的 files 匹配——挂在上面那块 ts/vue 的
     * 规则里是空转，一条都不会报。
     *
     * 默认 extensions 是 ['.js', '.vue']，不含 .ts，会把只在 composables 里用到的 key
     * 误判成未使用，必须显式覆盖。
     */
    name: 'app/i18n-locale-files',
    files: ['src/i18n/locales/**/*.json'],
    rules: {
      '@intlify/vue-i18n/no-unused-keys': ['warn', { src: './src', extensions: ['.ts', '.vue'] }],
    },
  },

  skipFormatting,
)
