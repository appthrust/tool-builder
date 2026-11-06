// Tool Builder API (`/api/tool-builder/v1/*`, served by cmd/server
// from the SPA's own origin). The OIDC edge attaches the caller's bearer; the
// SPA never sees a token. Lists are `{data: [...]}`, single resources are direct
// objects, errors are `{error, message}` (console envelope). This file is the
// DTO contract the Go server (cmd/server/internal/api) and the
// in-repo mock (src/dev/mock-server.ts) both implement.
// Design: https://github.com/appthrust/platform/blob/main/design/platform/builtin-app-tool-builder/tool-builder-builtin-app.md "API".
import type { Document } from '../model/document'

export type Me = {
  subject: string
  personId: string | null
  displayName: string
  effectiveGroupIds: string[]
  roles: { admin: boolean }
}

export type DataSourceKind = 'postgres' | 'http' | 'builtin-app'
/**
 * `pending`: the Platform connection exists but this process has not seen its env key yet (rollout); for
 * a `builtin-app` source, the linked built-in app is still installing. `error` on a `builtin-app` source: the built-in app is
 * not installed (or not usable), `statusMessage` says which.
 */
export type DataSourceStatus = 'pending' | 'ready' | 'error'

export type DataSource = {
  id: string
  slug: string
  kind: DataSourceKind
  name: string
  /** postgres: the ComponentConnection name; env key is `<UPPER(connectionName)>_URL` with `-` → `_` (platform `connectionenv` convention). */
  connectionName?: string | null
  /** postgres: Platform database component id. http: Platform web component id. Absent for builtin-app. */
  destinationComponentId?: string
  /** http only: resolved in-cluster base URL. */
  baseUrl?: string | null
  /** builtin-app only: the linked built-in app's definition name (`directory`, `knowledge`, …); resolved on every run. */
  definition?: string
  status: DataSourceStatus
  statusMessage: string | null
  createdBy: string
  createdAt: string
}

export type CreateDataSourceInput =
  | {
      kind: 'postgres' | 'http'
      name: string
      slug: string
      /** postgres: becomes the connection name; DNS label. */
      connectionName?: string
      destinationComponentId: string
    }
  /** 400 `link_not_declared` when `definition` is not one of this built-in app's links. */
  | { kind: 'builtin-app'; name: string; slug: string; definition: string }

/** Where a linked built-in app stands in this Project (Platform read model `status.links[].state`). */
export type InstalledAppLinkState = 'Absent' | 'Installing' | 'Ready' | 'Unsupported'

/** `GET /links`: a built-in app this one may call, as the "Add a built-in app" dialog offers it. */
export type InstalledAppLink = { definition: string; state: InstalledAppLinkState; publicUrl?: string }

/** One parameter of a built-in app operation; `type` is the OpenAPI schema type (string, integer, number, boolean, array, object). */
export type AppOperationParam = { name: string; in: 'path' | 'query' | 'body'; type: string; required: boolean }

/**
 * `GET /data-sources/{id}/operations`: what a `builtin-app` source can be asked. `path` is the full request
 * path on the built-in app (e.g. `/api/directory/v1/groups/{id}/members`) with `{name}` path parameters;
 * `resultPath` is where the rows are in the response.
 */
export type AppOperation = {
  id: string
  method: string
  path: string
  summary: string
  resultPath?: string
  params: AppOperationParam[]
}

/** `GET /data-sources/{id}/schema` (postgres only). */
export type SourceSchema = {
  tables: { schema: string; name: string; kind: 'table' | 'view'; columns: { name: string; type: string; nullable: boolean; primaryKey: boolean }[] }[]
}

/** A Project database as the connect dialog lists it (from the Platform API, proxied). */
export type ProjectDatabase = { componentId: string; applicationId: string; applicationName: string; name: string; engine: string; connectable: boolean; reason: string | null }

export type ToolSummary = {
  id: string
  slug: string
  name: string
  description: string
  liveReleaseNumber: number | null
  draftUpdatedAt: string
  /** What the caller may do; both false never appears in a list (filtered out). */
  access: { use: boolean; edit: boolean }
  createdAt: string
  archivedAt: string | null
}

/** `GET /tools/{slug}`: editors get the draft and the live document; users get the live document only (`draft` null). */
export type Tool = ToolSummary & {
  draft: Document | null
  /** ETag-like token for `PUT /draft` `If-Match`. */
  draftVersion: string | null
  live: { releaseNumber: number; document: Document } | null
}

export type CreateToolInput = { slug: string; name: string; description?: string }
export type UpdateToolInput = { name?: string; description?: string }

