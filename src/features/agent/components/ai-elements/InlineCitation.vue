<script setup lang="ts">
/** shadcn-vue Inline Citation pattern: a compact source trigger and hover preview. */
import { computed } from 'vue'
import { HoverCardRoot, HoverCardTrigger, HoverCardPortal, HoverCardContent } from 'reka-ui'
import { Button } from '../ui/button'
import { i18n } from '@/i18n'

const props = defineProps<{ href: string; description?: string }>()
const hostname = computed(() => new URL(props.href).hostname.replace(/^www\./, ''))
const excerpt = computed(() => props.description?.trim().slice(0, 600))
const { t } = i18n.global
</script>

<template>
  <span data-slot="inline-citation" class="inline-citation align-baseline">
    <HoverCardRoot :open-delay="100" :close-delay="150">
      <HoverCardTrigger as-child>
        <!-- A real link preserves keyboard activation and one-tap navigation on touch screens. -->
        <Button
          as="a"
          :href="href"
          target="_blank"
          rel="noopener noreferrer"
          :title="description"
          variant="secondary"
          size="xs"
          data-slot="inline-citation-trigger"
          class="mx-0.5 inline-flex max-w-56 align-baseline text-[0.7rem] no-underline"
        >
          <span class="truncate">{{ hostname }}</span>
          <span class="sr-only">{{ t('common.agent.citation.opensInNewTab') }}</span>
        </Button>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent
          data-slot="inline-citation-content"
          align="start"
          :side-offset="6"
          class="agent-scope z-[10020] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md outline-hidden"
        >
          <div data-slot="inline-citation-title" class="font-medium leading-snug break-words">
            <slot />
          </div>
          <p
            v-if="excerpt"
            data-slot="inline-citation-quote"
            class="m-0 text-xs leading-relaxed break-words text-muted-foreground"
          >
            {{ excerpt }}
          </p>
          <a
            :href="href"
            target="_blank"
            rel="noopener noreferrer"
            class="truncate text-xs text-(--sxo-accent) underline-offset-4 hover:underline"
          >
            {{ href }}
            <span class="sr-only">{{ t('common.agent.citation.opensInNewTab') }}</span>
          </a>
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCardRoot>
  </span>
</template>
