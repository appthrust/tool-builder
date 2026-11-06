// `/edit/<slug>` (index): the builder canvas. Palette | 12-column grid canvas
// rendering the draft live through the component registry (draft queries run
// against the real source) | property panel; a status bar with the selected
// component's query and the document's validation problems. Over the canvas,
// the data-flow layer (flow-overlay.tsx) draws the document's connections;
// dragging a frame's port onto another frame opens the connect sheet.
// Design: tool-builder-builtin-app.md "UI" `/edit/<slug>`, catalog mock "builder canvas".
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragStartEvent } from '@dnd-kit/core'
import { useParams } from '@tanstack/react-router'
import { Monitor, MousePointerClick } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Component, ComponentType, Document, Layout, Ref } from '../../../model/document'
import { problemTarget, type Problem } from '../../../model/document.schema'
import { flowHints, type FlowHint } from '../../../model/flow'
import { childrenOf, gridRows } from '../../../renderer/grid'
import { definitionFor, definitionOf, newComponent, nextComponentId, UNKNOWN_COMPONENT_ICON } from '../../../renderer/registry'
import { GridLayout } from '../../../renderer/renderer'
import { ToolRuntimeProvider } from '../../../renderer/runtime-context'
import { useText } from '../../../i18n'
import { paths } from '../../../routes/paths'
import { LinkButton, Notice, useMediaQuery } from '../../../ui'
import { PropertyPanel } from '../properties/property-panel'
import { useDraft } from '../draft-store'
import { CanvasContext, type CanvasState, type Connecting } from './canvas-context'
import { ComponentFrame, type DragData } from './component-frame'
import { ConnectSheet, type ConnectRequest } from './connect-sheet'
import { addComponent, clampLayout, componentsOf, findComponent, moveComponent, resizeComponent, slotOf, slotRows, subtreeIds, type Slot } from './document-ops'
import { acceptsConnection, ConnectChip, ConnectLine, connectTargetAt, FlowOverlay } from './flow-overlay'
import { cellUnder, clientRectOf, gridTargetAt, nearestCell, snappedSize } from './geometry'
import { PaletteDragChip, Palette } from './palette'
import { StatusBar } from './status-bar'

/** Empty rows below the last component: room to drop new ones. */
const SPARE_ROWS = 4

/** The canvas needs room for palette, a 12-column grid and the property panel. */
const WIDE_ENOUGH = '(min-width: 1024px)'

/** localStorage key of the data-flow layer toggle ("false" = hidden; anything else, or no storage, = shown). */
const FLOW_VISIBLE_KEY = 'toolBuilder.flow.visible'

export function CanvasPage() {
  const { slug } = useParams({ strict: false })
  const wide = useMediaQuery(WIDE_ENOUGH)
  if (!slug) return null
  return wide ? <CanvasEditor slug={slug} /> : <NarrowNotice slug={slug} />
}

function NarrowNotice({ slug }: { slug: string }) {
  const { t } = useText()
  return (
    <div className="p-4">
      <Notice
        tone="info"
        title={t('toolBuilder.editor.narrow.title')}
        actions={
          <>
            <LinkButton size="sm" href={paths.preview(slug)}>
              {t('toolBuilder.editor.preview')}
            </LinkButton>
            <LinkButton size="sm" href={paths.editQueries(slug)}>
              {t('toolBuilder.editor.nav.queries')}
            </LinkButton>
          </>
        }
      >
        <span className="flex items-start gap-2">
          <Monitor aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('toolBuilder.editor.narrow.body')}
        </span>
      </Notice>
    </div>
  )
}

type Point = { x: number; y: number }

/** One drag gesture: what is dragged, where the pointer started, and (move) where in the frame it was grabbed. */
type DragSession = {
  data: DragData
  start: Point
  grab: Point
  /** Component and its children: never a drop target for themselves (connect: never a connection target). */
  excluded: ReadonlySet<string>
  /** Resize: the frame's size and grid at the start. */
  frame: { width: number; height: number; grid: HTMLElement } | null
  /** Connect: the centre of the port the line is pulled from. */
  origin: Point | null
}

type DropTarget = { slot: Slot; layout: Layout; rect: { left: number; top: number; width: number; height: number } }

function frameElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-frame-id="${CSS.escape(id)}"]`)
}

function pointerOf(event: Event | null): Point {
  return event instanceof PointerEvent || event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : { x: 0, y: 0 }
}

/** Where the current gesture would land, from the live pointer position; null = nowhere (drop does nothing). */
function dropTarget(doc: Document, session: DragSession, pointer: Point): DropTarget | null {
  const { data } = session
  // A connection lands on a frame, not a grid cell (connectTargetAt).
  if (data.kind === 'connect') return null
  if (data.kind === 'resize') {
    const component = findComponent(doc, data.componentId)
    if (!component || !session.frame) return null
    const { grid } = session.frame
    const size = snappedSize({ width: session.frame.width + pointer.x - session.start.x, height: session.frame.height + pointer.y - session.start.y }, grid.getBoundingClientRect().width)
    const layout = clampLayout({ ...component.layout, ...size })
    return { slot: slotOf(doc, component), layout, rect: clientRectOf(layout, grid) }
  }
  const target = gridTargetAt(pointer.x, pointer.y, session.excluded)
  if (!target) return null
  const box = target.element.getBoundingClientRect()
  const slot = { parentId: target.parentId, tab: target.tab }
  let layout: Layout
  if (data.kind === 'palette') {
    const size = definitionOf(data.type).defaultSize
    const cell = cellUnder({ x: pointer.x - box.left, y: pointer.y - box.top }, box.width)
    layout = clampLayout({ x: cell.x, y: cell.y, w: size.w, h: size.h })
  } else {
    const component = findComponent(doc, data.componentId)
    if (!component) return null
    const cell = nearestCell({ x: pointer.x - session.grab.x - box.left, y: pointer.y - session.grab.y - box.top }, box.width)
    layout = clampLayout({ ...component.layout, x: cell.x, y: cell.y })
  }
  return { slot, layout, rect: clientRectOf(layout, target.element) }
}

function CanvasEditor({ slug }: { slug: string }) {
  const { t } = useText()
  const draft = useDraft(slug)
  const { document: doc, update } = draft
  const components = componentsOf(doc)
  const [selection, setSelection] = useState<string | null>(null)
  // Undo can remove the selected component; the selection follows the document.
  const selectedId = selection !== null && components.some((component) => component.id === selection) ? selection : null
  const [session, setSession] = useState<DragSession | null>(null)
  const [target, setTarget] = useState<DropTarget | null>(null)
  const pointer = useRef<Point>({ x: 0, y: 0 })
  const focusAfterRender = useRef<string | null>(null)
  const [flowVisible, setFlowVisible] = useState(() => {
    try {
      return localStorage.getItem(FLOW_VISIBLE_KEY) !== 'false'
    } catch {
      return true
    }
  })
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  /** The accepting frame under the pointer during a connect drag. */
  const [connectHover, setConnectHover] = useState<string | null>(null)
  /** The connect sheet's request (after a drop, or Enter on a port). */
  const [connect, setConnect] = useState<ConnectRequest | null>(null)
  useEffect(() => {
    try {
      localStorage.setItem(FLOW_VISIBLE_KEY, String(flowVisible))
    } catch {
      // No storage (private mode, policy): the toggle still works for this visit.
    }
  }, [flowVisible])

  const problemsByComponent = useMemo(() => {
    const byComponent = new Map<string, Problem[]>()
    for (const problem of draft.problems) {
      const { componentId } = problemTarget(doc, problem)
      if (!componentId) continue
      byComponent.set(componentId, [...(byComponent.get(componentId) ?? []), problem])
    }
    return byComponent
  }, [doc, draft.problems])

  const hints = useMemo(() => flowHints(doc), [doc])
  const hintsByComponent = useMemo(() => {
    const byComponent = new Map<string, FlowHint['kind'][]>()
    for (const hint of hints) byComponent.set(hint.componentId, [...(byComponent.get(hint.componentId) ?? []), hint.kind])
    return byComponent
  }, [hints])

  const select = useCallback((id: string | null) => setSelection(id), [])
  const draggingId = session && (session.data.kind === 'move' || session.data.kind === 'resize') ? session.data.componentId : null
  const connecting = useMemo<Connecting | null>(
    () => (session?.data.kind === 'connect' ? { from: session.data.from, excluded: session.excluded, hoverId: connectHover } : null),
    [session, connectHover]
  )
  // Enter on a port: the target is the currently selected component when it accepts (focusing or
  // clicking a port leaves the selection alone); anything else is a no-op the port announces.
  const connectFromPort = useCallback(
    (from: Ref) => {
      const target = selectedId !== null && !subtreeIds(doc, from.component).has(selectedId) ? findComponent(doc, selectedId) : undefined
      if (!target || !acceptsConnection(target)) return false
      setConnect({ from, targetId: target.id })
      return true
    },
    [doc, selectedId]
  )
  const canvas = useMemo<CanvasState>(
    () => ({
      selectedId,
      select,
      problemsByComponent,
      draggingId,
      update,
      flowVisible,
      hintsByComponent,
      connecting,
      selectedEdge,
      selectEdge: setSelectedEdge,
      connectFromPort,
    }),
    [selectedId, select, problemsByComponent, draggingId, update, flowVisible, hintsByComponent, connecting, selectedEdge, connectFromPort]
  )
  const wrapComponent = useCallback((component: Component, node: ReactNode) => <ComponentFrame component={component}>{node}</ComponentFrame>, [])

  // A component added from the palette by keyboard gets focus (and scrolls into view) once rendered.
  useEffect(() => {
    const id = focusAfterRender.current
    if (!id) return
    focusAfterRender.current = null
    const frame = frameElement(id)
    frame?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    frame?.focus({ preventScroll: true })
  })

  // dnd-kit reports translation, not the pointer; the drop math needs the pointer itself.
  useEffect(() => {
    if (!session) return
    const onMove = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
    }
    window.addEventListener('pointermove', onMove, { capture: true })
    return () => window.removeEventListener('pointermove', onMove, { capture: true })
  }, [session])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined
    if (!data) return
    const start = pointerOf(event.activatorEvent)
    pointer.current = start
    let grab: Point = { x: 0, y: 0 }
    let frame: DragSession['frame'] = null
    let excluded: ReadonlySet<string> = new Set()
    let origin: Point | null = null
    if (data.kind === 'connect') {
      // The port is the draggable node: the line starts at its centre.
      const port = event.active.rect.current.initial
      origin = port ? { x: port.left + port.width / 2, y: port.top + port.height / 2 } : start
      excluded = subtreeIds(doc, data.from.component)
      setSelectedEdge(null)
    } else if (data.kind !== 'palette') {
      const element = frameElement(data.componentId)
      const box = element?.getBoundingClientRect()
      const grid = element?.parentElement?.closest<HTMLElement>('[data-grid-parent]')
      if (box) grab = { x: start.x - box.left, y: start.y - box.top }
      if (box && grid && data.kind === 'resize') frame = { width: box.width, height: box.height, grid }
      excluded = subtreeIds(doc, data.componentId)
      setSelection(data.componentId)
    }
    setSession({ data, start, grab, excluded, frame, origin })
  }

  const onDragMove = () => {
    if (!session) return
    if (session.data.kind === 'connect') setConnectHover(connectTargetAt(doc, pointer.current.x, pointer.current.y, session.excluded))
    else setTarget(dropTarget(doc, session, pointer.current))
  }

  const finish = (commit: boolean) => {
    const current = session
    setSession(null)
    setTarget(null)
    setConnectHover(null)
    if (!commit || !current) return
    const { data } = current
    if (data.kind === 'connect') {
      const targetId = connectTargetAt(doc, pointer.current.x, pointer.current.y, current.excluded)
      if (targetId) setConnect({ from: data.from, targetId })
      return
    }
    const landing = dropTarget(doc, current, pointer.current)
    if (!landing) return
    if (data.kind === 'palette') {
      const id = nextComponentId(doc, data.type)
      update((d) => addComponent(d, newComponent(data.type, id, landing.layout), landing.slot))
      setSelection(id)
    } else if (data.kind === 'move') {
      update((d) => moveComponent(d, data.componentId, landing.slot, { x: landing.layout.x, y: landing.layout.y }))
    } else {
      update((d) => resizeComponent(d, data.componentId, { w: landing.layout.w, h: landing.layout.h }))
    }
  }

  /** Palette click / Enter: below the last component of the selected container (its visible tab), else of the page. */
  const addAtEnd = (type: ComponentType) => {
    const selected = selectedId ? findComponent(doc, selectedId) : undefined
    let slot: Slot = { parentId: undefined, tab: undefined }
    if (selected && (selected.type === 'container' || selected.type === 'tabs')) {
      const grid = frameElement(selected.id)?.querySelector<HTMLElement>(`[data-grid-parent="${CSS.escape(selected.id)}"]`)
      slot = { parentId: selected.id, tab: grid?.dataset.gridTab || undefined }
    }
    const size = definitionOf(type).defaultSize
    const id = nextComponentId(doc, type)
    update((d) => addComponent(d, newComponent(type, id, { x: 0, y: slotRows(d, slot), w: size.w, h: size.h }), slot))
    setSelection(id)
    focusAfterRender.current = id
  }

  const page = doc.pages[0]
  const topLevel = childrenOf(components, undefined)
  const selected = selectedId ? findComponent(doc, selectedId) : undefined
  /** Status-bar hint count: select the next hinted component and bring it into view. */
  const reveal = (id: string) => {
    setSelection(id)
    frameElement(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  return (
    <CanvasContext.Provider value={canvas}>
      <ToolRuntimeProvider slug={slug} document={doc} source="draft" actions="disabled" wrapComponent={wrapComponent}>
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={() => finish(true)}
          onDragCancel={() => finish(false)}
        >
          <div className="flex min-h-0 flex-1">
            <Palette onAdd={addAtEnd} />
            <div className="flex min-w-0 flex-1 flex-col">
              <div
                className="relative min-h-0 flex-1 overflow-auto bg-stone-100 bg-[radial-gradient(var(--color-stone-300)_0.7px,transparent_0.7px)] [background-size:14px_14px] p-6 xl:p-8 dark:bg-stone-900 dark:bg-[radial-gradient(var(--color-stone-700)_0.7px,transparent_0.7px)]"
                onClick={() => setSelection(null)}
              >
                <section
                  aria-label={t('toolBuilder.editor.canvas.label')}
                  className="relative mx-auto max-w-6xl rounded-lg border border-stone-200 bg-white px-5 pt-5 pb-8 shadow-sm dark:border-stone-800 dark:bg-stone-950"
                >
                  {page?.title ? <h1 className="mb-8 text-lg font-semibold text-stone-900 dark:text-stone-100">{page.title}</h1> : <div className="h-4" />}
                  <div className="relative">
                    <GridLayout components={topLevel} minRows={gridRows(topLevel) + SPARE_ROWS} stack={false} />
                    {topLevel.length === 0 ? (
                      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-40 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-stone-200 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                        <MousePointerClick aria-hidden className="size-5 text-stone-400" />
                        {t('toolBuilder.editor.canvas.empty')}
                      </div>
                    ) : null}
                  </div>
                  <FlowOverlay slug={slug} doc={doc} hidden={session !== null} />
                </section>
                <p id="canvas-keyboard-help" className="sr-only">
                  {t('toolBuilder.editor.canvas.keyboardHelp')} {t('toolBuilder.flow.keyboardHelp')}
                </p>
              </div>
              <StatusBar
                slug={slug}
                doc={doc}
                problems={draft.problems}
                selected={selected}
                onSelect={setSelection}
                hints={hints}
                onRevealHint={reveal}
                flowVisible={flowVisible}
                onToggleFlow={() => setFlowVisible((visible) => !visible)}
              />
            </div>
            <PropertyPanel slug={slug} draft={draft} selected={selected} onSelect={setSelection} />
          </div>
          <DragOverlay dropAnimation={null}>
            {session?.data.kind === 'palette' ? (
              <PaletteDragChip type={session.data.type} />
            ) : session?.data.kind === 'move' ? (
              <MoveChip component={findComponent(doc, session.data.componentId)} />
            ) : session?.data.kind === 'connect' ? (
              <ConnectChip id={session.data.from.component} />
            ) : null}
          </DragOverlay>
          {session && target ? <DropPreview target={target} session={session} /> : null}
          {session?.data.kind === 'connect' && session.origin ? <ConnectLine from={session.origin} landing={connectHover !== null} /> : null}
          {/* Inside the runtime provider: the sheet reads live query state (selectedRow columns). */}
          <ConnectSheet slug={slug} doc={doc} request={connect} onClose={() => setConnect(null)} update={update} />
        </DndContext>
      </ToolRuntimeProvider>
    </CanvasContext.Provider>
  )
}

function MoveChip({ component }: { component: Component | undefined }) {
  const { t } = useText()
  if (!component) return null
  const definition = definitionFor(component.type)
  const Icon = definition?.icon ?? UNKNOWN_COMPONENT_ICON
  return (
    <span className="flex w-max items-center gap-1.5 rounded-md bg-accent px-2 py-1 font-mono text-[11px] font-medium text-white shadow-lg">
      <Icon aria-hidden className="size-3.5" />
      {component.id}
      <span className="font-sans opacity-80">· {definition ? t(definition.label) : t('toolBuilder.editor.unknownComponentType', { type: component.type })}</span>
    </span>
  )
}

/** The cells the gesture would occupy, drawn over the target grid (fixed position, so it follows scrolling grids). */
function DropPreview({ target, session }: { target: DropTarget; session: DragSession }) {
  const { t } = useText()
  const { rect } = target
  const label =
    session.data.kind === 'palette'
      ? t('toolBuilder.editor.canvas.dropNew', { name: t(definitionOf(session.data.type).label) })
      : session.data.kind === 'resize'
        ? t('toolBuilder.editor.canvas.dropSize', { w: target.layout.w, h: target.layout.h })
        : t('toolBuilder.editor.canvas.dropMove', { x: target.layout.x + 1, y: target.layout.y + 1 })
  return (
    <div
      aria-hidden
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      className="pointer-events-none fixed z-40 flex items-start justify-center rounded-md border-2 border-dashed border-accent bg-accent-soft/70 pt-2 text-[11px] font-medium text-accent-strong"
    >
      {label}
    </div>
  )
}
