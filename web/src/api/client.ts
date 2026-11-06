// Fetch wrapper over the tool-builder API (`API_BASE`, routes and DTOs in
// ./types). The OIDC edge in front of cmd/server attaches the
// caller's bearer; the SPA never sees or requests a token.
import type { Document } from '../model/document'
import {
  API_BASE,
  type ActionRun,
  type ActionRunInput,
  type ActionRunResult,
  type InstalledAppLink,
  type AppOperation,
  type ApiError,
  type CreateDataSourceInput,
  type CreateToolInput,
  type DataSource,
  type ErrorCode,
  type Grants,
  type GroupRef,
  type Me,
  type ProjectDatabase,
  type QueryResult,
  type QueryRunInput,
  type Release,
  type ReleaseDetail,
  type SourceSchema,
  type Tool,
  type ToolSummary,
  type UpdateToolInput,
} from './types'

/**
 * Non-2xx tool-builder response. `code` is the server's `error` (an `ErrorCode`);
 * `details` carries the structured part (e.g. `draft_changed` → `{draftVersion}`).
 * `transient` = no error envelope came back: a 5xx from a proxy in front of the
 * server (rollout gap), no response at all (status 0), or a 2xx whose body is
 * not JSON (an edge or proxy page, not the server's answer). A coded 5xx such
 * as `data_source_pending` is an answer, not a transient failure.
 */
export class ToolBuilderApiError extends Error {
  readonly status: number
  readonly code: ErrorCode | string
  readonly transient: boolean
  readonly details: Record<string, unknown> | undefined

  constructor(status: number, body: Partial<ApiError> | undefined, notJson = false) {
    const code = typeof body?.error === 'string' ? body.error : undefined
    super(typeof body?.message === 'string' && body.message ? body.message : `tool-builder api ${status}`)
    this.name = 'ToolBuilderApiError'
    this.status = status
    this.code = code ?? (status === 404 ? 'not_found' : 'unknown')
    this.transient = code === undefined && (notJson || status === 0 || status >= 500)
    this.details = body?.details && typeof body.details === 'object' ? body.details : undefined
  }
}

export function isApiError(error: unknown, code?: ErrorCode): error is ToolBuilderApiError {
  return error instanceof ToolBuilderApiError && (code === undefined || error.code === code)
}

const READ_TIMEOUT_MS = 8_000
// A 401 first sends the browser to `/` so the edge re-runs sign-in. Another 401
// within this window means the edge forwards a token the server rejects;
// redirecting again would loop, so that 401 reaches the screens instead.
const REAUTH_WINDOW_MS = 60_000
const REAUTH_AT_KEY = 'tool-builder:reauth-at'

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>

export interface ToolBuilderApi {
  me(): Promise<Me>
  dataSources: {
    /** Admins and editors of any tool. */
    list(): Promise<DataSource[]>
    /** Admin; the new source starts `pending` until the rollout carries its connection. */
    create(input: CreateDataSourceInput): Promise<DataSource>
    /** Admin; 409 `data_source_in_use` while a draft or the live release references it. */
    remove(id: string): Promise<void>
    /** Postgres only; editors of any tool and admins. */
    schema(id: string): Promise<SourceSchema>
    /** `builtin-app` sources only: the operations the linked built-in app offers (its live contract, else the compiled one). */
    operations(id: string): Promise<AppOperation[]>
  }
  /** Admin; the Project's databases the connect dialog offers. */
  projectDatabases(): Promise<ProjectDatabase[]>
  /** The built-in apps this one may call and whether each is installed; the "Add built-in app source" candidates. */
  links(): Promise<InstalledAppLink[]>
  /** Directory groups for the sharing picker. */
  groups(): Promise<GroupRef[]>
  tools: {
    list(): Promise<ToolSummary[]>
    /** Admin; 409 `slug_taken`. */
    create(input: CreateToolInput): Promise<Tool>
    /** 403 `tool_forbidden` without a grant; `draft` is null for users. */
    get(slug: string): Promise<Tool>
    update(slug: string, input: UpdateToolInput): Promise<Tool>
    /** Admin; archives. */
    archive(slug: string): Promise<void>
    /** Whole document with `If-Match: draftVersion` (compared exactly); 409 `draft_changed` with `details.{draftVersion, draft}`. */
    saveDraft(slug: string, document: Document, draftVersion: string): Promise<Tool>
    /** Editor; runs a draft query. A write query needs `confirmWrite: true` (else 400 `write_not_confirmed`). */
    runDraftQuery(slug: string, queryId: string, input: QueryRunInput): Promise<QueryResult>
    /** `use`; a read query of the live release. */
    runQuery(slug: string, queryId: string, input: QueryRunInput): Promise<QueryResult>
    /** `use` + action grant; 403 `action_denied`. */
    runAction(slug: string, actionId: string, input: ActionRunInput): Promise<ActionRunResult>
  }
  releases: {
    list(slug: string): Promise<Release[]>
    get(slug: string, number: number): Promise<ReleaseDetail>
    /** 400 `invalid_document` when the draft does not validate; `If-Match: draftVersion`, 409 `draft_changed` when another draft was saved since. */
    publish(slug: string, note: string, draftVersion: string): Promise<Release>
    restore(slug: string, number: number, note?: string): Promise<Release>
  }
  grants: {
    get(slug: string): Promise<Grants>
    /** Replaces the whole grant set. */
    put(slug: string, grants: Grants): Promise<Grants>
  }
  runs: {
    /** Most recent first. */
    list(slug: string, limit?: number): Promise<ActionRun[]>
  }
}

