import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as CodeBlock } from "./CodeBlock.vue"
export { default as CodeBlockActions } from "./CodeBlockActions.vue"
export { default as CodeBlockContent } from "./CodeBlockContent.vue"
export { default as CodeBlockHeader } from "./CodeBlockHeader.vue"
export { default as CodeBlockLine } from "./CodeBlockLine.vue"
export { default as CodeBlockTitle } from "./CodeBlockTitle.vue"
export { default as CodeBlockToken } from "./CodeBlockToken.vue"
export { useHighlightedCode } from "./useHighlightedCode"

export const codeBlockVariants = cva(
  "rounded-lg text-sm data-[size=sm]:text-xs has-[>[data-slot=code-block-content]:focus-visible]:ring-3 has-[>[data-slot=code-block-content]:focus-visible]:ring-ring/50 group/code-block relative flex w-full min-w-0 flex-col overflow-hidden",
  {
    variants: {
      variant: {
        default: "border border-input text-foreground dark:bg-input/30 has-[>[data-slot=code-block-content]:focus-visible]:border-ring",
        destructive: "border border-destructive/30 text-destructive dark:border-destructive/40",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)
export type CodeBlockVariants = VariantProps<typeof codeBlockVariants>
