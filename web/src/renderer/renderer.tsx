// The page grid (12 columns, 40px rows, absolute cells from `layout`),
// one component through the registry, and the action notice region. Used by
// the runtime page and, cell by cell through `wrapComponent`, the editor canvas.
import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { Component as ReactComponent, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useText } from '../i18n'
import type { Component } from '../model/document'
import { cn } from '../ui'
import { StateMessage } from './frame'
import { cellRect, childrenOf, gridHeight, gridRows, readingOrder, STACK_BELOW_PX } from './grid'
import { definitionFor } from './registry'
import { useToolRuntime } from './runtime-context'

function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/**
 * Cells of `components` positioned by their layout in a grid as wide as this
 * element. Below 640px (`stack`) cells stack full-width in reading order with
 * their layout height. `data-grid-parent` / `data-grid-tab` mark the grid for
 * the editor's drop hit-testing; an empty nested grid keeps two rows of room.
 */
export function GridLayout({
  components,
  parentId,
  tabId,
  minRows,
  stack = true,
}: {
  components: readonly Component[]
  parentId?: string
  tabId?: string
  minRows?: number
  stack?: boolean
}) {
  const { t } = useText()
  const { actionsEnabled } = useToolRuntime()
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const rows = gridRows(components, minRows ?? (parentId !== undefined && components.length === 0 ? 2 : 0))
  const stacked = stack && width > 0 && width < STACK_BELOW_PX
  const marks = { 'data-grid-parent': parentId ?? '', 'data-grid-tab': tabId }
  if (stacked) {
    return (
      <div ref={ref} {...marks} className="flex w-full min-w-0 flex-col gap-2">
        {readingOrder(components).map((component) => (
          <div key={component.id} className="relative min-w-0" style={{ height: gridHeight(component.layout.h) }}>
            <ComponentView component={component} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div ref={ref} {...marks} className="relative w-full min-w-0" style={{ height: gridHeight(rows) }}>
      {width > 0
        ? components.map((component) => {
            const rect = cellRect(component.layout, width)
            return (
              <div key={component.id} className="absolute" style={rect}>
                <ComponentView component={component} />
              </div>
            )
          })
        : null}
      {parentId !== undefined && components.length === 0 && !actionsEnabled ? (
        // Editor canvas only: an empty container/tab invites a drop.
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border border-dashed border-stone-300 text-[11px] text-stone-400 dark:border-stone-700 dark:text-stone-500">
          {t('toolBuilder.renderer.state.emptyContainer')}
        </p>
      ) : null}
    </div>
  )
}

/** One component through the registry, wrapped by the provider's `wrapComponent` (editor frame) when set. */
export function ComponentView({ component }: { component: Component }) {
  const { wrapComponent } = useToolRuntime()
  const definition = definitionFor(component.type)
  const node = definition ? (
    <ComponentBoundary key={`${component.id}:${component.type}`}>
      <definition.Runtime component={component} />
    </ComponentBoundary>
  ) : (
    <Unsupported type={component.type} />
  )
  return <>{wrapComponent ? wrapComponent(component, node) : node}</>
}

function Unsupported({ type }: { type: string }) {
  const { t } = useText()
  return <StateMessage tone="error" icon={<AlertTriangle />} title={t('toolBuilder.renderer.state.unsupported', { type })} />
}

/** A component that throws (bad data in a prop) shows an error in its cell instead of blanking the tool. */
class ComponentBoundary extends ReactComponent<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <BoundaryMessage /> : this.props.children
  }
}

function BoundaryMessage() {
  const { t } = useText()
  return (
    <div className="flex size-full rounded-lg border border-red-200 bg-bad-soft dark:border-red-500/30 dark:bg-red-500/10">
      <StateMessage tone="error" icon={<AlertTriangle />} title={t('toolBuilder.renderer.state.error')} />
    </div>
  )
}

/** The tool's page: top-level components in the grid, plus action notices. Render inside ToolRuntimeProvider. */
export function Renderer({ minRows, stack = true }: { minRows?: number; stack?: boolean }) {
  const { components } = useToolRuntime()
  return (
    <>
      <GridLayout components={childrenOf(components)} minRows={minRows} stack={stack} />
      <NoticeRegion />
    </>
  )
}

/** Action results, bottom-right, announced politely; each fades after a few seconds. */
export function NoticeRegion() {
  const { t } = useText()
  const { notices, dismiss } = useToolRuntime()
  return (
    <div
      role="region"
      aria-label={t('toolBuilder.renderer.notices')}
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-40 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn(
            'pointer-events-auto flex w-full items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg animate-pop-in',
            notice.tone === 'success'
              ? 'border-accent-line bg-white text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100'
              : 'border-red-200 bg-bad-soft text-bad-ink dark:border-red-500/30 dark:bg-stone-900 dark:text-red-300'
          )}
        >
          {notice.tone === 'success' ? (
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
          ) : (
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          )}
          <p className="min-w-0 flex-1">{notice.text}</p>
          <button
            type="button"
            aria-label={t('toolBuilder.renderer.dismiss')}
            onClick={() => dismiss(notice.id)}
            className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
