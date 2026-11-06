// The change list between two documents, computed in the browser for the
// draft card ("N unpublished changes", the publish sheet) and the release
// "Compare with live" view. It must equal the server's `domain.Changes(live,
// draft)` that a publish stores on the release, so the rules are mirrored
// one-for-one (agreed with the server owner):
//
// - kinds in order page, component, action, query;
// - within a kind: walk `to` in document order emitting added/changed, then
//   walk `from` in document order emitting removed;
// - keys: page id; component id across pages; action id across components
//   (component walk order, then action order); query id;
// - changed = semantic JSON inequality: a page compares only its title, a
//   component compares itself without `actions`, actions and queries compare
//   the whole object;
// - labels: page title else id; component `props.label` / `props.title`
//   string value else id; action label else id; query name else id — taken
//   from `to` for added/changed, from `from` for removed.
import type { ReleaseChange } from '../../../api/types'
import type { Action, Component, Document, Page, Query } from '../../../model/document'

type Kind = ReleaseChange['kind']

// Fields the Go side marshals with `omitempty` on strings: an empty string
// and an absent key are the same document there, so they must be here too.
const OMIT_EMPTY_STRING: Record<string, true> = { parentId: true, body: true, resultPath: true }

/** JSON-normalised value: undefined/null object members and omit-empty strings dropped, keys sorted. */
function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise)
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const member = (value as Record<string, unknown>)[key]
    if (member === undefined || member === null) continue
    if (member === '' && OMIT_EMPTY_STRING[key]) continue
    out[key] = normalise(member)
  }
  return out
}

/** Semantic JSON equality as the server applies it. */
export function sameJSON(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b))
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function componentLabel(component: Component): string {
  const label = component.props.label
  const title = component.props.title
  return (
    (label?.kind === 'value' ? nonEmptyString(label.value) : undefined) ??
    (title?.kind === 'value' ? nonEmptyString(title.value) : undefined) ??
    component.id
  )
}

type Entry<T> = { id: string; label: string; item: T }

function diffKind<T>(kind: Kind, from: Entry<T>[], to: Entry<T>[], equal: (a: T, b: T) => boolean): ReleaseChange[] {
  const before = new Map(from.map((entry) => [entry.id, entry]))
  const after = new Set(to.map((entry) => entry.id))
  const changes: ReleaseChange[] = []
  for (const entry of to) {
    const old = before.get(entry.id)
    if (!old) changes.push({ kind, op: 'added', id: entry.id, label: entry.label })
    else if (!equal(old.item, entry.item)) changes.push({ kind, op: 'changed', id: entry.id, label: entry.label })
  }
  for (const entry of from) {
    if (!after.has(entry.id)) changes.push({ kind, op: 'removed', id: entry.id, label: entry.label })
  }
  return changes
}

function pages(doc: Document): Entry<Page>[] {
  return doc.pages.map((page) => ({ id: page.id, label: page.title || page.id, item: page }))
}

function components(doc: Document): Entry<Component>[] {
  return doc.pages.flatMap((page) => page.components.map((component) => ({ id: component.id, label: componentLabel(component), item: component })))
}

function actions(doc: Document): Entry<Action>[] {
  return doc.pages.flatMap((page) =>
    page.components.flatMap((component) => (component.actions ?? []).map((action) => ({ id: action.id, label: action.label || action.id, item: action }))),
  )
}

function queries(doc: Document): Entry<Query>[] {
  return doc.queries.map((query) => ({ id: query.id, label: query.name || query.id, item: query }))
}

/** Changes that turn `from` (the live document, or null before the first release) into `to`. */
export function documentChanges(from: Document | null, to: Document): ReleaseChange[] {
  const base: Document = from ?? { schemaVersion: to.schemaVersion, pages: [], queries: [] }
  return [
    ...diffKind('page', pages(base), pages(to), (a, b) => a.title === b.title),
    ...diffKind('component', components(base), components(to), (a, b) => {
      const { actions: _a, ...left } = a
      const { actions: _b, ...right } = b
      return sameJSON(left, right)
    }),
    ...diffKind('action', actions(base), actions(to), sameJSON),
    ...diffKind('query', queries(base), queries(to), sameJSON),
  ]
}

type CompareSide<K, T> = { kind: K; id: string; label: string; op: ReleaseChange['op']; left: T | undefined; right: T | undefined }
export type CompareRow = CompareSide<'component', Component> | CompareSide<'query', Query>

/**
 * Side-by-side rows of "Compare with live": the components and queries that
 * differ between `left` (the release being viewed) and `right` (live), with
 * both versions so the sheet can show them next to each other. `op` reads
 * from live's point of view (added = only in the viewed release).
 */
export function compareDocuments(left: Document, right: Document | null): CompareRow[] {
  const leftComponents = new Map(components(left).map((entry) => [entry.id, entry.item]))
  const leftQueries = new Map(queries(left).map((entry) => [entry.id, entry.item]))
  const rightComponents = new Map(right ? components(right).map((entry) => [entry.id, entry.item]) : [])
  const rightQueries = new Map(right ? queries(right).map((entry) => [entry.id, entry.item]) : [])
  return documentChanges(right, left).flatMap((change): CompareRow[] => {
    if (change.kind === 'component') {
      return [{ kind: 'component', id: change.id, label: change.label, op: change.op, left: leftComponents.get(change.id), right: rightComponents.get(change.id) }]
    }
    if (change.kind === 'query') {
      return [{ kind: 'query', id: change.id, label: change.label, op: change.op, left: leftQueries.get(change.id), right: rightQueries.get(change.id) }]
    }
    return []
  })
}
