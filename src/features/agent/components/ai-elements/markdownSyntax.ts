/**
 * 模型输出用到的 Markdown 语法，都由现成的插件提供。
 *
 * 没有用 Comark 的默认插件集合，因为其中三个会破坏模型输出：
 * - components：把 [M+H]+ 解析成 span，方括号丢失。alert 和 footnotes 依赖它，也就用不了
 * - attributes：吞掉文字里的花括号，比如 {x, y}
 * - frontmatter：回答以 --- 开头时，正文会被当成元数据整段吞掉
 * 默认集合里其余的 html、task-list 都开着。
 */

import { defineAsyncComponent } from 'vue'
import type { ComarkPlugin } from 'comark'
import breaks from 'comark/plugins/breaks'
import html from 'comark/plugins/html'
import math from 'comark/plugins/math'
import taskList from 'comark/plugins/task-list'
import { tex } from '@mdit/plugin-tex'
import cjkFriendly from 'markdown-it-cjk-friendly'
import MarkdownCodeBlock from './MarkdownCodeBlock.vue'
import MarkdownLink from './MarkdownLink.vue'

type MarkdownIt = Parameters<typeof tex>[0]

export const MARKDOWN_PLUGINS: ComarkPlugin[] = [
  html(),
  taskList(),
  // 模型写单个换行就是要换行
  breaks(),
  math(),
  {
    name: 'model-output',
    markdownItPlugins: [
      // 「**结论：**后文」这种全角标点紧贴汉字的写法，默认规则认为 ** 不能闭合
      cjkFriendly,
      // math() 只认 $，而不少模型写 \[...\] 和 \(...\)。节点由 Comark 生成，用不到 render
      (md: MarkdownIt) => tex(md, { delimiters: 'brackets', render: () => '' }),
      // 「[M+H]: 257.2」这样的行会被当成链接定义吞掉
      (md: MarkdownIt) => void md.block.ruler.disable('reference'),
    ],
  },
]

export const MARKDOWN_COMPONENTS = {
  pre: MarkdownCodeBlock,
  a: MarkdownLink,
  // 大部分回答用不到公式，KaTeX、化学式扩展（\ce）和样式都按需加载
  math: defineAsyncComponent(() =>
    Promise.all([
      import('@comark/vue/plugins/math'),
      import('katex/contrib/mhchem'),
      import('katex/dist/katex.min.css'),
    ]).then(([module]) => module.Math),
  ),
}
