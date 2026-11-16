<script setup lang="ts">
/** Markdown 里的围栏代码块：语法高亮 + 复制按钮 */
import { computed } from 'vue'
import type { Node as ComarkNode } from 'comark'
import { textContent } from 'comark/utils'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
  CodeBlockToken,
  useHighlightedCode,
} from '../ui/code-block'
import CopyButton from './CopyButton.vue'

const props = defineProps<{
  language?: string
  /** Comark 传入的原始节点 */
  __node?: ComarkNode
}>()

const code = computed(() => (props.__node ? textContent(props.__node) : ''))

const lines = useHighlightedCode(code, () => props.language ?? '')
</script>

<template>
  <CodeBlock size="sm" class="my-2.5">
    <CodeBlockHeader>
      <CodeBlockTitle class="font-mono">{{ language }}</CodeBlockTitle>
      <CodeBlockActions>
        <CopyButton :text="code" />
      </CodeBlockActions>
    </CodeBlockHeader>
    <CodeBlockContent>
      <CodeBlockLine v-for="(line, index) in lines" :key="index">
        <CodeBlockToken v-for="(token, tokenIndex) in line" :key="tokenIndex" :token="token" />
      </CodeBlockLine>
    </CodeBlockContent>
  </CodeBlock>
</template>
