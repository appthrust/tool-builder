// The data-flow layer over the builder canvas: one curve per connection fact
// of the document (`flowEdges`: query param bound to a component, component
// prop referencing a component, action form input), drawn input → display
// between the frames, each with a label pill that opens a popover (open the
// query, disconnect). Also the pieces of the connect gesture the canvas page
// draws: the live line from the port to the pointer, the drag chip, and the
// frame under the pointer that would receive the connection.
// Design: tool-builder-builtin-app.md "UI" (data flow), issue tool-builder-visual-wiring.
import { Link2, Unplug } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Component, Document } from '../../../model/document'
import { edgeKey, flowEdges, type FlowEdge } from '../../../model/flow'
import { definitionFor } from '../../../renderer/registry'
import { useText } from '../../../i18n'
import { paths } from '../../../routes/paths'
import { Button, cn, LinkButton } from '../../../ui'
import { useCanvas } from './canvas-context'
import { disconnectEdge, findComponent } from './document-ops'

/** A component can receive a connection when it reads a query (its params can bind) or has a prop that may hold a reference. */
export function acceptsConnection(component: Component): boolean {
  const definition = definitionFor(component.type)
  return definition ? definition.fields.some((field) => field.name === 'query' || field.refable) : false
}

/**
 * The frame a connect drag would land on at a viewport point: the innermost
 * frame under the pointer that is not the source (or inside it) and accepts a
 * connection; null = the drop does nothing.
 */
export function connectTargetAt(doc: Document, x: number, y: number, excluded: ReadonlySet<string>): string | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const frame = element.closest<HTMLElement>('[data-frame-id]')
    const id = frame?.dataset.frameId
    if (!id || excluded.has(id)) continue
    const component = findComponent(doc, id)
    return component && acceptsConnection(component) ? id : null
  }
  return null
}

type Box = { left: number; top: number; right: number; bottom: number }
type Point = { x: number; y: number }

/**
 * Frame boxes relative to `overlay` (absolutely positioned over the canvas), for the frames of
 * the element it covers; re-measured when the canvas re-lays out, scrolls or changes its DOM.
 * The overlay's own element, not a ref on the canvas: a child's layout effect runs before
 * its parent's ref is attached.
 */
