// What a value dropped on a component can feed, for the Connect sheet: a
// parameter of the component's data query, a new structured filter on that
// query (read SQL only; no SQL written by the author), one of its `refable`
// props, or a new `{{ name }}` placeholder in that query (the author places
// it in the query editor; nothing rewrites query text automatically). Values
// reach a query only as bound parameters (design D4).
import type { MessageId } from '../../../copy'
import type { Document, Param, Ref } from '../../../model/document'
import { dataQueryOf } from '../../../model/document.schema'
import { definitionFor } from '../../../renderer/registry'
import { PLACEHOLDER_NAME } from '../queries/placeholders'
import { findComponent } from './document-ops'

/** A drop of `from` (an exposed head the sheet may refine to a path) on component `targetId`. */
export type ConnectRequest = { from: Ref; targetId: string }

export type ConnectOption =
  /** A parameter of the target's data query; `boundTo` is its current ref, if any. */
  | { kind: 'param'; queryId: string; queryName: string; param: Param; boundTo?: Ref }
  /** Add a structured filter to the target's read SQL query; its new param is bound to the source. */
  | { kind: 'filter'; queryId: string; queryName: string }
  /** A `refable` prop of the target (registry field). */
  | { kind: 'prop'; prop: string; label: MessageId }
  /** Insert `{{ suggestedName }}` into the target's data query (SQL or HTTP path/body). */
  | { kind: 'placeholder'; queryId: string; queryName: string; suggestedName: string }
  /** The target reads a query but none is chosen yet. */
  | { kind: 'noQuery' }

/** `from.component` as a placeholder name, not clashing with `taken`: `search`, `search_2`, … */
export function placeholderName(componentId: string, taken: ReadonlySet<string>): string {
  const cleaned = componentId.replace(/[^A-Za-z0-9_]/g, '_')
  const base = PLACEHOLDER_NAME.test(cleaned) ? cleaned : `_${cleaned}`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

/**
 * The connections `request.from` can make into `request.targetId`, in sheet
 * order: query params (or `noQuery`), a structured filter, refable props,
 * then the placeholder. A component never connects to itself; an unknown
 * target or one that takes nothing yields `[]`.
 */
export function connectOptions(doc: Document, request: ConnectRequest): ConnectOption[] {
  if (request.from.component === request.targetId) return []
  const target = findComponent(doc, request.targetId)
  const definition = target ? definitionFor(target.type) : undefined
  if (!target || !definition) return []
  const options: ConnectOption[] = []
  const queryId = dataQueryOf(target)
  const query = queryId ? doc.queries.find((candidate) => candidate.id === queryId) : undefined
  if (query) {
    for (const param of query.params) {
      options.push({ kind: 'param', queryId: query.id, queryName: query.name, param, ...('ref' in param.bind ? { boundTo: param.bind.ref } : {}) })
    }
    if (query.mode === 'read' && query.sql) options.push({ kind: 'filter', queryId: query.id, queryName: query.name })
  } else if (!queryId && definition.fields.some((field) => field.kind === 'query')) {
    options.push({ kind: 'noQuery' })
  }
  for (const field of definition.fields) {
    if (field.refable) options.push({ kind: 'prop', prop: field.name, label: field.label })
  }
  if (query) {
    const taken = new Set(query.params.map((param) => param.name))
    options.push({ kind: 'placeholder', queryId: query.id, queryName: query.name, suggestedName: placeholderName(request.from.component, taken) })
  }
  return options
}
