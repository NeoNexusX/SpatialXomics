<script setup lang="ts">
/** 渲染模型输出的 Markdown，语法由 markdownSyntax.ts 里的插件提供 */
import { Markdown } from '@comark/vue'
import { autoCloseMarkdown } from 'comark'
import { MARKDOWN_COMPONENTS, MARKDOWN_PLUGINS } from './markdownSyntax'

const props = defineProps<{ text: string; streaming?: boolean }>()

const PARSER_OPTIONS = {
  registerDefaultPlugins: false,
  // 只有输出到一半的内容才要补全。默认对写完的消息也补，表格最后一格会多出字符（比如 [M-H]- 所在的行）
  autoClose: (markdown: string) =>
    props.streaming
      ? autoCloseMarkdown(markdown, { syntax: false, math: true, dropTrailingOpeners: true })
      : markdown,
}
</script>

<template>
  <!-- Comark 的 Markdown 是 async setup，必须包在 Suspense 里 -->
  <div class="agent-markdown">
    <Suspense>
      <Markdown
        :value="text"
        :options="PARSER_OPTIONS"
        :plugins="MARKDOWN_PLUGINS"
        :components="MARKDOWN_COMPONENTS"
        :streaming="streaming"
      />
    </Suspense>
  </div>
</template>

<style scoped>
.agent-markdown {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
  line-height: 1.65;
}
.agent-markdown :deep(> * > :first-child) {
  margin-top: 0;
}
.agent-markdown :deep(> * > :last-child) {
  margin-bottom: 0;
}
.agent-markdown :deep(p) {
  margin: 0.55em 0;
}
.agent-markdown :deep(h1),
.agent-markdown :deep(h2),
.agent-markdown :deep(h3),
.agent-markdown :deep(h4),
.agent-markdown :deep(h5),
.agent-markdown :deep(h6) {
  margin: 1em 0 0.35em;
  font-weight: 600;
  line-height: 1.35;
}
.agent-markdown :deep(h1) {
  font-size: 1.25em;
}
.agent-markdown :deep(h2) {
  font-size: 1.15em;
}
.agent-markdown :deep(h3) {
  font-size: 1.05em;
}
.agent-markdown :deep(ul),
.agent-markdown :deep(ol) {
  margin: 0.5em 0;
  padding-left: 1.4em;
}
.agent-markdown :deep(ul) {
  list-style: disc;
}
.agent-markdown :deep(ol) {
  list-style: decimal;
}
.agent-markdown :deep(li) {
  margin: 0.2em 0;
}
.agent-markdown :deep(li > p) {
  margin: 0;
}
.agent-markdown :deep(.contains-task-list) {
  padding-left: 0.2em;
  list-style: none;
}
.agent-markdown :deep(blockquote) {
  margin: 0.6em 0;
  padding-left: 0.85em;
  border-left: 2px solid color-mix(in oklab, var(--color-base-content) 20%, transparent);
  color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
}
.agent-markdown :deep(hr) {
  margin: 1em 0;
}
.agent-markdown :deep(.katex) {
  font-size: 1.1em;
}
/* 横向滚动要求 overflow-y 不是 visible，而分式的下沿会超出行框，留出内边距才不会被裁掉 */
.agent-markdown :deep(.katex-display) {
  margin: 0.3em 0;
  padding-block: 0.4em;
  overflow: auto hidden;
}
.agent-markdown :deep(:not(pre) > code) {
  padding: 0.1em 0.35em;
  border-radius: 0.3em;
  background: color-mix(in oklab, var(--color-base-content) 7%, transparent);
  font-family: var(--font-mono);
  font-size: 0.9em;
}
/* 数据表：文字可以换行，数字（m/z 这类）不能从中间断开；放不下时横向滚动 */
.agent-markdown :deep(table) {
  display: block;
  max-width: 100%;
  margin: 0.7em 0;
  overflow-x: auto;
  overflow-wrap: normal;
  border-collapse: collapse;
  font-size: 0.92em;
  font-variant-numeric: tabular-nums;
}
.agent-markdown :deep(th),
.agent-markdown :deep(td) {
  min-width: 5em;
  padding: 0.3em 0.65em;
  border-bottom: 1px solid color-mix(in oklab, var(--color-base-content) 12%, transparent);
  text-align: left;
  vertical-align: top;
}
.agent-markdown :deep(th) {
  font-weight: 600;
  border-bottom-color: color-mix(in oklab, var(--color-base-content) 28%, transparent);
}
</style>
