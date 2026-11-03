import type { InjectionKey, ShallowRef } from "vue"
import { inject, onMounted, onScopeDispose, provide, shallowRef } from "vue"

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const SCROLL_EDGE_THRESHOLD = 8
const SCROLL_PREVIOUS_ITEM_PEEK = 64
const SCROLL_EPSILON = 0.5
const AUTOSCROLLING_TIMEOUT = 180

export const SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
])

type Mode
  = | "following-bottom"
    | "free-scrolling"
    | "anchored-to-message"

interface PrependRestore {
  element: HTMLElement
  viewportTop: number
}

// -----------------------------------------------------------------------------
// DOM measurement helpers
// -----------------------------------------------------------------------------

function parseNumber(value: string | null | undefined): number {
  if (!value)
    return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getPadding(element: HTMLElement): { start: number, end: number } {
  const style = window.getComputedStyle(element)
  return {
    end: parseNumber(style.paddingBlockEnd || style.paddingBottom),
    start: parseNumber(style.paddingBlockStart || style.paddingTop),
  }
}

function getContentPadding(spacer: HTMLElement | null): { start: number, end: number } {
  const parent = spacer?.parentElement
  return parent ? getPadding(parent) : { end: 0, start: 0 }
}

function getRowGap(element: HTMLElement | null): number {
  if (!element)
    return 0
  const style = window.getComputedStyle(element)
  const gap = style.rowGap === "normal" ? style.gap : style.rowGap
  return parseNumber(gap)
}

function getMessageChildren(
  content: HTMLElement,
  spacer: HTMLElement | null,
): HTMLElement[] {
  return Array.from(content.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child !== spacer,
  )
}

function getElementOffsetTop(element: HTMLElement, viewport: HTMLElement): number {
  const elementRect = element.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  return elementRect.top - viewportRect.top + viewport.scrollTop
}

function getRelativeTop(element: HTMLElement, viewport: HTMLElement): number {
  return element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
}

function measureContentHeight({
  content,
  spacer,
  viewport,
}: {
  content: HTMLElement
  spacer: HTMLElement | null
  viewport: HTMLElement
}): number {
  const children = getMessageChildren(content, spacer)
  const padding = getPadding(content)
  const viewportRect = viewport.getBoundingClientRect()
  const scrollTop = viewport.scrollTop
  let height = padding.start + padding.end
  for (const child of children) {
    const rect = child.getBoundingClientRect()
    height = Math.max(height, rect.bottom - viewportRect.top + scrollTop + padding.end)
  }
  return height
}

function maxScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight)
}

function computeSpacerHeight({
  content,
  scrollTop,
  spacer,
  viewport,
}: {
  content: HTMLElement
  scrollTop: number
  spacer: HTMLElement | null
  viewport: HTMLElement
}): number {
  const contentHeight = measureContentHeight({ content, spacer, viewport })
  return scrollTop + viewport.clientHeight - contentHeight
}

function hasContentBelow({
  content,
  spacer,
  viewport,
}: {
  content: HTMLElement | null
  spacer: HTMLElement | null
  viewport: HTMLElement | null
}): boolean {
  if (!viewport || !content)
    return false
  const contentHeight = measureContentHeight({ content, spacer, viewport })
  return contentHeight - viewport.scrollTop - viewport.clientHeight > SCROLL_EDGE_THRESHOLD
}

function findFirstAnchorFrom(
  elements: HTMLElement[],
  startIndex: number,
): HTMLElement | null {
  for (let i = startIndex; i < elements.length; i++) {
    const element = elements[i]
    if (element?.dataset.scrollAnchor === "true")
      return element
  }
  return null
}

function findFirstUnhandledAnchor(
  elements: HTMLElement[],
  handled: WeakSet<HTMLElement>,
): HTMLElement | null {
  for (const element of elements) {
    if (element.dataset.scrollAnchor === "true" && !handled.has(element))
      return element
  }
  return null
}

