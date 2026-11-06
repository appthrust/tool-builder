// The selection / drag frame the canvas puts around every rendered component
// (renderer `wrapComponent`). The component inside stays live: inputs and
// table selection drive bindings exactly as at runtime. The frame adds:
// selection outline, the id tab (move handle), duplicate/delete, the resize
// handle, problem markers and keyboard editing (arrows move, Shift+arrows
// resize, Delete removes, ⌘/Ctrl+D duplicates, Escape deselects). With the
// data-flow layer on it also carries the data-flow hint pill and, on a
// component that exposes a value, the connection port (drag onto another
// component, or Enter to connect it to the currently selected component).
import { useDraggable } from '@dnd-kit/core'
import { AlertCircle, Copy, GripVertical, Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { exposedPropsOf, type Component, type Ref } from '../../../model/document'
import { problemText } from '../../../model/problems'
import { definitionFor, UNKNOWN_COMPONENT_ICON } from '../../../renderer/registry'
import { useText } from '../../../i18n'
import { cn } from '../../../ui'
import { useCanvas } from './canvas-context'
import { duplicateComponent, moveComponent, removeComponent, resizeComponent, slotOf } from './document-ops'
import { acceptsConnection } from './flow-overlay'

export type DragData =
  | { kind: 'palette'; type: Component['type'] }
  | { kind: 'move'; componentId: string }
  | { kind: 'resize'; componentId: string }
  | { kind: 'connect'; from: Ref }

export function ComponentFrame({ component, children }: { component: Component; children: ReactNode }) {
  const { t } = useText()
  const canvas = useCanvas()
  const definition = definitionFor(component.type)
  const selected = canvas.selectedId === component.id
  const dragging = canvas.draggingId === component.id
  const problems = canvas.problemsByComponent.get(component.id) ?? []
  const hints = canvas.flowVisible ? (canvas.hintsByComponent.get(component.id) ?? []) : []
  const move = useDraggable({ id: `move:${component.id}`, data: { kind: 'move', componentId: component.id } satisfies DragData })
  const resize = useDraggable({ id: `resize:${component.id}`, data: { kind: 'resize', componentId: component.id } satisfies DragData })
  // A table exposes `selectedRow`, inputs `value`, a form `values`, tabs `active`: the port drags the first.
  const exposed = exposedPropsOf(component.type)[0]
  const portFrom: Ref | undefined = canvas.flowVisible && exposed ? { component: component.id, prop: exposed } : undefined
  const port = useDraggable({
    id: `connect:${component.id}`,
    data: portFrom ? ({ kind: 'connect', from: portFrom } satisfies DragData) : undefined,
    disabled: !portFrom,
  })
  const [portHint, setPortHint] = useState(false)
  const connecting = canvas.connecting
  const isSource = connecting?.from.component === component.id
  // During a connect drag: frames that can receive it are outlined, the rest dim (containers stay, their children may accept).
  const connectState = !connecting
    ? null
    : connecting.excluded.has(component.id)
      ? 'source'
      : connecting.hoverId === component.id
        ? 'over'
        : acceptsConnection(component)
          ? 'accepts'
          : component.type === 'container' || component.type === 'tabs'
            ? null
            : 'dim'
  // A type this build does not know (a draft may hold one) still gets a frame, so it can be selected,
  // moved and deleted; the renderer shows the cell as an unknown component.
  const typeLabel = definition ? t(definition.label) : t('toolBuilder.editor.unknownComponentType', { type: component.type })
  const Icon = definition?.icon ?? UNKNOWN_COMPONENT_ICON

  const duplicate = () => {
    let copyId: string | undefined
    canvas.update((doc) => {
      const result = duplicateComponent(doc, component.id)
      copyId = result.id
      return result.doc
    })
    if (copyId) canvas.select(copyId)
  }
  const remove = () => {
    canvas.update((doc) => removeComponent(doc, component.id))
    canvas.select(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed into the live component (a search box, a select) are its own.
    if (event.target !== event.currentTarget) return
    const { x, y, w, h } = component.layout
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const delta = step[event.key]
    if (delta) {
      event.preventDefault()
      const [dx, dy] = delta
      if (event.shiftKey) canvas.update((doc) => resizeComponent(doc, component.id, { w: w + dx, h: h + dy }))
      else canvas.update((doc) => moveComponent(doc, component.id, slotOf(doc, component), { x: x + dx, y: y + dy }))
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove()
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      duplicate()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      canvas.select(null)
    }
  }

  return (
    <div
      data-frame-id={component.id}
      tabIndex={0}
      role="group"
      aria-roledescription={t('toolBuilder.editor.canvas.frameRole')}
      aria-label={t('toolBuilder.editor.canvas.frameLabel', { type: typeLabel, id: component.id })}
      aria-describedby={selected ? 'canvas-keyboard-help' : undefined}
      aria-invalid={problems.length > 0 || undefined}
      onClick={(event) => {
        // The innermost frame wins: a click on a child does not select its container.
        event.stopPropagation()
        canvas.select(component.id)
      }}
      onFocus={(event) => {
        if (event.target === event.currentTarget) canvas.select(component.id)
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'group/frame relative size-full rounded-md',
        connectState === 'over'
          ? 'bg-accent-soft/50 outline-2 outline-offset-4 outline-accent'
          : connectState === 'accepts'
            ? 'outline-2 outline-offset-4 outline-accent/60 outline-dashed'
            : 'outline-none',
        selected
          ? 'ring-2 ring-accent ring-offset-2 ring-offset-white dark:ring-offset-stone-950'
          : problems.length > 0
            ? 'ring-2 ring-bad/70 ring-offset-1 ring-offset-white dark:ring-offset-stone-950'
            : 'hover:ring-1 hover:ring-stone-300 hover:ring-offset-1 focus-visible:ring-2 focus-visible:ring-accent dark:hover:ring-stone-600 dark:ring-offset-stone-950',
        (dragging || connectState === 'dim') && 'opacity-40'
      )}
    >
      <div
        className={cn(
          'absolute -top-6 left-0 z-20 h-6 items-stretch overflow-hidden rounded-t-md text-[11px] font-medium text-white',
          selected ? 'flex bg-accent' : 'hidden bg-stone-500 group-hover/frame:flex'
        )}
      >
        <button
          type="button"
          ref={move.setNodeRef}
          {...move.listeners}
          {...move.attributes}
          aria-label={t('toolBuilder.editor.canvas.moveHandle', { id: component.id })}
          aria-describedby={undefined}
          className="flex cursor-grab items-center gap-1 px-1.5 font-mono active:cursor-grabbing"
        >
          <GripVertical aria-hidden className="size-3 opacity-70" />
          <Icon aria-hidden className="size-3" />
          {component.id}
        </button>
        {selected ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                duplicate()
              }}
              aria-label={t('toolBuilder.editor.canvas.duplicate')}
              title={t('toolBuilder.editor.canvas.duplicate')}
              className="flex items-center border-l border-white/25 px-1.5 hover:bg-white/15"
            >
              <Copy aria-hidden className="size-3" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                remove()
              }}
              aria-label={t('toolBuilder.editor.canvas.delete')}
              title={t('toolBuilder.editor.canvas.delete')}
              className="flex items-center border-l border-white/25 px-1.5 hover:bg-white/15"
            >
              <Trash2 aria-hidden className="size-3" />
            </button>
          </>
        ) : null}
      </div>
      {problems.length > 0 ? (
        <span
          role="img"
          aria-label={problems.length === 1 ? t('toolBuilder.editor.problems.one') : t('toolBuilder.editor.problems.many', { count: problems.length })}
          title={problems.map((problem) => problemText(problem, t)).join('\n')}
          className="absolute -top-2 -right-2 z-20 flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full bg-bad px-1 text-[11px] font-semibold text-white shadow-sm"
        >
          <AlertCircle aria-hidden className="size-3" />
          {problems.length}
        </span>
      ) : null}
      {hints.length > 0 ? (
        <span className={cn('absolute -top-2.5 z-20 flex gap-1', problems.length > 0 ? 'right-7' : 'right-2')}>
          {hints.map((kind) =>
            kind === 'unconnectedInput' ? (
              <span
                key={kind}
                title={t('toolBuilder.flow.hint.unconnectedInputTitle')}
                className="flex h-5 items-center rounded-full bg-busy-soft px-1.5 text-[10px] font-medium whitespace-nowrap text-busy-ink shadow-xs ring-1 ring-busy/50 ring-inset"
              >
                {t('toolBuilder.flow.hint.unconnectedInput')}
              </span>
            ) : (
              <span
                key={kind}
                title={t('toolBuilder.flow.hint.noDataTitle')}
                className="flex h-5 items-center rounded-full bg-stone-100 px-1.5 text-[10px] font-medium whitespace-nowrap text-stone-600 shadow-xs ring-1 ring-stone-200 ring-inset dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700"
              >
                {t('toolBuilder.flow.hint.noData')}
              </span>
            )
          )}
        </span>
      ) : null}
      <div className="size-full">{children}</div>
      {portFrom ? (
        <>
          <button
            type="button"
            ref={port.setNodeRef}
            {...port.listeners}
            {...port.attributes}
            aria-label={t('toolBuilder.flow.port.label', { id: component.id })}
            aria-describedby={portHint ? `port-hint-${component.id}` : undefined}
            title={t('toolBuilder.flow.port.title')}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              event.stopPropagation()
              setPortHint(!canvas.connectFromPort(portFrom))
            }}
            onBlur={() => setPortHint(false)}
            // The selection is the keyboard connect target: a click on the port must not move it to this frame.
            onClick={(event) => event.stopPropagation()}
            className={cn(
              'group/port absolute top-1/2 -right-2 z-20 flex size-4 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-accent',
              selected || isSource || portHint ? 'opacity-100' : 'opacity-0 group-hover/frame:opacity-100 focus-visible:opacity-100'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-2.5 rounded-full border-2 border-accent shadow-xs',
                isSource ? 'bg-accent' : 'bg-white group-hover/port:bg-accent dark:bg-stone-950'
              )}
            />
          </button>
          <span id={`port-hint-${component.id}`} role="status" className="sr-only">
            {portHint ? t('toolBuilder.flow.port.noTarget') : ''}
          </span>
        </>
      ) : null}
      {selected ? (
        <button
          type="button"
          ref={resize.setNodeRef}
          {...resize.listeners}
          {...resize.attributes}
          aria-label={t('toolBuilder.editor.canvas.resizeHandle')}
          aria-describedby={undefined}
          className="absolute -right-1.5 -bottom-1.5 z-20 size-3 cursor-se-resize rounded-[3px] border-2 border-accent bg-white dark:bg-stone-950"
        />
      ) : null}
    </div>
  )
}
