// Per-tool binding store and query scheduler (framework-free; the renderer's
// ToolRuntimeProvider wires it to React). Components write the props they
// expose (`table.selectedRow`, `select.value`, `searchInput.value`,
// `date.value`, `form.values`, `tabs.active`); queries whose params reference
// a changed prop re-run — after 250 ms for text inputs, immediately otherwise.
// Design: https://github.com/appthrust/platform/blob/main/design/platform/builtin-app-tool-builder/tool-builder-builtin-app.md "Binding language", "UI".
import { Store } from '@tanstack/react-store'
import type { QueryResult } from '../api/types'
import type { Component, ComponentType, Document, Query, Ref } from './document'
import { formFieldSchema, literalProp, tabSpecSchema } from './document.schema'
import { z } from 'zod'

/** Exposed props by component id, then by prop head (`selectedRow`, `value`, `values`, `active`). */
export type BindingState = Record<string, Record<string, unknown>>

export type QueryStatus = 'idle' | 'waiting' | 'loading' | 'success' | 'error'

/**
 * One query's run state. `waiting`: a referenced prop is still undefined (the
 * component shows "waiting for input"). `refetching`: a run is in flight while
 * the previous `result` stays visible.
 */
export type QueryState = {
  status: QueryStatus
  result?: QueryResult
  error?: unknown
  ranAt?: number
  refetching: boolean
  /** Param names whose refs are unresolved while `waiting`. */
  missing: string[]
}

export const IDLE_QUERY: QueryState = { status: 'idle', refetching: false, missing: [] }

/** Debounce for props typed character by character. */
export const TEXT_INPUT_DEBOUNCE_MS = 250

/** Types whose exposed props change per keystroke, so dependent runs are debounced. */
const TEXT_SOURCES: readonly ComponentType[] = ['searchInput', 'form']

/** Value at `ref` (`selectedRow.number` walks into the row); undefined when any step is missing. */
export function readRef(state: BindingState, ref: Ref): unknown {
  const [head, ...rest] = ref.prop.split('.')
  let value: unknown = state[ref.component]?.[head ?? '']
  for (const segment of rest) {
    if (value === null || value === undefined || typeof value !== 'object') return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

/**
 * The run inputs of a query, keyed by param name. A literal bind is passed as
 * is; a ref bind is read from the store. `ready` is false while any ref is
 * undefined (null is a value: it binds as SQL NULL / JSON null).
 */
export function resolveInputs(query: Query, state: BindingState): { inputs: Record<string, unknown>; ready: boolean; missing: string[] } {
  const inputs: Record<string, unknown> = {}
  const missing: string[] = []
  for (const param of query.params) {
    if ('ref' in param.bind) {
      const value = readRef(state, param.bind.ref)
      if (value === undefined) missing.push(param.name)
      else inputs[param.name] = value
    } else {
      inputs[param.name] = param.bind.literal
    }
  }
  return { inputs, ready: missing.length === 0, missing }
}

/** The refs a query's params read. */
export function queryRefs(query: Query): Ref[] {
  return query.params.flatMap((param) => ('ref' in param.bind ? [param.bind.ref] : []))
}

/** `componentId.propHead` → ids of queries with a param reading it. */
export function dependencyGraph(document: Document): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  for (const query of document.queries) {
    for (const ref of queryRefs(query)) {
      const key = `${ref.component}.${ref.prop.split('.')[0]}`
      const ids = graph.get(key) ?? []
      if (!ids.includes(query.id)) ids.push(query.id)
      graph.set(key, ids)
    }
  }
  return graph
}

/**
 * Exposed props before any interaction: an empty search, no selection, the
 * first tab, a form with every field unset. Undefined (not set) keeps
 * dependents waiting — e.g. `selectedRow` until a row is clicked.
 */
export function initialBindings(document: Document): BindingState {
  const state: BindingState = {}
  for (const component of document.pages.flatMap((page) => page.components)) {
    const value = initialExposed(component)
    if (value) state[component.id] = value
  }
  return state
}

function initialExposed(component: Component): Record<string, unknown> | undefined {
  switch (component.type) {
    case 'searchInput':
      return { value: '' }
    case 'select':
      return { value: literalProp(component, 'multiple', z.boolean()) === true ? [] : null }
    case 'date':
      return { value: null }
    case 'form': {
      const values: Record<string, unknown> = {}
      for (const field of literalProp(component, 'fields', z.array(formFieldSchema)) ?? []) values[field.name] = field.type === 'boolean' ? false : null
      return { values }
    }
    case 'tabs':
      return { active: literalProp(component, 'tabs', z.array(tabSpecSchema))?.[0]?.id ?? null }
    default:
      return undefined
  }
}

export type QueryRunner = (queryId: string, inputs: Record<string, unknown>) => Promise<QueryResult>

/** `set` returns its cancel function; tests pass a manual clock. */
export type Timers = { set: (fn: () => void, ms: number) => () => void }

const realTimers: Timers = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    return () => clearTimeout(handle)
  },
}

/**
 * The runtime of one rendered tool: bindings, query states, and the scheduler
 * that keeps every active query in step with the props it references. A query
 * is active while at least one mounted component shows it (`activate`); an
 * inactive query that goes stale runs again when next activated.
 */
export type ToolRuntime = {
  bindings: Store<BindingState>
  queries: Store<Record<string, QueryState>>
  /** Writes an exposed prop and schedules dependents (no-op when unchanged). */
  setExposed(componentId: string, prop: string, value: unknown): void
  /** Mounts interest in a query; returns the release function. */
  activate(queryId: string): () => void
  /** Re-runs these queries now (after an action); inactive ones are marked stale. */
  refresh(queryIds: readonly string[]): void
  /** Current inputs of a query from the bindings. */
  inputsOf(queryId: string): { inputs: Record<string, unknown>; ready: boolean; missing: string[] }
  /** Swaps in an edited document (editor canvas): changed active queries re-run, removed state is dropped. */
  setDocument(document: Document): void
  /** Cancels pending debounced runs. The runtime stays usable (React StrictMode re-mounts after a cleanup). */
  dispose(): void
}

