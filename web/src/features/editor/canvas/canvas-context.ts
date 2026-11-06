// State the canvas shares with the frames the renderer calls back into
// (`wrapComponent` runs inside the renderer tree, so frames read it from
// context instead of props).
import { createContext, useContext } from 'react'
import type { Document, Ref } from '../../../model/document'
import type { Problem } from '../../../model/document.schema'
import type { FlowHint } from '../../../model/flow'
import type { UpdateOptions } from '../draft-store'

/** A connect gesture in progress: dragged from `from`'s port; `hoverId` = the accepting frame under the pointer. */
export type Connecting = { from: Ref; excluded: ReadonlySet<string>; hoverId: string | null }

export type CanvasState = {
  selectedId: string | null
  select(id: string | null): void
  /** Problems by the component they are about (via `problemTarget`). */
  problemsByComponent: ReadonlyMap<string, Problem[]>
  /** The component being moved or resized (its frame dims while the preview shows the target). */
  draggingId: string | null
  update(fn: (doc: Document) => Document, options?: UpdateOptions): void
  /** The data-flow layer (edges, hints, ports) is shown; the status-bar toggle, kept in localStorage. */
  flowVisible: boolean
  /** Data-flow hints by component (SPA-only advice, never a `Problem`). */
  hintsByComponent: ReadonlyMap<string, FlowHint['kind'][]>
  connecting: Connecting | null
  /** `edgeKey` of the edge whose popover is open. */
  selectedEdge: string | null
  selectEdge(key: string | null): void
  /** Keyboard connect from a focused port: opens the connect sheet when a target is selected; false = nothing to connect to. */
  connectFromPort(from: Ref): boolean
}

export const CanvasContext = createContext<CanvasState | null>(null)

export function useCanvas(): CanvasState {
  const state = useContext(CanvasContext)
  if (!state) throw new Error('useCanvas outside the canvas')
  return state
}
