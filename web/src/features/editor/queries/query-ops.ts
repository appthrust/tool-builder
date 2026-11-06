// Pure document edits of the query editor. Every function returns the same
// document when nothing changes, so `draft.update` records no empty undo step.
import type { DataSourceKind } from '../../../api/types'
import type { Document, Query, QueryMode } from '../../../model/document'
import { DEFAULT_ROW_LIMIT, DEFAULT_TIMEOUT_MS } from '../../../model/document.schema'
import { withSyncedParams } from './placeholders'

/** Applies `fn` to query `id`; params are re-synced to the placeholders after every edit. */
export function updateQuery(doc: Document, id: string, fn: (query: Query) => Query): Document {
  const index = doc.queries.findIndex((query) => query.id === id)
  const current = doc.queries[index]
  if (!current) return doc
  const next = fn(current)
  if (next === current) return doc
  const synced = withSyncedParams(next)
  return { ...doc, queries: doc.queries.map((query, i) => (i === index ? synced : query)) }
}

export function removeQuery(doc: Document, id: string): Document {
  const queries = doc.queries.filter((query) => query.id !== id)
  return queries.length === doc.queries.length ? doc : { ...doc, queries }
}

/** A free query id derived from `name` (query ids and names usually match, as in the fixtures). */
export function freeQueryId(doc: Document, name: string): string {
  const taken = new Set(doc.queries.map((query) => query.id))
  if (!taken.has(name)) return name
  let n = 2
  while (taken.has(`${name}_${n}`)) n += 1
  return `${name}_${n}`
}

/**
 * A new, empty query. Write queries carry `rowLimit: 0` (they return a row
 * count, not rows, as in the fixtures); HTTP read queries use GET.
 */
export function newQuery(doc: Document, input: { name: string; sourceId: string; kind: DataSourceKind; mode: QueryMode }): Query {
  return {
    id: freeQueryId(doc, input.name),
    name: input.name,
    sourceId: input.sourceId,
    mode: input.mode,
    ...(input.kind === 'postgres' ? { sql: { text: '' } } : { http: { method: input.mode === 'read' ? 'GET' : 'POST', path: '/' } }),
    params: [],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    rowLimit: input.mode === 'read' ? DEFAULT_ROW_LIMIT : 0,
  }
}

/** Switching mode keeps the text; the row limit and an HTTP read's method follow the mode. */
export function setMode(query: Query, mode: QueryMode): Query {
  if (query.mode === mode) return query
  return {
    ...query,
    mode,
    rowLimit: mode === 'read' ? DEFAULT_ROW_LIMIT : 0,
    ...(query.http && mode === 'read' ? { http: { ...query.http, method: 'GET' as const, body: undefined } } : {}),
  }
}