function useFrameBoxes(overlay: RefObject<HTMLElement | null>, doc: Document, active: boolean): ReadonlyMap<string, Box> {
  const [boxes, setBoxes] = useState<ReadonlyMap<string, Box>>(new Map())
  useLayoutEffect(() => {
    const layer = overlay.current
    const root = layer?.parentElement
    if (!active || !layer || !root) return
    let frame = 0
    let last = ''
    const measure = () => {
      frame = 0
      const origin = layer.getBoundingClientRect()
      const next = new Map<string, Box>()
      for (const element of root.querySelectorAll<HTMLElement>('[data-frame-id]')) {
        const id = element.dataset.frameId
        const box = element.getBoundingClientRect()
        // A frame in a hidden tab (or collapsed) has no box: its edges are not drawn.
        if (!id || (box.width === 0 && box.height === 0)) continue
        next.set(id, { left: box.left - origin.left, top: box.top - origin.top, right: box.right - origin.left, bottom: box.bottom - origin.top })
      }
      const signature = JSON.stringify([...next])
      if (signature === last) return
      last = signature
      setBoxes(next)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    for (const element of root.querySelectorAll<HTMLElement>('[data-frame-id]')) resize.observe(element)
    // Tabs switching, live content mounting: frames appear and disappear without a document change.
    const mutation = new MutationObserver(schedule)
    mutation.observe(root, { childList: true, subtree: true })
    // Capture: the canvas container and any scrolling component inside it.
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [overlay, doc, active])
  return boxes
}

type Side = 'left' | 'top' | 'bottom'
type Geometry = { path: string; mid: Point }

/**
 * The side of the receiving frame a curve enters: its left edge when it starts right of the
 * source; otherwise its top (or its bottom, when it lies above the source's middle).
 */
function entrySide(from: Box, to: Box): Side {
  if (to.left >= from.right) return 'left'
  return to.bottom <= (from.top + from.bottom) / 2 ? 'bottom' : 'top'
}

/**
 * Source: right-middle of the input's frame (where its port sits). Target: on `side`, spread
 * so `count` curves entering the same side do not meet in one point (`index` of them).
 */
function edgeGeometry(from: Box, to: Box, side: Side, index: number, count: number): Geometry {
  const start = { x: from.right, y: (from.top + from.bottom) / 2 }
  const share = (index + 1) / (count + 1)
  const reach = (distance: number) => Math.max(40, Math.abs(distance) / 2)
  let end: Point
  let c1: Point
  let c2: Point
  if (side === 'left') {
    end = { x: to.left, y: to.top + (to.bottom - to.top) * share }
    // Neighbouring frames (a grid gap apart) get a gentle S, not a loop back over the source.
    const horizontal = Math.max(Math.abs(end.x - start.x) / 2, Math.min(40, Math.abs(end.y - start.y) / 2))
    c1 = { x: start.x + horizontal, y: start.y }
    c2 = { x: end.x - horizontal, y: end.y }
  } else {
    end = { x: to.left + (to.right - to.left) * share, y: side === 'top' ? to.top : to.bottom }
    // Leave the port rightwards briefly, then turn to the target: no loop around the canvas.
    c1 = { x: start.x + 40, y: start.y }
    c2 = { x: end.x, y: end.y + (side === 'top' ? -1 : 1) * reach(end.y - start.y) }
  }
  const mid = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  }
  return { path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`, mid }
}

/** Where an edge is shown on the canvas: label, route (`search.value → orders`) and the query it opens. */
function useEdgeText(doc: Document) {
  const { t } = useText()
  return (edge: FlowEdge) => {
    const route = t('toolBuilder.flow.edge.route', { from: `${edge.from.component}.${edge.from.prop}`, to: edge.to })
    if (edge.kind === 'param') {
      const query = doc.queries.find((q) => q.id === edge.queryId)
      return { label: t('toolBuilder.flow.edge.paramLabel', { query: query?.name ?? edge.queryId, param: edge.param }), route, queryId: edge.queryId }
    }
    if (edge.kind === 'prop') return { label: edge.prop, route, queryId: undefined }
    const action = findComponent(doc, edge.to)?.actions?.find((a) => a.id === edge.actionId)
    return { label: action?.label || edge.actionId, route, queryId: action?.queryId }
  }
}

/**
 * The edges of the document over the canvas: rendered as the last child of the
 * positioned canvas section, it covers it and measures the frames inside it.
 * Hidden while a drag is in progress or the layer is off.
 */
export function FlowOverlay({ slug, doc, hidden }: { slug: string; doc: Document; hidden: boolean }) {
  const { t } = useText()
  const canvas = useCanvas()
  const active = canvas.flowVisible && !hidden
  const layer = useRef<HTMLDivElement>(null)
  const boxes = useFrameBoxes(layer, doc, active)
  const edges = useMemo(() => flowEdges(doc), [doc])
  const textOf = useEdgeText(doc)
  // useId may contain characters that `url(#…)` would need escaped.
  const markerId = `flow-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const { selectedEdge, selectEdge } = canvas

  // An edge that no longer exists (undo, disconnect elsewhere) or is hidden closes its popover.
  useEffect(() => {
    if (selectedEdge && (!active || !edges.some((edge) => edgeKey(edge) === selectedEdge))) selectEdge(null)
  }, [active, edges, selectedEdge, selectEdge])

  if (!active) return null

  const placed = edges.flatMap((edge) => {
    const from = boxes.get(edge.from.component)
    const to = boxes.get(edge.to)
    return from && to ? [{ edge, from, to, side: entrySide(from, to) }] : []
  })
  // Curves entering the same side of a frame are spread along it, in source order (left to right / top to bottom).
  const entries = new Map<string, typeof placed>()
  for (const item of placed) {
    const group = `${item.edge.to}:${item.side}`
    entries.set(group, [...(entries.get(group) ?? []), item])
  }
  for (const group of entries.values()) group.sort((a, b) => (a.side === 'left' ? a.from.top - b.from.top : a.from.left - b.from.left))
  const labels: Point[] = []
  const labelled = placed.map((item) => {
    const group = entries.get(`${item.edge.to}:${item.side}`) ?? [item]
    const { edge } = item
    const key = edgeKey(edge)
    const lit = key === selectedEdge || (canvas.selectedId !== null && (edge.to === canvas.selectedId || edge.from.component === canvas.selectedId))
    const faded = !lit && canvas.selectedId !== null
    const geometry = edgeGeometry(item.from, item.to, item.side, group.indexOf(item), group.length)
    // Nudge a label down past any label already placed on (nearly) the same spot.
    const labelAt = { ...geometry.mid }
    while (labels.some((other) => Math.abs(other.x - labelAt.x) < 120 && Math.abs(other.y - labelAt.y) < 20)) labelAt.y += 22
    labels.push(labelAt)
    return { edge, key, lit, faded, ...geometry, labelAt, ...textOf(edge) }
  })

  return (
    <div ref={layer} className="pointer-events-none absolute inset-0 z-10">
      <svg aria-hidden className="absolute inset-0 size-full overflow-visible">
        <defs>
          <marker id={`${markerId}-idle`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-stone-400 dark:fill-stone-500" />
          </marker>
          <marker id={`${markerId}-lit`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" className="fill-accent" />
          </marker>
        </defs>
        {labelled.map((item) => (
          <g key={item.key} className={cn('transition-opacity', item.faded && 'opacity-35')}>
            <path
              d={item.path}
              fill="none"
              strokeWidth={item.lit ? 2 : 1.5}
              strokeDasharray={item.edge.kind === 'form' ? '4 4' : undefined}
              markerEnd={`url(#${markerId}-${item.lit ? 'lit' : 'idle'})`}
              className={item.lit ? 'stroke-accent' : 'stroke-stone-400 dark:stroke-stone-500'}
            />
            {/* A wide invisible stroke makes the thin curve easy to click. */}
            <path
              d={item.path}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              className="cursor-pointer [pointer-events:stroke]"
              onClick={(event) => {
                event.stopPropagation()
                selectEdge(item.key)
              }}
            />
          </g>
        ))}
      </svg>
      {labelled.map((item) => (
        <Popover.Root key={item.key} open={selectedEdge === item.key} onOpenChange={(open) => selectEdge(open ? item.key : null)}>
          <Popover.Trigger
            aria-label={t('toolBuilder.flow.edge.aria', { from: item.edge.from.component, to: item.edge.to, label: item.label })}
            onClick={(event) => event.stopPropagation()}
            style={{ left: item.labelAt.x, top: item.labelAt.y }}
            className={cn(
              'pointer-events-auto absolute flex max-w-48 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap shadow-xs transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-accent',
              item.lit ? 'border-accent-line bg-accent-soft text-accent-strong' : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300',
              item.faded && 'opacity-35 hover:opacity-100 focus-visible:opacity-100',
              item.edge.kind === 'form' && 'border-dashed'
            )}
          >
            <Link2 aria-hidden className="size-2.5 shrink-0 opacity-70" />
            <span className="truncate">{item.label}</span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="center"
              sideOffset={6}
              onClick={(event) => event.stopPropagation()}
              className="z-50 w-72 rounded-lg border border-stone-200 bg-white p-3 shadow-lg animate-pop-in dark:border-stone-700 dark:bg-stone-900"
            >
              <p className="text-[11px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">{t(`toolBuilder.flow.edge.kind.${item.edge.kind}`)}</p>
              <p className="mt-1 font-mono text-xs font-medium break-all text-stone-900 dark:text-stone-100">{item.label}</p>
              <p className="mt-0.5 font-mono text-[11px] break-all text-stone-500 dark:text-stone-400">{item.route}</p>
              {item.edge.kind === 'form' ? <p className="mt-2 text-xs text-stone-600 dark:text-stone-300">{t('toolBuilder.flow.edge.formNote', { to: item.edge.to })}</p> : null}
              {item.queryId || item.edge.kind !== 'form' ? (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {item.queryId ? (
                    <LinkButton size="sm" href={paths.editQuery(slug, item.queryId)}>
                      {t('toolBuilder.flow.edge.openQuery')}
                    </LinkButton>
                  ) : null}
                  {item.edge.kind !== 'form' ? (
                    <Button
                      size="sm"
                      tone="ghost"
                      icon={<Unplug aria-hidden />}
                      className="text-bad-ink hover:bg-bad-soft hover:text-bad-ink dark:hover:bg-red-950/40"
                      onClick={() => {
                        const { edge } = item
                        canvas.update((d) => disconnectEdge(d, edge))
                        selectEdge(null)
                      }}
                    >
                      {t('toolBuilder.flow.edge.disconnect')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ))}
    </div>
  )
}

/**
 * The line a connect drag pulls from the port to the pointer (viewport coordinates, above everything).
 * It follows the pointer itself, so the canvas does not re-render on every move.
 */
export function ConnectLine({ from, landing }: { from: Point; landing: boolean }) {
  const [to, setTo] = useState(from)
  useEffect(() => {
    const onMove = (event: PointerEvent) => setTo({ x: event.clientX, y: event.clientY })
    window.addEventListener('pointermove', onMove, { capture: true })
    return () => window.removeEventListener('pointermove', onMove, { capture: true })
  }, [])
  const dx = Math.max(40, Math.abs(to.x - from.x) / 2)
  return (
    <svg aria-hidden className="pointer-events-none fixed inset-0 z-40 size-full overflow-visible">
      <path
        d={`M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`}
        fill="none"
        strokeWidth={2}
        strokeDasharray={landing ? undefined : '5 4'}
        className="stroke-accent"
      />
      <circle cx={from.x} cy={from.y} r={4} className="fill-accent" />
      <circle cx={to.x} cy={to.y} r={3} className="fill-accent" />
    </svg>
  )
}

/** The chip under the pointer during a connect drag. */
export function ConnectChip({ id }: { id: string }) {
  const { t } = useText()
  return (
    <span className="flex w-max items-center gap-1.5 rounded-md bg-accent px-2 py-1 font-mono text-[11px] font-medium text-white shadow-lg">
      <Link2 aria-hidden className="size-3.5" />
      {t('toolBuilder.flow.dragChip', { id })}
    </span>
  )
}