export function createToolBuilderApi(fetcher: Fetcher = (input, init) => fetch(input, init), reauth: () => boolean = browserReauth): ToolBuilderApi {
  async function send<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const read = method === 'GET'
    let response: Response
    try {
      response = await fetcher(`${API_BASE}${path}`, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        // Reads are bounded; query and action runs carry their own server-side timeout (up to 30 s).
        signal: read ? AbortSignal.timeout(READ_TIMEOUT_MS) : undefined,
      })
    } catch {
      // Network failure or read timeout: nothing answered.
      throw new ToolBuilderApiError(0, undefined)
    }
    if (response.status === 401 && reauth()) return new Promise<T>(() => {})
    if (!response.ok) {
      let parsed: Partial<ApiError> | undefined
      try {
        parsed = (await response.json()) as Partial<ApiError>
      } catch {
        parsed = undefined
      }
      throw new ToolBuilderApiError(response.status, parsed)
    }
    if (response.status === 204) return undefined as T
    try {
      return (await response.json()) as T
    } catch {
      throw new ToolBuilderApiError(response.status, undefined, true)
    }
  }
  const list = async <T>(path: string) => (await send<{ data: T[] }>('GET', path)).data
  // Built-in app link routes answer with the shared built-in app envelope `{items}`.
  const items = async <T>(path: string) => (await send<{ items: T[] }>('GET', path)).items
  const id = encodeURIComponent
  const tool = (slug: string) => `/tools/${id(slug)}`

  return {
    me: () => send<Me>('GET', '/me'),
    dataSources: {
      list: () => list<DataSource>('/data-sources'),
      create: (input) => send<DataSource>('POST', '/data-sources', input),
      remove: (sourceId) => send<void>('DELETE', `/data-sources/${id(sourceId)}`),
      schema: (sourceId) => send<SourceSchema>('GET', `/data-sources/${id(sourceId)}/schema`),
      operations: (sourceId) => items<AppOperation>(`/data-sources/${id(sourceId)}/operations`),
    },
    projectDatabases: () => list<ProjectDatabase>('/project/databases'),
    links: () => items<InstalledAppLink>('/links'),
    groups: () => list<GroupRef>('/groups'),
    tools: {
      list: () => list<ToolSummary>('/tools'),
      create: (input) => send<Tool>('POST', '/tools', input),
      get: (slug) => send<Tool>('GET', tool(slug)),
      update: (slug, input) => send<Tool>('PATCH', tool(slug), input),
      archive: (slug) => send<void>('DELETE', tool(slug)),
      saveDraft: (slug, document, draftVersion) => send<Tool>('PUT', `${tool(slug)}/draft`, document, { 'If-Match': draftVersion }),
      runDraftQuery: (slug, queryId, input) => send<QueryResult>('POST', `${tool(slug)}/draft/queries/${id(queryId)}/run`, input),
      runQuery: (slug, queryId, input) => send<QueryResult>('POST', `${tool(slug)}/queries/${id(queryId)}/run`, input),
      runAction: (slug, actionId, input) => send<ActionRunResult>('POST', `${tool(slug)}/actions/${id(actionId)}/run`, input),
    },
    releases: {
      list: (slug) => list<Release>(`${tool(slug)}/releases`),
      get: (slug, number) => send<ReleaseDetail>('GET', `${tool(slug)}/releases/${number}`),
      publish: (slug, note, draftVersion) => send<Release>('POST', `${tool(slug)}/releases`, { note }, { 'If-Match': draftVersion }),
      restore: (slug, number, note) => send<Release>('POST', `${tool(slug)}/releases/${number}/restore`, note === undefined ? {} : { note }),
    },
    grants: {
      get: (slug) => send<Grants>('GET', `${tool(slug)}/grants`),
      put: (slug, grants) => send<Grants>('PUT', `${tool(slug)}/grants`, grants),
    },
    runs: {
      list: (slug, limit) => list<ActionRun>(`${tool(slug)}/runs${limit === undefined ? '' : `?${new URLSearchParams({ limit: String(limit) })}`}`),
    },
  }
}

function browserReauth(): boolean {
  const lastReauthAt = Number(sessionStorage.getItem(REAUTH_AT_KEY))
  if (Date.now() - lastReauthAt < REAUTH_WINDOW_MS) return false
  sessionStorage.setItem(REAUTH_AT_KEY, String(Date.now()))
  window.location.assign('/')
  return true
}

export const api = createToolBuilderApi()
