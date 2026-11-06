// The tool document: the single JSON value a tool is made of. The draft is a
// mutable Document; a release is an immutable copy. This file is the TYPE
// contract shared with the Go server (cmd/server/internal/domain/document.go);
// the zod schema and validation live in document.schema.ts and must accept
// exactly the golden fixtures under
// cmd/server/internal/domain/testdata/documents/{valid,invalid}.
// Design: https://github.com/appthrust/platform/blob/main/design/platform/builtin-app-tool-builder/tool-builder-builtin-app.md "Document".

export const DOCUMENT_SCHEMA_VERSION = 1

export type ComponentType =
  | 'table'
  | 'detail'
  | 'form'
  | 'chart'
  | 'stat'
  | 'text'
  | 'select'
  | 'date'
  | 'searchInput'
  | 'button'
  | 'container'
  | 'tabs'
  | 'divider'

export const COMPONENT_TYPES: readonly ComponentType[] = [
  'table',
  'detail',
  'form',
  'chart',
  'stat',
  'text',
  'select',
  'date',
  'searchInput',
  'button',
  'container',
  'tabs',
  'divider',
]

/** 12-column grid units; `h` is in rows of 40px. */
export type Layout = { x: number; y: number; w: number; h: number }

/** A reference to a prop another component exposes, e.g. `{ component: 'search', prop: 'value' }` or `{ component: 'orders', prop: 'selectedRow.id' }`. */
export type Ref = { component: string; prop: string }

export type Prop = { kind: 'value'; value: unknown } | { kind: 'ref'; ref: Ref }

export type ParamType = 'text' | 'number' | 'boolean' | 'date' | 'timestamp' | 'textList' | 'numberList'

export const PARAM_TYPES: readonly ParamType[] = ['text', 'number', 'boolean', 'date', 'timestamp', 'textList', 'numberList']

export type ParamBind = { ref: Ref } | { literal: unknown }

/** A bound query value, used by a `{{ name }}` placeholder or a structured filter. */
export type Param = { name: string; type: ParamType; bind: ParamBind }

export type QueryMode = 'read' | 'write'

export const FILTER_OPS = ['eq', 'neq', 'contains', 'gte', 'lte', 'in'] as const
export type FilterOp = (typeof FILTER_OPS)[number]
export type Filter = { column: string; op: FilterOp; param: string; skipWhenEmpty: boolean }

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export type Query = {
  id: string
  name: string
  /** DataSource id (tool-builder API), not a Platform component id. */
  sourceId: string
  mode: QueryMode
  sql?: { text: string }
  http?: { method: HttpMethod; path: string; body?: string; resultPath?: string }
  params: Param[]
  /** Read SQL only. Values remain bound parameters, never SQL fragments. */
  filters?: Filter[]
  /** Default 10000, max 30000. */
  timeoutMs: number
  /** Read queries only. Default 500, max 5000. */
  rowLimit: number
}

export type Action = {
  id: string
  label: string
  /** Must reference a query with mode 'write'. */
  queryId: string
  confirm?: { title: string; body: string }
  /** Params of the query may bind to `form.values.<field>` of this component. */
  input?: { formComponent: string }
  /** Query ids to re-run after success. */
  onSuccess?: { refresh: string[] }
}

export type Component = {
  id: string
  type: ComponentType
  layout: Layout
  parentId?: string
  props: Record<string, Prop>
  actions?: Action[]
}

export type Page = { id: string; title: string; components: Component[] }

export type Document = {
  schemaVersion: typeof DOCUMENT_SCHEMA_VERSION
  /** v1: exactly one page. */
  pages: Page[]
  queries: Query[]
}

/**
 * Props each component type exposes to references (`Ref.prop`), by type.
 * `table`: `selectedRow` (and `selectedRow.<column>`), `select`: `value`,
 * `searchInput`: `value`, `date`: `value`, `form`: `values` (and `values.<field>`),
 * `tabs`: `active`. Other types expose nothing.
 */
export const EXPOSED_PROPS: Readonly<Record<ComponentType, readonly string[]>> = {
  table: ['selectedRow'],
  detail: [],
  form: ['values'],
  chart: [],
  stat: [],
  text: [],
  select: ['value'],
  date: ['value'],
  searchInput: ['value'],
  button: [],
  container: [],
  tabs: ['active'],
  divider: [],
}

/**
 * The props a component of `type` exposes. A component read from a document may carry a type this build
 * does not know (`unknown_component_type`); it exposes nothing.
 */
export function exposedPropsOf(type: string): readonly string[] {
  return Object.hasOwn(EXPOSED_PROPS, type) ? EXPOSED_PROPS[type as ComponentType] : []
}

/** A path prop (`selectedRow.id`, `values.amount`) is exposed when its first segment is. */
export function isExposedProp(type: string, prop: string): boolean {
  const head = prop.split('.')[0] ?? ''
  return exposedPropsOf(type).includes(head)
}

/**
 * `{{ name }}` placeholders in query text, in order of first appearance, deduplicated.
 * The padding is ASCII whitespace only (Go RE2 `\s` = `[\t\n\f\r ]`), so a
 * placeholder padded with another space character is malformed on both sides.
 */
export const PLACEHOLDER = /\{\{[\t\n\f\r ]*([A-Za-z_][A-Za-z0-9_]*)[\t\n\f\r ]*\}\}/g

export function placeholdersOf(text: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? ''
    if (!seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

export function emptyDocument(): Document {
  return { schemaVersion: DOCUMENT_SCHEMA_VERSION, pages: [{ id: 'main', title: '', components: [] }], queries: [] }
}