function hasMultipleAnchorsFrom(
  elements: HTMLElement[],
  startIndex: number,
): boolean {
  let count = 0
  for (let i = startIndex; i < elements.length; i++) {
    if (elements[i]?.dataset.scrollAnchor === "true") {
      count += 1
      if (count > 1)
        return true
    }
  }
  return false
}

function findLastAnchor(elements: HTMLElement[]): HTMLElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i]
    if (element?.dataset.scrollAnchor === "true")
      return element
  }
  return null
}

function findFirstVisibleMessage({
  content,
  spacer,
  viewport,
}: {
  content: HTMLElement
  spacer: HTMLElement | null
  viewport: HTMLElement
}): HTMLElement | null {
  const viewportRect = viewport.getBoundingClientRect()
  for (const child of getMessageChildren(content, spacer)) {
    if (!child.dataset.messageId)
      continue
    const rect = child.getBoundingClientRect()
    if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom)
      return child
  }
  return null
}

// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

export interface MessageScrollerContext {
  canScrollToEnd: Readonly<ShallowRef<boolean>>
  handleContentChange: () => void
  handleResize: () => void
  scrollToEnd: (options?: { behavior?: ScrollBehavior }) => boolean
  setContentElement: (element: HTMLElement | null) => void
  setSpacerElement: (element: HTMLElement | null) => void
  setViewportElement: (element: HTMLElement | null) => void
  syncAfterScroll: () => void
  userScrollIntent: () => void
}

const CONTEXT_KEY: InjectionKey<MessageScrollerContext> = Symbol("MessageScrollerContext")