export type ReleaseChange = { kind: 'component' | 'query' | 'action' | 'page'; op: 'added' | 'removed' | 'changed'; id: string; label: string }

export type Release = {
  id: string
  number: number
  note: string
  changes: ReleaseChange[]
  publishedBy: { subject: string; displayName: string }
  publishedAt: string
  restoredFrom: number | null
  live: boolean
}

/** `GET /tools/{slug}/releases/{n}` adds the document. */
export type ReleaseDetail = Release & { document: Document }

export type GrantRole = 'use' | 'edit'
export type Grants = {
  groups: { groupId: string; role: GrantRole }[]
  /** Absent action id = every `use` group may run it. */
  actions: { actionId: string; groupIds: string[] }[]
}

/** A Directory group as the sharing picker lists it (proxied from the Directory built-in app). */
export type GroupRef = { id: string; path: string; name: string; memberCount: number }

export type QueryRunInput = { inputs: Record<string, unknown>; confirmWrite?: boolean }

export type Column = { name: string; type: string }

export type QueryResult = {
  columns: Column[]
  rows: unknown[][]
  rowCount: number
  truncated: boolean
  durationMs: number
}

export type ActionRunInput = { inputs: Record<string, unknown> }

export type ActionRunResult = { runId: string; rowCount: number; refresh: string[]; durationMs: number }

export type ActionRunStatus = 'ok' | 'failed' | 'denied'

export type ActionRun = {
  id: string
  releaseNumber: number
  actionId: string
  actionLabel: string
  queryId: string
  actor: { subject: string; displayName: string }
  status: ActionRunStatus
  rowCount: number | null
  error: string | null
  startedAt: string
  finishedAt: string
}

/** `{error}` codes the server emits; the SPA maps them to copy. */
export type ErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'tool_forbidden'
  | 'invalid_document'
  | 'draft_changed'
  | 'slug_taken'
  | 'data_source_in_use'
  | 'data_source_pending'
  | 'data_source_busy'
  | 'data_source_unavailable'
  | 'internal_service_required'
  | 'link_not_declared'
  | 'query_not_read_only'
  | 'query_timeout'
  | 'query_failed'
  | 'write_not_confirmed'
  | 'action_denied'
  | 'identity_unavailable'
  | 'tool_builder_store_unavailable'

export type ApiError = { error: ErrorCode | string; message: string; details?: Record<string, unknown> }

/**
 * Routes (all under /api/tool-builder/v1):
 *   GET    /me                                   → Me
 *   GET    /data-sources                         → {data: DataSource[]}        admin or editor of any tool
 *   POST   /data-sources                         → DataSource (201)            admin; built-in app: 400 link_not_declared
 *   DELETE /data-sources/{id}                    → 204                         admin; 409 data_source_in_use
 *   GET    /data-sources/{id}/schema             → SourceSchema                editor of any tool or admin
 *   GET    /data-sources/{id}/operations         → {items: AppOperation[]}   editor of any tool or admin (built-in app only)
 *   GET    /links                                → {items: InstalledAppLink[]}        admin or editor of any tool
 *   GET    /project/databases                    → {data: ProjectDatabase[]}   admin (Platform API with the caller's bearer)
 *   GET    /groups                               → {data: GroupRef[]}          signed in (directory over the link)
 *   GET    /tools                                → {data: ToolSummary[]}
 *   POST   /tools                                → Tool (201)                  admin
 *   GET    /tools/{slug}                         → Tool
 *   PATCH  /tools/{slug}                         → Tool                        editor
 *   DELETE /tools/{slug}                         → 204 (archive)               admin
 *   PUT    /tools/{slug}/draft  (If-Match)       → Tool                        editor; 409 draft_changed {details: {draftVersion, draft}}
 *   POST   /tools/{slug}/draft/queries/{id}/run  → QueryResult                 editor
 *   GET    /tools/{slug}/releases                → {data: Release[]}           editor
 *   GET    /tools/{slug}/releases/{n}            → ReleaseDetail               editor
 *   POST   /tools/{slug}/releases {note} (If-Match) → Release (201)            editor; 400 invalid_document; 409 draft_changed
 *   POST   /tools/{slug}/releases/{n}/restore {note?} → Release (201)          editor
 *   POST   /tools/{slug}/queries/{id}/run        → QueryResult                 use (live document, read only)
 *   POST   /tools/{slug}/actions/{id}/run        → ActionRunResult             use + action grant
 *   GET    /tools/{slug}/grants                  → Grants                      editor
 *   PUT    /tools/{slug}/grants                  → Grants                      editor
 *   GET    /tools/{slug}/runs?limit=             → {data: ActionRun[]}         editor
 */
export const API_BASE = '/api/tool-builder/v1'