export function createToolRuntime(options: { document: Document; run: QueryRunner; timers?: Timers; now?: () => number }): ToolRuntime {
  const timers = options.timers ?? realTimers
  const now = options.now ?? Date.now
  let document = options.document
  let queryById = new Map(document.queries.map((query) => [query.id, query]))
  let graph = dependencyGraph(document)
  let typeById = new Map(document.pages.flatMap((page) => page.components).map((component) => [component.id, component.type]))
  const bindings = new Store<BindingState>(initialBindings(document))
  const queries = new Store<Record<string, QueryState>>({})
  const active = new Map<string, number>()
  const stale = new Set<string>()
  const pending = new Map<string, () => void>()
  const sequence = new Map<string, number>()

  const patch = (queryId: string, next: (prev: QueryState) => QueryState) =>
    queries.setState((prev) => ({ ...prev, [queryId]: next(prev[queryId] ?? IDLE_QUERY) }))

  const run = (queryId: string) => {
    const query = queryById.get(queryId)
    if (!query) return
    stale.delete(queryId)
    const { inputs, ready, missing } = resolveInputs(query, bindings.state)
    const seq = (sequence.get(queryId) ?? 0) + 1
    sequence.set(queryId, seq)
    if (!ready) {
      patch(queryId, () => ({ status: 'waiting', refetching: false, missing }))
      return
    }
    patch(queryId, (prev) =>
      prev.result ? { ...prev, status: 'success', refetching: true, missing: [] } : { status: 'loading', refetching: true, missing: [], error: undefined }
    )
    options.run(queryId, inputs).then(
      (result) => {
        if (sequence.get(queryId) !== seq) return
        patch(queryId, () => ({ status: 'success', result, ranAt: now(), refetching: false, missing: [] }))
      },
      (error: unknown) => {
        if (sequence.get(queryId) !== seq) return
        patch(queryId, (prev) => ({ status: 'error', error, result: prev.result, ranAt: now(), refetching: false, missing: [] }))
      }
    )
  }

  const schedule = (queryId: string, delay: number) => {
    // A dependency changed: whatever is in flight was asked with obsolete inputs, so its answer
    // must not land (it could otherwise publish old rows during the debounce).
    sequence.set(queryId, (sequence.get(queryId) ?? 0) + 1)
    if (!active.has(queryId)) {
      stale.add(queryId)
      return
    }
    pending.get(queryId)?.()
    if (delay <= 0) {
      pending.delete(queryId)
      run(queryId)
      return
    }
    pending.set(
      queryId,
      timers.set(() => {
        pending.delete(queryId)
        run(queryId)
      }, delay)
    )
  }

  return {
    bindings,
    queries,
    setExposed(componentId, prop, value) {
      const current = bindings.state[componentId]?.[prop]
      if (current === value || (typeof value === 'object' && value !== null && JSON.stringify(current) === JSON.stringify(value))) return
      bindings.setState((prev) => ({ ...prev, [componentId]: { ...prev[componentId], [prop]: value } }))
      const type = typeById.get(componentId)
      const delay = type && TEXT_SOURCES.includes(type) ? TEXT_INPUT_DEBOUNCE_MS : 0
      for (const queryId of graph.get(`${componentId}.${prop}`) ?? []) schedule(queryId, delay)
    },
    activate(queryId) {
      const count = active.get(queryId) ?? 0
      active.set(queryId, count + 1)
      if (count === 0 && (stale.has(queryId) || !queries.state[queryId] || queries.state[queryId]!.status === 'idle')) run(queryId)
      let released = false
      return () => {
        if (released) return
        released = true
        const left = (active.get(queryId) ?? 1) - 1
        if (left > 0) {
          active.set(queryId, left)
          return
        }
        active.delete(queryId)
        // Nobody shows the query any more: drop its debounced run and re-run on the next activation.
        const cancel = pending.get(queryId)
        if (cancel) {
          cancel()
          pending.delete(queryId)
          stale.add(queryId)
        }
      }
    },
    refresh(queryIds) {
      for (const queryId of queryIds) schedule(queryId, 0)
    },
    inputsOf(queryId) {
      const query = queryById.get(queryId)
      return query ? resolveInputs(query, bindings.state) : { inputs: {}, ready: false, missing: [] }
    },
    setDocument(next) {
      if (next === document) return
      const before = queryById
      document = next
      queryById = new Map(next.queries.map((query) => [query.id, query]))
      graph = dependencyGraph(next)
      typeById = new Map(next.pages.flatMap((page) => page.components).map((component) => [component.id, component.type]))
      // New components get their initial exposed props; existing ones keep what the user did.
      const initial = initialBindings(next)
      bindings.setState((prev) => {
        const merged: BindingState = {}
        for (const id of typeById.keys()) {
          const value = prev[id] ?? initial[id]
          if (value) merged[id] = value
        }
        return merged
      })
      queries.setState((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => queryById.has(id))))
      for (const [queryId, query] of queryById) {
        const old = before.get(queryId)
        if (!old || JSON.stringify(old) !== JSON.stringify(query)) schedule(queryId, TEXT_INPUT_DEBOUNCE_MS)
      }
    },
    dispose() {
      for (const cancel of pending.values()) cancel()
      pending.clear()
    },
  }
}