function createEngine() {
  let viewport: HTMLElement | null = null
  let content: HTMLElement | null = null
  let spacer: HTMLElement | null = null
  let spacerGap = 0
  let spacerHeight = 0
  let mode: Mode = "following-bottom"
  let streamingTurn: HTMLElement | null = null
  let firstItem: HTMLElement | null = null
  let itemCount = 0
  let lastScrollTop = 0
  let defaultScrollPositionApplied = false
  let prependRestore: PrependRestore | null = null
  let stateFrame: number | null = null
  let autoscrolling = false
  let autoscrollingTimeout: number | null = null
  const handledScrollAnchors = new WeakSet<HTMLElement>()

  const canScrollToEnd = shallowRef(false)

  // --- scroll-state commit ---------------------------------------------------

  function updateModeFromScroll(contentBelow: boolean) {
    const scrollTop = viewport?.scrollTop ?? 0
    const scrolledUp = scrollTop < lastScrollTop - SCROLL_EPSILON
    lastScrollTop = scrollTop
    if (!contentBelow && mode !== "anchored-to-message") {
      mode = "following-bottom"
    }
    else if (
      mode === "following-bottom"
      && contentBelow
      && scrolledUp
      && !autoscrolling
    ) {
      mode = "free-scrolling"
    }
  }

  function commitScrollState() {
    const contentBelow = hasContentBelow({ content, spacer, viewport })
    updateModeFromScroll(contentBelow)
    canScrollToEnd.value = mode !== "following-bottom" && contentBelow
  }

  function scheduleStateCommit() {
    if (stateFrame === null) {
      stateFrame = window.requestAnimationFrame(() => {
        stateFrame = null
        commitScrollState()
      })
    }
  }

  // --- imperative scroll primitives ------------------------------------------

  function setAutoscrolling(active: boolean) {
    if (autoscrollingTimeout !== null) {
      window.clearTimeout(autoscrollingTimeout)
      autoscrollingTimeout = null
    }
    if (autoscrolling !== active) {
      autoscrolling = active
      commitScrollState()
    }
    if (active) {
      autoscrollingTimeout = window.setTimeout(() => {
        autoscrollingTimeout = null
        autoscrolling = false
        commitScrollState()
      }, AUTOSCROLLING_TIMEOUT)
    }
  }

  function setSpacerHeight(height: number) {
    if (!spacer)
      return
    const next = Math.max(0, Math.ceil(height))
    if (spacerHeight !== next) {
      spacerHeight = next
      spacer.hidden = next === 0
      spacer.style.height = `${next}px`
      spacer.style.marginTop = next > 0 ? `${-spacerGap}px` : ""
    }
  }

  function scrollTo(
    top: number,
    { behavior = "auto", autoscrolling: isAutoscrolling = false }: { behavior?: ScrollBehavior, autoscrolling?: boolean } = {},
  ) {
    if (!viewport)
      return
    const target = Math.max(0, top)
    if (Math.abs(viewport.scrollTop - target) <= SCROLL_EPSILON) {
      viewport.scrollTop = target
      commitScrollState()
      return
    }
    if (isAutoscrolling)
      setAutoscrolling(true)
    viewport.scrollTo({ top: target, behavior })
    scheduleStateCommit()
  }

  function scrollToEnd({ behavior = "auto" }: { behavior?: ScrollBehavior } = {}): boolean {
    if (!viewport)
      return false
    setSpacerHeight(0)
    streamingTurn = null
    mode = "following-bottom"
    scrollTo(maxScrollTop(viewport), { autoscrolling: true, behavior })
    return true
  }

  /** Puts a message at the top of the viewport, with the end of the previous one still showing. */
  function scrollToAnchor(element: HTMLElement): boolean {
    if (!content || !viewport || !content.contains(element))
      return false
    const targetScrollTop = getElementOffsetTop(element, viewport)
      - getContentPadding(spacer).start
      - SCROLL_PREVIOUS_ITEM_PEEK
    setSpacerHeight(computeSpacerHeight({
      content,
      scrollTop: targetScrollTop,
      spacer,
      viewport,
    }))
    prependRestore = { element, viewportTop: getRelativeTop(element, viewport) }
    mode = "anchored-to-message"
    streamingTurn = element
    scrollTo(targetScrollTop)
    return true
  }

  function reanchorToAnchoredMessage(): boolean {
    if (!streamingTurn || !streamingTurn.isConnected || mode !== "anchored-to-message")
      return false
    return scrollToAnchor(streamingTurn)
  }

  // --- prepend preservation --------------------------------------------------

  function applyPrependRestore() {
    if (!prependRestore || !viewport || !prependRestore.element.isConnected)
      return
    const delta = getRelativeTop(prependRestore.element, viewport) - prependRestore.viewportTop
    if (Math.abs(delta) <= SCROLL_EPSILON)
      return
    viewport.scrollTop += delta
    prependRestore.viewportTop = getRelativeTop(prependRestore.element, viewport)
    scheduleStateCommit()
  }

  function capturePrependAnchor() {
    if (!content || !viewport) {
      prependRestore = null
      return
    }
    const element = findFirstVisibleMessage({ content, spacer, viewport })
    prependRestore = element
      ? { element, viewportTop: getRelativeTop(element, viewport) }
      : null
  }

  // --- default scroll position -----------------------------------------------

  /** Opens at the last user message, or at the end when everything after it fits. */
  function applyDefaultScrollPosition(): boolean {
    if (defaultScrollPositionApplied || itemCount === 0)
      return false
    let applied = false
    const lastAnchor = content && viewport
      ? findLastAnchor(getMessageChildren(content, spacer))
      : null
    if (!content || !viewport || !lastAnchor) {
      applied = scrollToEnd()
    }
    else {
      const anchorOffset = getElementOffsetTop(lastAnchor, viewport)
      const contentHeight = measureContentHeight({ content, spacer, viewport })
      applied = contentHeight - anchorOffset <= viewport.clientHeight
        ? scrollToEnd()
        : scrollToAnchor(lastAnchor)
    }
    if (applied)
      defaultScrollPositionApplied = true
    return applied
  }

  // --- content / resize handling ---------------------------------------------

  function applyContentChange(
    children: HTMLElement[],
    previousCount: number,
    previousFirst: HTMLElement | null,
  ) {
    if (previousCount === 0) {
      if (applyDefaultScrollPosition() || (children.length > 0 && scrollToEnd()))
        return
      commitScrollState()
      return
    }
    const previousIndex = previousFirst ? children.indexOf(previousFirst) : -1
    if (previousIndex > 0) {
      applyPrependRestore()
      return
    }
    if (children.length > previousCount) {
      const anchor = findFirstAnchorFrom(children, previousCount)
      if (anchor) {
        if (mode === "following-bottom" && hasMultipleAnchorsFrom(children, previousCount)) {
          scrollToEnd()
          return
        }
        scrollToAnchor(anchor)
        handledScrollAnchors.add(anchor)
        return
      }
    }
    if (children.length === previousCount) {
      const anchor = findFirstUnhandledAnchor(children, handledScrollAnchors)
      if (anchor) {
        scrollToAnchor(anchor)
        handledScrollAnchors.add(anchor)
        return
      }
    }
    if (mode === "following-bottom")
      scrollToEnd()
    else
      commitScrollState()
  }

  function handleContentChange() {
    if (!content)
      return
    const children = getMessageChildren(content, spacer)
    const previousCount = itemCount
    const previousFirst = firstItem
    itemCount = children.length
    firstItem = children[0] ?? null

    applyContentChange(children, previousCount, previousFirst)
    capturePrependAnchor()
  }

  function handleResize() {
    if (mode === "following-bottom") {
      scrollToEnd()
      return
    }
    const previousSpacerHeight = spacerHeight
    if (reanchorToAnchoredMessage()) {
      // The reply streaming below the anchor consumes the tail spacer as it
      // grows. Once the last of it is gone the reply has filled the viewport
      // and the reader is genuinely at the live edge, so the scroller hands off
      // from the anchor hold to following the bottom. Requiring the >0 → 0
      // transition keeps a turn taller than the viewport (placed with no
      // spacer) held instead of yanked to the end.
      if (previousSpacerHeight > 0 && spacerHeight === 0)
        scrollToEnd()
      return
    }
    scheduleStateCommit()
  }

  // --- user intent + element setters -----------------------------------------

  function userScrollIntent() {
    streamingTurn = null
    mode = "free-scrolling"
  }

  function setViewportElement(element: HTMLElement | null) {
    viewport = element
  }

  function setContentElement(element: HTMLElement | null) {
    content = element
  }

  function setSpacerElement(element: HTMLElement | null) {
    spacer = element
    spacerGap = getRowGap(element?.parentElement ?? null)
  }

  function syncAfterScroll() {
    commitScrollState()
    capturePrependAnchor()
  }

  function destroy() {
    if (stateFrame !== null) {
      window.cancelAnimationFrame(stateFrame)
      stateFrame = null
    }
    if (autoscrollingTimeout !== null) {
      window.clearTimeout(autoscrollingTimeout)
      autoscrollingTimeout = null
    }
  }

  const context: MessageScrollerContext = {
    canScrollToEnd,
    handleContentChange,
    handleResize,
    scrollToEnd,
    setContentElement,
    setSpacerElement,
    setViewportElement,
    syncAfterScroll,
    userScrollIntent,
  }

  return {
    context,
    applyDefaultScrollPosition,
    destroy,
  }
}

// -----------------------------------------------------------------------------
// Provider wiring (provide/inject)
// -----------------------------------------------------------------------------

export function provideMessageScroller() {
  const engine = createEngine()
  provide(CONTEXT_KEY, engine.context)

  onMounted(() => {
    engine.applyDefaultScrollPosition()
    // The viewport element attaches in MessageScrollerViewport's onMounted,
    // after MessageScrollerContent ran its initial handleContentChange without
    // it. Re-sync now that every element is wired up.
    engine.context.syncAfterScroll()
  })

  onScopeDispose(() => engine.destroy())
}

export function useMessageScrollerContext(): MessageScrollerContext {
  const context = inject(CONTEXT_KEY, null)
  if (!context)
    throw new Error("useMessageScrollerContext must be used within a MessageScroller.")
  return context
}
