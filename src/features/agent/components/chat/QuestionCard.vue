<script setup lang="ts">
/**
 * 等待中的提问，占住输入框的位置。推荐项预选；用鼠标点单选项就进入下一题，最后一题要点提交。
 * 每次改动都存回服务：面板关了再打开能接着答，到点时服务按这份草稿和推荐项自动提交。
 * 顶边的色标和进度方块取自离子图的 viridis 色标。
 */
import { computed, shallowRef, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useIntervalFn } from '@vueuse/core'
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  Clock3Icon,
  MessageCircleQuestionMarkIcon,
  SquareIcon,
} from '@lucide/vue'
import { buildLUT, colormapGradient } from '@/shared/viz/colormapLut'
import {
  draftAnswer,
  parseRecommendedLabel,
  type PendingQuestion,
  type QuestionAnswer,
  type QuestionDraft,
} from '../../plugins/user-questions'
import { useQuestion } from '../../composables/useQuestion'
import IconButton from '../ai-elements/IconButton.vue'
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '../ui/questionnaire'

const props = defineProps<{ pending: PendingQuestion }>()
const emit = defineEmits<{ stop: [] }>()

const GRADIENT = colormapGradient('viridis')
const VIRIDIS = buildLUT('viridis')

const { t } = useI18n()
const { saveDrafts, submit } = useQuestion()

const questions = computed(() => props.pending.questions)
const drafts = shallowRef<QuestionDraft[]>(
  props.pending.drafts.map((draft) => ({ ...draft, selected: [...draft.selected] })),
)
const isAnswered = (index: number) => !!draftAnswer(questions.value[index]!, drafts.value[index]!)
/** 重新打开时停在第一道用户还没答完的题；预选的推荐项不算用户答过 */
const active = shallowRef(
  questions.value[drafts.value.findIndex((draft, index) => !draft.touched || !isAnswered(index))]
    ?.id ?? questions.value[0]!.id,
)
const activeIndex = computed(() =>
  questions.value.findIndex((question) => question.id === active.value),
)
const collapsed = shallowRef(false)
const contentId = useId()
const failure = shallowRef('')

const items = computed(() =>
  questions.value.map((question) => ({
    name: question.id,
    choices: (question.options ?? []).map((option) => ({ value: option.label })),
  })),
)

