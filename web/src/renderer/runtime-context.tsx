// React wiring of one rendered tool: owns the per-tool binding store and
// query scheduler (model/bindings.ts), runs read queries against the live
// release or the draft, runs actions, and collects action notices. The
// runtime page and the editor canvas both render inside it.
import { useSelector } from '@tanstack/react-store'
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { QueryResult } from '../api/types'
import { createToolRuntime, IDLE_QUERY, readRef, type QueryState, type ToolRuntime } from '../model/bindings'
import type { Action, Component, Document, Query } from '../model/document'

/** `live`: the published release (`/queries/{id}/run`, `/actions/{id}/run`). `draft`: the editor's draft (`/draft/queries/{id}/run`). */
export type RuntimeSource = 'live' | 'draft'

export type RuntimeNotice = { id: number; tone: 'success' | 'error'; text: string }

export type ActionOutcome = { rowCount: number; refreshed: string[] }

export type ToolRuntimeContextValue = {
  slug: string
  document: Document
  source: RuntimeSource
  /** False in the editor canvas: buttons, row actions and submits render inert. */
  actionsEnabled: boolean
  runtime: ToolRuntime
  /** Components of the (single) page. */
  components: Component[]
  componentById: ReadonlyMap<string, Component>
  queryById: ReadonlyMap<string, Query>
  wrapComponent?: (component: Component, node: ReactNode) => ReactNode
  /** Runs an action's write query with the current bindings; refreshes the queries it names. */
  runAction(action: Action, inputs: Record<string, unknown>): Promise<ActionOutcome>
  notices: RuntimeNotice[]
  notify(tone: RuntimeNotice['tone'], text: string): void
  dismiss(id: number): void
}

const ToolRuntimeContext = createContext<ToolRuntimeContextValue | null>(null)

const NOTICE_TTL_MS = 6_000

export function ToolRuntimeProvider({
  slug,
  document,
  source,
  actions = 'enabled',
  wrapComponent,
  runtime: injected,
  children,
}: {
  slug: string
  document: Document
  source: RuntimeSource
  actions?: 'enabled' | 'disabled'
  wrapComponent?: (component: Component, node: ReactNode) => ReactNode
  /** A pre-built runtime (tests with a fake runner); default runs queries through the API. */
  runtime?: ToolRuntime
  children: ReactNode
}) {
  // The runner reads the latest slug/source so the runtime is created once per mount.
  const target = useRef({ slug, source })
  target.current = { slug, source }
  const [runtime] = useState(
    () =>
      injected ??
      createToolRuntime({
        document,
        run: (queryId, inputs): Promise<QueryResult> =>
          target.current.source === 'draft'
            ? api.tools.runDraftQuery(target.current.slug, queryId, { inputs })
            : api.tools.runQuery(target.current.slug, queryId, { inputs }),
      })
  )
  useEffect(() => runtime.setDocument(document), [runtime, document])
  useEffect(() => () => runtime.dispose(), [runtime])

  const [notices, setNotices] = useState<RuntimeNotice[]>([])
  const nextNotice = useRef(1)
  const dismiss = useCallback((id: number) => setNotices((prev) => prev.filter((notice) => notice.id !== id)), [])
  const notify = useCallback(
    (tone: RuntimeNotice['tone'], text: string) => {
      const id = nextNotice.current++
      setNotices((prev) => [...prev.slice(-2), { id, tone, text }])
      window.setTimeout(() => dismiss(id), NOTICE_TTL_MS)
    },
    [dismiss]
  )

  const runAction = useCallback(
    async (action: Action, inputs: Record<string, unknown>): Promise<ActionOutcome> => {
      if (source === 'draft') {
        // The draft's action may not exist in the live release, so the preview runs its write query
        // through the editor's draft endpoint (recorded by the server as a run without an action id).
        const result = await api.tools.runDraftQuery(slug, action.queryId, { inputs, confirmWrite: true })
        const refreshed = action.onSuccess?.refresh ?? []
        runtime.refresh(refreshed)
        return { rowCount: result.rowCount, refreshed }
      }
      const result = await api.tools.runAction(slug, action.id, { inputs })
      runtime.refresh(result.refresh)
      return { rowCount: result.rowCount, refreshed: result.refresh }
    },
    [runtime, slug, source]
  )

  const value = useMemo<ToolRuntimeContextValue>(() => {
    const components = document.pages[0]?.components ?? []
    return {
      slug,
      document,
      source,
      actionsEnabled: actions === 'enabled',
      runtime,
      components,
      componentById: new Map(components.map((component) => [component.id, component])),
      queryById: new Map(document.queries.map((query) => [query.id, query])),
      wrapComponent,
      runAction,
      notices,
      notify,
      dismiss,
    }
  }, [actions, dismiss, document, notices, notify, runAction, runtime, slug, source, wrapComponent])

  return <ToolRuntimeContext value={value}>{children}</ToolRuntimeContext>
}

export function useToolRuntime(): ToolRuntimeContextValue {
  const value = use(ToolRuntimeContext)
  if (!value) throw new Error('useToolRuntime outside ToolRuntimeProvider')
  return value
}

/**
 * The run state of a read query; mounting activates it (first activation
 * runs it, later binding changes re-run it). Undefined id → idle.
 */
export function useQueryResult(queryId: string | undefined): QueryState {
  const { runtime } = useToolRuntime()
  useEffect(() => (queryId ? runtime.activate(queryId) : undefined), [runtime, queryId])
  return useSelector(runtime.queries, (state) => (queryId ? (state[queryId] ?? IDLE_QUERY) : IDLE_QUERY))
}

/** A prop a component exposes (`value`, `selectedRow`, `values`, `active`). */
export function useExposed(componentId: string, prop: string): unknown {
  const { runtime } = useToolRuntime()
  return useSelector(runtime.bindings, (state) => state[componentId]?.[prop])
}

/** A component prop's current value: the literal, or the referenced exposed prop. */
export function usePropValue(component: Component, name: string): unknown {
  const { runtime } = useToolRuntime()
  const prop = component.props[name]
  return useSelector(runtime.bindings, (state) => (prop?.kind === 'ref' ? readRef(state, prop.ref) : prop?.value), {
    compare: (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b),
  })
}

/** The run state of a query without activating it (property panel, status bar). Undefined id → idle. */
export function useQueryState(queryId: string | undefined): QueryState {
  const { runtime } = useToolRuntime()
  return useSelector(runtime.queries, (state) => (queryId ? (state[queryId] ?? IDLE_QUERY) : IDLE_QUERY))
}

/** Query rows as objects keyed by column name. */
export function rowObjects(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]])))
}