const now = shallowRef(Date.now())
useIntervalFn(() => (now.value = Date.now()), 1000)
const remaining = computed(() => Math.max(0, props.pending.deadline - now.value))
const clock = computed(() => {
  const seconds = Math.ceil(remaining.value / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})

/** 第 index 道题的进度方块颜色：沿色标从青到黄，暗色背景下也看得清 */
function pixelColor(index: number): string {
  const count = questions.value.length
  const position = 0.35 + 0.65 * (count === 1 ? 1 : index / (count - 1))
  return `rgb(${VIRIDIS[Math.round(position * 255)]!.join(' ')})`
}

function update(index: number, patch: Partial<QuestionDraft>): void {
  drafts.value = drafts.value.map((draft, i) =>
    i === index ? { ...draft, ...patch, touched: true } : draft,
  )
  failure.value = ''
  saveDrafts(drafts.value)
}

const isChecked = (index: number, label: string) =>
  !drafts.value[index]!.skipped && drafts.value[index]!.selected.includes(label)

function choose(index: number, label: string, checked: boolean): void {
  const selected = drafts.value[index]!.selected.filter((item) => item !== label)
  if (questions.value[index]!.multiSelect) {
    update(index, { selected: checked ? [...selected, label] : selected, skipped: false })
  } else if (checked) {
    // 单选时选项和自由文本互斥
    update(index, { selected: [label], custom: '', skipped: false })
  }
}

function write(index: number, custom: string): void {
  const keep = questions.value[index]!.multiSelect ? {} : { selected: [] }
  update(index, { custom, skipped: false, ...keep })
}

/** 鼠标点单选项后进入下一题。键盘和数字键的选择（detail 为 0）不跳 */
function advanceAfterClick(event: MouseEvent, index: number): void {
  if (event.detail === 0 || questions.value[index]!.multiSelect) return
  const next = questions.value[index + 1]
  if (!next) return
  // change 事件在 click 之后才派发，等选中状态写进草稿再跳
  setTimeout(() => {
    if (isAnswered(index)) active.value = next.id
  })
}

/** 跳过按钮先于组件自己的跳过逻辑触发，在这里把草稿记成跳过 */
function skipActive(): void {
  update(activeIndex.value, { selected: [], custom: '', skipped: true })
}

function onSubmit(event: Event): void {
  event.preventDefault()
  const answers = questions.value.map((question, index) =>
    draftAnswer(question, drafts.value[index]!),
  )
  const missing = answers.findIndex((answer) => !answer)
  if (missing >= 0) {
    active.value = questions.value[missing]!.id
    return
  }
  try {
    submit({ answers: answers as QuestionAnswer[] })
  } catch (error) {
    failure.value = t('common.agent.question.submitFailed', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}
</script>

<template>
  <div class="question-card relative overflow-hidden rounded-[20px] border bg-base-100 shadow-sm">
    <div
      class="h-0.5 origin-left transition-transform duration-1000 ease-linear motion-reduce:transition-none"
      :style="{ background: GRADIENT, transform: `scaleX(${remaining / pending.timeoutMs})` }"
      aria-hidden="true"
    ></div>
    <Questionnaire
      v-model:item="active"
      :items="items"
      shortcuts="numbers"
      class="gap-0"
      @submit="onSubmit"
    >
      <div class="flex min-w-0 items-center gap-2 px-4 py-3">
        <MessageCircleQuestionMarkIcon
          class="size-4 shrink-0 text-viridis-ink"
          aria-hidden="true"
        />
        <span class="kawaru-text-62 min-w-0 truncate font-medium text-(--sxo-label-2)">
          {{ questions[activeIndex]?.header || t('common.agent.question.waiting') }}
        </span>
        <QuestionnaireProgress
          class="ml-auto flex w-auto min-w-0 shrink-0 items-center gap-1.5"
          :aria-label="
            t('common.agent.question.progress', {
              current: activeIndex + 1,
              total: questions.length,
            })
          "
          :aria-valuetext="
            t('common.agent.question.progress', {
              current: activeIndex + 1,
              total: questions.length,
            })
          "
        >
          <span class="kawaru-text-62 mr-1 text-(--sxo-label-2) tabular-nums" aria-hidden="true">
            {{ activeIndex + 1 }} / {{ questions.length }}
          </span>
          <span
            v-for="(question, index) in questions"
            :key="question.id"
            class="question-progress-dot size-2 rounded-[2px] transition-colors"
            :class="[
              drafts[index]!.touched && isAnswered(index) ? '' : 'bg-muted-foreground/20',
              index === activeIndex
                ? 'ring-1 ring-foreground/50 ring-offset-1 ring-offset-base-100'
                : '',
            ]"
            :style="
              drafts[index]!.touched && isAnswered(index)
                ? { background: pixelColor(index) }
                : undefined
            "
            aria-hidden="true"
          ></span>
        </QuestionnaireProgress>
        <span
          class="kawaru-text-62 ml-1 inline-flex shrink-0 items-center gap-1 text-(--sxo-label-3) tabular-nums"
          :title="t('common.agent.question.autoSubmit', { time: clock })"
          :aria-label="t('common.agent.question.autoSubmit', { time: clock })"
        >
          <Clock3Icon class="size-3" aria-hidden="true" />
          {{ clock }}
        </span>
        <IconButton
          type="button"
          size="icon-sm"
          :label="
            collapsed ? t('common.agent.question.expand') : t('common.agent.question.collapse')
          "
          :aria-expanded="!collapsed"
          :aria-controls="contentId"
          @click="collapsed = !collapsed"
        >
          <ChevronUpIcon v-if="collapsed" />
          <ChevronDownIcon v-else />
        </IconButton>
        <IconButton
          type="button"
          size="icon-sm"
          :label="t('common.agent.stop')"
          @click="emit('stop')"
        >
          <SquareIcon class="size-2.5 fill-current" />
        </IconButton>
      </div>

      <div v-show="!collapsed" :id="contentId" class="flex min-h-0 flex-col">
        <div class="max-h-[min(50dvh,26rem)] overflow-y-auto overscroll-contain px-4 pt-1 pb-4">
          <QuestionnaireItem
            v-for="(question, index) in questions"
            :key="question.id"
            :name="question.id"
            :multiple="question.multiSelect"
            :default-skipped="drafts[index]!.skipped"
            class="gap-3"
          >
            <QuestionnaireTitle
              class="mb-0! w-full leading-relaxed font-medium wrap-anywhere whitespace-pre-wrap"
            >
              {{ question.question }}
            </QuestionnaireTitle>
            <p class="kawaru-text-62 text-(--sxo-label-3)">
              {{
                question.options?.length
                  ? question.multiSelect
                    ? t('common.agent.question.multipleHint')
                    : t('common.agent.question.singleHint')
                  : t('common.agent.question.textHint')
              }}
            </p>
            <QuestionnaireChoices class="gap-2">
              <QuestionnaireChoice
                v-for="option in question.options ?? []"
                :key="option.label"
                :value="option.label"
                :checked="isChecked(index, option.label)"
                class="question-choice min-h-11 gap-2.5 rounded-xl px-3 py-2.5 shadow-none"
                @update:checked="(checked: boolean) => choose(index, option.label, checked)"
                @click="(event: MouseEvent) => advanceAfterClick(event, index)"
              >
                <span class="flex flex-wrap items-center gap-x-2 gap-y-1 wrap-anywhere">
                  <span>{{ parseRecommendedLabel(option.label).label }}</span>
                  <span
                    v-if="parseRecommendedLabel(option.label).recommended"
                    class="kawaru-text-56 rounded-md bg-viridis-ink/10 px-1.5 py-0.5 font-medium text-viridis-ink"
                  >
                    {{ t('common.agent.question.recommended') }}
                  </span>
                </span>
                <QuestionnaireChoiceDescription
                  v-if="option.description"
                  class="kawaru-text-62 leading-relaxed wrap-anywhere"
                >
                  {{ option.description }}
                </QuestionnaireChoiceDescription>
              </QuestionnaireChoice>
              <QuestionnaireInput
                :model-value="drafts[index]!.custom"
                :placeholder="t('common.agent.question.custom')"
                :aria-label="t('common.agent.question.custom')"
                maxlength="2000"
                class="question-input h-11 min-h-11 rounded-xl shadow-none"
                @update:model-value="(value: string) => write(index, value)"
              />
            </QuestionnaireChoices>
            <QuestionnaireError>
              {{ t('common.agent.question.incomplete') }}
            </QuestionnaireError>
          </QuestionnaireItem>
        </div>
        <p v-if="failure" role="alert" class="kawaru-text-62 px-4 pb-3 text-error">{{ failure }}</p>
        <QuestionnaireActions class="gap-1.5 border-t bg-muted/40 px-3 py-2.5">
          <QuestionnairePrevious size="sm" variant="ghost" class="h-9 min-h-9 rounded-full px-2.5">
            <ChevronLeftIcon class="size-3.5" aria-hidden="true" />
            {{ t('common.agent.question.previous') }}
          </QuestionnairePrevious>
          <QuestionnaireSkip
            size="sm"
            variant="ghost"
            class="h-9 min-h-9 rounded-full px-2.5"
            @click="skipActive"
          >
            {{ t('common.agent.question.skip') }}
          </QuestionnaireSkip>
          <QuestionnaireNext size="sm" class="h-9 min-h-9 rounded-full px-4">
            {{ t('common.agent.question.next') }}
            <ArrowRightIcon class="size-3.5" aria-hidden="true" />
          </QuestionnaireNext>
          <QuestionnaireSubmit size="sm" class="h-9 min-h-9 rounded-full px-4">
            {{ t('common.agent.question.submit') }}
            <CheckIcon class="size-3.5" aria-hidden="true" />
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </div>
    </Questionnaire>
  </div>
</template>

<style scoped>
.question-card {
  container-type: inline-size;
}

/* Keep questionnaire registry primitives aligned with the assistant's selection color. */
.question-card :deep(.question-choice) {
  border-color: color-mix(in oklab, var(--color-base-content) 10%, transparent);
  background: transparent;
}

.question-card :deep(.question-choice:hover) {
  background: color-mix(in oklab, var(--color-base-content) 5%, var(--color-base-100));
}

.question-card :deep(.question-choice[data-checked]) {
  border-color: color-mix(in oklab, var(--sxo-accent) 40%, transparent);
  background: color-mix(in oklab, var(--sxo-accent) 6%, var(--color-base-100));
}

.question-card :deep([data-checked] > [data-slot='questionnaire-choice-indicator']) {
  background: var(--sxo-accent);
  border-color: var(--sxo-accent);
  color: var(--color-base-100);
}

.question-card :deep([data-slot='questionnaire-choice-indicator-dot']) {
  background: var(--color-base-100);
}

.question-card :deep([data-slot='questionnaire-choice-shortcut']) {
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--sxo-label-3);
  font-family: inherit;
}

.question-card :deep(.question-input) {
  border-color: color-mix(in oklab, var(--color-base-content) 12%, transparent);
  background: color-mix(in oklab, var(--color-base-content) 5%, var(--color-base-100));
  caret-color: var(--sxo-accent);
}

.question-card :deep(.question-input[data-filled]) {
  border-color: color-mix(in oklab, var(--sxo-accent) 40%, transparent);
  background: color-mix(in oklab, var(--sxo-accent) 6%, var(--color-base-100));
}

.question-card :deep(.question-choice:has(input:focus-visible)),
.question-card :deep(.question-input:focus-visible) {
  border-color: var(--sxo-accent);
  outline: 2px solid color-mix(in oklab, var(--sxo-accent) 30%, transparent);
  outline-offset: 2px;
  box-shadow: none;
}

@container (max-width: 340px) {
  .question-progress-dot {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .question-card :deep(*) {
    transition: none;
  }
}
</style>
