// Zod schema and validation of the tool Document (types in ./document.ts).
// Mirrors cmd/server/internal/domain validation rule for rule:
// both sides accept/reject the golden fixtures under
// cmd/server/internal/domain/testdata/documents identically and
// report the same first problem code. Problems are ordered by PHASE (the
// order of `PROBLEM_CODES`), within a phase by document order; a `schema`
// problem short-circuits every later phase.
// Design: https://github.com/appthrust/platform/blob/main/design/platform/builtin-app-tool-builder/tool-builder-builtin-app.md "Document".
import { z } from 'zod'
import {
  COMPONENT_TYPES,
  DOCUMENT_SCHEMA_VERSION,
  EXPOSED_PROPS,
  FILTER_OPS,
  PARAM_TYPES,
  PLACEHOLDER,
  placeholdersOf,
  type Component,
  type ComponentType,
  type Document,
  type Query,
  type Ref,
} from './document'

/** Reason codes in phase order; the first problem of a document is from the earliest failing phase. */
export const PROBLEM_CODES = [
  'schema',
  'one_page_required',
  'unknown_component_type',
  'duplicate_id',
  'layout_out_of_grid',
  'unknown_parent',
  'query_source_missing',
  'empty_query',
  'timeout_out_of_range',
  'row_limit_out_of_range',
  'positional_placeholder',
  'multiple_statements',
  'placeholder_in_literal',
  'placeholder_without_param',
  'param_without_placeholder',
  'filter_not_supported',
  'filter_param_unknown',
  'filter_param_type',
  'filter_column_invalid',
  'unknown_query',
  'write_query_not_action',
  'unknown_action_query',
  'action_query_not_write',
  'unknown_form_component',
  'unknown_ref_component',
  'prop_not_exposed',
  'binding_cycle',
] as const

export type ProblemCode = (typeof PROBLEM_CODES)[number]

/** `path` is dotted with numeric indices (`pages.0.components.3.props.query`); `''` is the whole document. */
export type Problem = { code: ProblemCode; path: string; message: string }

export const GRID_COLUMNS = 12
export const MAX_TIMEOUT_MS = 30_000
export const DEFAULT_TIMEOUT_MS = 10_000
export const MAX_ROW_LIMIT = 5_000
export const DEFAULT_ROW_LIMIT = 500

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

// ---------------------------------------------------------------------------
// Shape

const nonEmpty = z.string().min(1)
const int = z.number().int()

export const refSchema = z.object({ component: nonEmpty, prop: nonEmpty })

export const propSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), value: z.unknown().optional() }),
  z.object({ kind: z.literal('ref'), ref: refSchema }),
])

export const layoutSchema = z.object({ x: int, y: int, w: int, h: int })

export const actionSchema = z.object({
  id: nonEmpty,
  label: nonEmpty,
  queryId: nonEmpty,
  confirm: z.object({ title: z.string(), body: z.string() }).optional(),
  input: z.object({ formComponent: nonEmpty }).optional(),
  onSuccess: z.object({ refresh: z.array(z.string()) }).optional(),
})

export const componentSchema = z.object({
  id: nonEmpty,
  // Any string: an unknown type is its own problem (`unknown_component_type`), not a shape error.
  type: z.string(),
  layout: layoutSchema,
  parentId: nonEmpty.optional(),
  props: z.record(z.string(), propSchema),
  actions: z.array(actionSchema).optional(),
})

export const pageSchema = z.object({ id: nonEmpty, title: z.string(), components: z.array(componentSchema) })

/** `{ref}` or `{literal}` (literal may be JSON null); exactly one key. */
export const paramBindSchema = z
  .object({ ref: refSchema.optional(), literal: z.unknown().optional() })
  .superRefine((bind, ctx) => {
    const hasRef = 'ref' in bind && bind.ref !== undefined
    const hasLiteral = 'literal' in bind
    if (hasRef === hasLiteral) ctx.addIssue({ code: 'custom', message: 'bind must have exactly one of ref or literal' })
  })

export const paramSchema = z.object({
  name: z.string().regex(IDENTIFIER),
  type: z.enum(PARAM_TYPES as unknown as [string, ...string[]]),
  bind: paramBindSchema,
})

export const filterSchema = z.object({
  column: z.string(),
  op: z.enum(FILTER_OPS),
  param: z.string(),
  skipWhenEmpty: z.boolean(),
})

export const querySchema = z.object({
  id: nonEmpty,
  name: nonEmpty,
  sourceId: nonEmpty,
  mode: z.enum(['read', 'write']),
  // Empty text is `empty_query` (a draft may hold a query not written yet), not a shape error.
  sql: z.object({ text: z.string() }).optional(),
  http: z
    .object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      path: z.string().startsWith('/'),
      body: z.string().optional(),
      resultPath: z.string().optional(),
    })
    .optional(),
  params: z.array(paramSchema),
  filters: z.array(filterSchema).optional(),
  timeoutMs: int,
  rowLimit: int,
})

export const documentSchema = z.object({
  schemaVersion: z.literal(DOCUMENT_SCHEMA_VERSION),
  pages: z.array(pageSchema),
  queries: z.array(querySchema),
})

// ---------------------------------------------------------------------------
// Per-type props. Every listed prop is optional; an absent or null `value`
// means unset. `ref: true` marks props that may be `{kind: 'ref'}`; any other
// prop is value-only. Unlisted prop names are ignored.

export const COLUMN_FORMATS = ['money', 'date', 'datetime', 'number', 'badge'] as const
export type ColumnFormat = (typeof COLUMN_FORMATS)[number]
export const FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'select', 'textarea'] as const
export type FieldType = (typeof FIELD_TYPES)[number]
export const CHART_KINDS = ['bar', 'line', 'area'] as const
export type ChartKind = (typeof CHART_KINDS)[number]
export const STAT_FORMATS = ['number', 'money'] as const
export const BUTTON_VARIANTS = ['primary', 'secondary', 'destructive'] as const
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

export const columnSpecSchema = z.object({ name: nonEmpty, label: z.string().optional(), format: z.enum(COLUMN_FORMATS).optional() })
export type ColumnSpec = z.infer<typeof columnSpecSchema>
export const optionSchema = z.object({ value: z.string(), label: z.string() })
export type OptionSpec = z.infer<typeof optionSchema>
export const formFieldSchema = z.object({
  name: z.string().regex(IDENTIFIER),
  label: z.string().optional(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  options: z.array(optionSchema).optional(),
})
export type FormFieldSpec = z.infer<typeof formFieldSchema>
export const tabSpecSchema = z.object({ id: nonEmpty, label: z.string() })
export type TabSpec = z.infer<typeof tabSpecSchema>

export type PropSpec = { schema: z.ZodType; ref?: true }

const str: PropSpec = { schema: z.string() }

/** Accepted on every type: the tab (id in the tabs parent's `tabs`) a child belongs to. */
export const COMMON_PROP_SPECS: Readonly<Record<string, PropSpec>> = { tab: str }

export const PROP_SPECS: Readonly<Record<ComponentType, Readonly<Record<string, PropSpec>>>> = {
  table: { query: str, columns: { schema: z.array(columnSpecSchema) } },
  detail: { query: str, columns: { schema: z.array(columnSpecSchema) } },
  form: { fields: { schema: z.array(formFieldSchema) }, submitLabel: str },
  chart: { query: str, kind: { schema: z.enum(CHART_KINDS) }, x: str, y: str, title: str },
  stat: { label: str, query: str, column: str, format: { schema: z.enum(STAT_FORMATS) }, delta: { schema: z.string(), ref: true } },
  text: { heading: { schema: z.string(), ref: true }, body: { schema: z.string(), ref: true } },
  select: {
    label: str,
    placeholder: str,
    options: { schema: z.array(optionSchema) },
    multiple: { schema: z.boolean() },
    query: str,
    valueColumn: str,
    labelColumn: str,
  },
  date: { label: str },
  searchInput: { label: str, placeholder: str },
  button: { label: str, variant: { schema: z.enum(BUTTON_VARIANTS) } },
  container: { title: str },
  tabs: { tabs: { schema: z.array(tabSpecSchema) } },
  divider: { label: str },
}

/** The spec of one prop of a type, including the common ones; undefined = unlisted. */
export function propSpecOf(type: ComponentType, name: string): PropSpec | undefined {
  return PROP_SPECS[type][name] ?? COMMON_PROP_SPECS[name]
}

/** Types that carry `actions` (row actions, form submit, button click). */
export const ACTION_TYPES: readonly ComponentType[] = ['table', 'form', 'button']

/** Types whose components may be a `parentId`. */
export const PARENT_TYPES: readonly ComponentType[] = ['container', 'tabs']

// ---------------------------------------------------------------------------
// Helpers shared with the editor and renderer

export function isComponentType(value: string): value is ComponentType {
  return (COMPONENT_TYPES as readonly string[]).includes(value)
}

/**
 * Whether `prop` is exposed by `type`: equal to an exposed head, or a path
 * under `selectedRow` (table) / `values` (form).
 */
export function exposesProp(type: ComponentType, prop: string): boolean {
  const heads = EXPOSED_PROPS[type]
  if (heads.includes(prop)) return true
  const dot = prop.indexOf('.')
  if (dot <= 0 || dot === prop.length - 1) return false
  const head = prop.slice(0, dot)
  return heads.includes(head) && ((type === 'table' && head === 'selectedRow') || (type === 'form' && head === 'values'))
}

/**
 * A value prop parsed with `schema`; undefined when absent, a ref, null, or
 * not matching (a document that passed `validateDocument` always matches the
 * per-type spec).
 */
export function literalProp<T>(component: Component, name: string, schema: z.ZodType<T>): T | undefined {
  const prop = component.props[name]
  if (prop?.kind !== 'value' || prop.value === undefined || prop.value === null) return undefined
  const parsed = schema.safeParse(prop.value)
  return parsed.success ? parsed.data : undefined
}

/** The query id a component's data prop names, if any (`props.query` as a string value). */
export function dataQueryOf(component: Component): string | undefined {
  const prop = component.props.query
  return prop?.kind === 'value' && typeof prop.value === 'string' && prop.value !== '' ? prop.value : undefined
}

/** Placeholder names over sql.text, then http.path, then http.body; first appearance, deduplicated. */
export function queryPlaceholders(query: Query): string[] {
  const texts = [query.sql?.text, query.http?.path, query.http?.body].filter((text): text is string => typeof text === 'string')
  const seen = new Set<string>()
  const names: string[] = []
  for (const text of texts) {
    for (const name of placeholdersOf(text)) {
      if (!seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
    }
  }
  return names
}

const IDENT_CHAR = /[A-Za-z0-9_]/
const TAG_START = /[A-Za-z_]/
const PLACEHOLDER_AT = new RegExp(PLACEHOLDER.source, 'y')

/** Whitespace as Go `strings.TrimSpace` (`unicode.IsSpace`) sees it; JS `trim()` differs on U+0085 and U+FEFF. */
const BLANK = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/

/** SQL text with nothing but whitespace (the server's `empty_query`). */
export function isBlankSql(text: string): boolean {
  return BLANK.test(text)
}

/**
 * Scans SQL outside string literals, quoted identifiers, dollar quotes and
 * comments: reports a `$<digit>` positional placeholder, any `;`, a well-formed
 * `{{ name }}` the lexer does not see as executable (inside a literal, quoted
 * identifier or comment, so it would not be bound: the count of placeholder
 * matches over the whole text differs from the executable ones, as the server
 * counts), and an unterminated literal or comment (a `schema` problem; the
 * server engine uses the same lexer). Literals: `'…'` (`''` escapes; after a standalone `E`/`e`
 * prefix `\` escapes the next char), `"…"` (`""` escapes), `$tag$…$tag$` (tag
 * empty or an identifier), `-- …` to end of line, `/* … *\/` (nested).
 */
export type SqlScan = { positional: boolean; semicolon: boolean; placeholderInLiteral: boolean; unterminated: boolean }

export function scanSql(text: string): SqlScan {
  let positional = false
  let semicolon = false
  let executable = 0
  const unterminated = (): SqlScan => ({ positional, semicolon, placeholderInLiteral: false, unterminated: true })
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '{' && text[i + 1] === '{') {
      PLACEHOLDER_AT.lastIndex = i
      const match = PLACEHOLDER_AT.exec(text)
      if (match) {
        executable++
        i += match[0].length
        continue
      }
    }
    if (c === "'" || c === '"') {
      const escapes = c === "'" && i > 0 && (text[i - 1] === 'E' || text[i - 1] === 'e') && !(i > 1 && IDENT_CHAR.test(text[i - 2]!))
      i++
      let closed = false
      while (i < n) {
        const d = text[i]!
        if (escapes && d === '\\') {
          i += 2
          continue
        }
        if (d === c) {
          if (text[i + 1] === c) {
            i += 2
            continue
          }
          closed = true
          break
        }
        i++
      }
      if (!closed) return unterminated()
      i++
      continue
    }
    if (c === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i + 2)
      i = end === -1 ? n : end + 1
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') {
          depth++
          i += 2
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth--
          i += 2
        } else {
          i++
        }
      }
      if (depth > 0) return unterminated()
      continue
    }
    if (c === '$') {
      const next = text[i + 1]
      if (next !== undefined && next >= '0' && next <= '9') {
        positional = true
        i++
        continue
      }
      let j = i + 1
      if (j < n && TAG_START.test(text[j]!)) {
        j++
        while (j < n && IDENT_CHAR.test(text[j]!)) j++
      }
      if (text[j] === '$') {
        const tag = text.slice(i, j + 1)
        const end = text.indexOf(tag, j + 1)
        if (end === -1) return unterminated()
        i = end + tag.length
        continue
      }
      i++
      continue
    }
    if (c === ';') semicolon = true
    i++
  }
  const placeholderInLiteral = executable !== [...text.matchAll(PLACEHOLDER)].length
  return { positional, semicolon, placeholderInLiteral, unterminated: false }
}

/** `{{` left after removing every well-formed `{{ name }}`: a malformed placeholder (`{{ a + 1 }}`, `{{name`). */
export function hasMalformedPlaceholder(text: string): boolean {
  return text.replace(PLACEHOLDER, '').includes('{{')
}

// ---------------------------------------------------------------------------
// Validation

type Located<T> = { item: T; path: string }

function issuePath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join('.')
}

function locateComponents(doc: Document): Located<Component>[] {
  const out: Located<Component>[] = []
  doc.pages.forEach((page, p) => page.components.forEach((component, c) => out.push({ item: component, path: `pages.${p}.components.${c}` })))
  return out
}

function shapeProblems(input: unknown): Problem[] {
  const parsed = documentSchema.safeParse(input)
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({ code: 'schema', path: issuePath(issue.path), message: issue.message }))
  }
  const doc = input as Document
  const problems: Problem[] = []
  for (const { item: component, path } of locateComponents(doc)) {
    if (!isComponentType(component.type)) continue
    if (component.actions !== undefined && !ACTION_TYPES.includes(component.type)) {
      problems.push({ code: 'schema', path: `${path}.actions`, message: `a ${component.type} has no actions` })
    }
    for (const name of Object.keys(component.props).sort()) {
      const spec = propSpecOf(component.type, name)
      if (!spec) continue
      const prop = component.props[name]!
      const at = `${path}.props.${name}`
      if (prop.kind === 'ref') {
        if (!spec.ref) problems.push({ code: 'schema', path: at, message: `prop ${name} of a ${component.type} cannot be a reference` })
        continue
      }
      if (prop.value === undefined || prop.value === null) continue
      const result = spec.schema.safeParse(prop.value)
      if (!result.success) {
        const issue = result.error.issues[0]
        const sub = issue && issue.path.length > 0 ? `.value.${issuePath(issue.path)}` : '.value'
        problems.push({ code: 'schema', path: `${at}${sub}`, message: `prop ${name}: ${issue?.message ?? 'invalid value'}` })
      }
    }
  }
  doc.queries.forEach((query, q) => {
    const path = `queries.${q}`
    if (query.http) {
      if (query.mode === 'read' && query.http.method !== 'GET') problems.push({ code: 'schema', path: `${path}.http.method`, message: 'a read query uses GET' })
      if (query.http.path.startsWith('//') || /[\\\r\n]/.test(query.http.path)) {
        problems.push({ code: 'schema', path: `${path}.http.path`, message: 'http.path is a path on the source, without //, \\ or line breaks' })
      }
    }
    const texts: [string, string | undefined][] = [
      ['sql.text', query.sql?.text],
      ['http.path', query.http?.path],
      ['http.body', query.http?.body],
    ]
    for (const [field, text] of texts) {
      if (text !== undefined && hasMalformedPlaceholder(text)) problems.push({ code: 'schema', path: `${path}.${field}`, message: 'only {{ name }} placeholders are allowed' })
    }
    if (query.sql && scanSql(query.sql.text).unterminated) problems.push({ code: 'schema', path: `${path}.sql.text`, message: 'unterminated string, identifier or comment' })
  })
  return problems
}

/** Ids of nodes that lie on a cycle (Tarjan SCC: component of size > 1, or a self loop). */
function nodesOnCycles(edges: Map<string, string[]>): Set<string> {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const result = new Set<string>()
  let counter = 0
  const visit = (node: string) => {
    index.set(node, counter)
    low.set(node, counter)
    counter++
    stack.push(node)
    onStack.add(node)
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next)
        low.set(node, Math.min(low.get(node)!, low.get(next)!))
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!))
      }
    }
    if (low.get(node) === index.get(node)) {
      const members: string[] = []
      let member: string
      do {
        member = stack.pop()!
        onStack.delete(member)
        members.push(member)
      } while (member !== node)
      if (members.length > 1 || (edges.get(node) ?? []).includes(node)) for (const m of members) result.add(m)
    }
  }
  for (const node of edges.keys()) if (!index.has(node)) visit(node)
  return result
}

/**
 * Every problem of `input`, in phase order then document order; empty when the
 * document is valid. Accepts any JSON value (a stored draft, a fixture).
 */
export function validateDocument(input: unknown): Problem[] {
  const shape = shapeProblems(input)
  if (shape.length > 0) return shape
  const doc = input as Document
  const problems: Problem[] = []
  const add = (code: ProblemCode, path: string, message: string) => problems.push({ code, path, message })

  const components = locateComponents(doc)
  const queries: Located<Query>[] = doc.queries.map((query, q) => ({ item: query, path: `queries.${q}` }))
  const actions = components.flatMap(({ item, path }) => (item.actions ?? []).map((action, a) => ({ item: action, path: `${path}.actions.${a}` })))
  const componentById = new Map<string, Component>()
  for (const { item } of components) if (!componentById.has(item.id)) componentById.set(item.id, item)
  const queryById = new Map<string, Query>()
  for (const { item } of queries) if (!queryById.has(item.id)) queryById.set(item.id, item)

  // one_page_required
  if (doc.pages.length !== 1) add('one_page_required', 'pages', `a document has exactly one page, found ${doc.pages.length}`)

  // unknown_component_type
  for (const { item, path } of components) {
    if (!isComponentType(item.type)) add('unknown_component_type', `${path}.type`, `unknown component type ${JSON.stringify(item.type)}`)
  }

  // duplicate_id
  const duplicates = (entries: { id: string; path: string }[], what: string) => {
    const seen = new Set<string>()
    for (const { id, path } of entries) {
      if (seen.has(id)) add('duplicate_id', path, `duplicate ${what} id ${JSON.stringify(id)}`)
      seen.add(id)
    }
  }
  duplicates(doc.pages.map((page, p) => ({ id: page.id, path: `pages.${p}.id` })), 'page')
  duplicates(components.map(({ item, path }) => ({ id: item.id, path: `${path}.id` })), 'component')
  duplicates(queries.map(({ item, path }) => ({ id: item.id, path: `${path}.id` })), 'query')
  duplicates(actions.map(({ item, path }) => ({ id: item.id, path: `${path}.id` })), 'action')
  for (const { item, path } of queries) duplicates(item.params.map((param, i) => ({ id: param.name, path: `${path}.params.${i}.name` })), 'param')
  for (const { item, path } of components) {
    if (item.type === 'form') {
      const fields = literalProp(item, 'fields', z.array(formFieldSchema)) ?? []
      duplicates(fields.map((field, i) => ({ id: field.name, path: `${path}.props.fields.value.${i}.name` })), 'form field')
    }
    if (item.type === 'tabs') {
      const tabs = literalProp(item, 'tabs', z.array(tabSpecSchema)) ?? []
      duplicates(tabs.map((tab, i) => ({ id: tab.id, path: `${path}.props.tabs.value.${i}.id` })), 'tab')
    }
  }

  // layout_out_of_grid
  for (const { item, path } of components) {
    const { x, y, w, h } = item.layout
    if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > GRID_COLUMNS) {
      add('layout_out_of_grid', `${path}.layout`, `layout ${JSON.stringify(item.layout)} is outside the ${GRID_COLUMNS}-column grid`)
    }
  }

  // unknown_parent
  for (const { item, path } of components) {
    if (item.parentId === undefined) continue
    const parent = componentById.get(item.parentId)
    if (!parent || !(PARENT_TYPES as readonly string[]).includes(parent.type) || item.parentId === item.id) {
      add('unknown_parent', `${path}.parentId`, `parent ${JSON.stringify(item.parentId)} is not a container or tabs component`)
      continue
    }
    const seen = new Set<string>([item.id])
    let current: Component | undefined = parent
    while (current) {
      if (seen.has(current.id)) {
        add('unknown_parent', `${path}.parentId`, `parent chain of ${JSON.stringify(item.id)} loops`)
        break
      }
      seen.add(current.id)
      current = current.parentId === undefined ? undefined : componentById.get(current.parentId)
    }
  }

  // query_source_missing
  for (const { item, path } of queries) {
    if ((item.sql === undefined) === (item.http === undefined)) add('query_source_missing', path, `query ${JSON.stringify(item.id)} needs exactly one of sql or http`)
  }

  // empty_query: saved with the draft, blocks publish and run
  for (const { item, path } of queries) {
    if (item.sql !== undefined && isBlankSql(item.sql.text)) add('empty_query', `${path}.sql.text`, `query ${JSON.stringify(item.id)} has no SQL`)
  }

  // timeout_out_of_range
  for (const { item, path } of queries) {
    if (item.timeoutMs < 1 || item.timeoutMs > MAX_TIMEOUT_MS) add('timeout_out_of_range', `${path}.timeoutMs`, `timeoutMs must be 1..${MAX_TIMEOUT_MS}`)
  }

  // row_limit_out_of_range
  for (const { item, path } of queries) {
    const min = item.mode === 'read' ? 1 : 0
    if (item.rowLimit < min || item.rowLimit > MAX_ROW_LIMIT) add('row_limit_out_of_range', `${path}.rowLimit`, `rowLimit must be ${min}..${MAX_ROW_LIMIT}`)
  }

  // positional_placeholder / multiple_statements / placeholder_in_literal
  const scans = queries.map(({ item }) => (item.sql ? scanSql(item.sql.text) : { positional: false, semicolon: false, placeholderInLiteral: false }))
  queries.forEach(({ path }, i) => {
    if (scans[i]!.positional) add('positional_placeholder', `${path}.sql.text`, 'use {{ name }} placeholders, not $n')
  })
  queries.forEach(({ path }, i) => {
    if (scans[i]!.semicolon) add('multiple_statements', `${path}.sql.text`, 'a query is one statement without ;')
  })
  queries.forEach(({ path }, i) => {
    if (scans[i]!.placeholderInLiteral) add('placeholder_in_literal', `${path}.sql.text`, 'a {{ name }} placeholder inside quotes or a comment is not bound')
  })

  // placeholder_without_param / param_without_placeholder
  const placeholders = queries.map(({ item }) => queryPlaceholders(item))
  queries.forEach(({ item, path }, i) => {
    const declared = new Set(item.params.map((param) => param.name))
    for (const name of placeholders[i]!) {
      if (!declared.has(name)) add('placeholder_without_param', path, `placeholder {{ ${name} }} has no parameter`)
    }
  })
  queries.forEach(({ item, path }, i) => {
    const used = new Set([...placeholders[i]!, ...(item.filters ?? []).map((filter) => filter.param)])
    item.params.forEach((param, p) => {
      if (!used.has(param.name)) add('param_without_placeholder', `${path}.params.${p}`, 'Parameter has no placeholder or filter')
    })
  })

  for (const { item, path } of queries) {
    if (item.filters?.length && (item.mode !== 'read' || !item.sql)) {
      add('filter_not_supported', `${path}.filters`, 'Filters require a read SQL query')
    }
  }
  for (const { item, path } of queries) {
    item.filters?.forEach((filter, index) => {
      if (!item.params.some((param) => param.name === filter.param)) {
        add('filter_param_unknown', `${path}.filters.${index}.param`, 'Filter parameter is not declared')
      }
    })
  }
  for (const { item, path } of queries) {
    item.filters?.forEach((filter, index) => {
      const param = item.params.find((param) => param.name === filter.param)
      if (param && (filter.op === 'in') !== (param.type === 'textList' || param.type === 'numberList')) {
        add('filter_param_type', `${path}.filters.${index}.param`, 'Filter operator and parameter type do not match')
      }
    })
  }
  const utf8 = new TextEncoder()
  for (const { item, path } of queries) {
    item.filters?.forEach((filter, index) => {
      if (filter.column === '' || utf8.encode(filter.column).length > 63 || /["\0]/.test(filter.column)) {
        add('filter_column_invalid', `${path}.filters.${index}.column`, 'Filter column must be 1–63 bytes without quotes or NUL')
      }
    })
  }

  // unknown_query (data props, then refresh lists per component)
  for (const { item, path } of components) {
    const queryId = dataQueryOf(item)
    if (queryId !== undefined && !queryById.has(queryId)) add('unknown_query', `${path}.props.query`, `unknown query ${JSON.stringify(queryId)}`)
    ;(item.actions ?? []).forEach((action, a) => {
      ;(action.onSuccess?.refresh ?? []).forEach((id, r) => {
        if (!queryById.has(id)) add('unknown_query', `${path}.actions.${a}.onSuccess.refresh.${r}`, `unknown query ${JSON.stringify(id)}`)
      })
    })
  }

  // write_query_not_action
  for (const { item, path } of components) {
    const queryId = dataQueryOf(item)
    if (queryId !== undefined && queryById.get(queryId)?.mode === 'write') {
      add('write_query_not_action', `${path}.props.query`, `write query ${JSON.stringify(queryId)} can only run from an action`)
    }
    ;(item.actions ?? []).forEach((action, a) => {
      ;(action.onSuccess?.refresh ?? []).forEach((id, r) => {
        if (queryById.get(id)?.mode === 'write') add('write_query_not_action', `${path}.actions.${a}.onSuccess.refresh.${r}`, `write query ${JSON.stringify(id)} cannot be refreshed`)
      })
    })
  }

  // unknown_action_query / action_query_not_write
  for (const { item, path } of actions) {
    if (!queryById.has(item.queryId)) add('unknown_action_query', `${path}.queryId`, `unknown query ${JSON.stringify(item.queryId)}`)
  }
  for (const { item, path } of actions) {
    if (queryById.get(item.queryId)?.mode === 'read') add('action_query_not_write', `${path}.queryId`, `action query ${JSON.stringify(item.queryId)} must be a write query`)
  }

  // unknown_form_component
  for (const { item, path } of actions) {
    if (item.input && componentById.get(item.input.formComponent)?.type !== 'form') {
      add('unknown_form_component', `${path}.input.formComponent`, `${JSON.stringify(item.input.formComponent)} is not a form`)
    }
  }

  // unknown_ref_component / prop_not_exposed
  const refs: { ref: Ref; path: string }[] = []
  for (const { item, path } of components) {
    for (const name of Object.keys(item.props).sort()) {
      const prop = item.props[name]!
      if (prop.kind === 'ref') refs.push({ ref: prop.ref, path: `${path}.props.${name}.ref` })
    }
  }
  for (const { item, path } of queries) {
    item.params.forEach((param, p) => {
      if ('ref' in param.bind) refs.push({ ref: param.bind.ref, path: `${path}.params.${p}.bind.ref` })
    })
  }
  for (const { ref, path } of refs) {
    if (!componentById.has(ref.component)) add('unknown_ref_component', path, `unknown component ${JSON.stringify(ref.component)}`)
  }
  for (const { ref, path } of refs) {
    const target = componentById.get(ref.component)
    if (target && isComponentType(target.type) && !exposesProp(target.type, ref.prop)) {
      add('prop_not_exposed', path, `${ref.component} (${target.type}) does not expose ${JSON.stringify(ref.prop)}`)
    }
  }

  // binding_cycle
  const edges = new Map<string, string[]>()
  const order: { node: string; path: string }[] = []
  for (const { item, path } of components) {
    const node = `c:${item.id}`
    if (edges.has(node)) continue
    const out: string[] = []
    const queryId = dataQueryOf(item)
    if (queryId !== undefined && queryById.has(queryId)) out.push(`q:${queryId}`)
    for (const name of Object.keys(item.props).sort()) {
      const prop = item.props[name]!
      if (prop.kind === 'ref' && componentById.has(prop.ref.component)) out.push(`c:${prop.ref.component}`)
    }
    edges.set(node, out)
    order.push({ node, path })
  }
  for (const { item, path } of queries) {
    const node = `q:${item.id}`
    if (edges.has(node)) continue
    const out: string[] = []
    for (const param of item.params) if ('ref' in param.bind && componentById.has(param.bind.ref.component)) out.push(`c:${param.bind.ref.component}`)
    edges.set(node, out)
    order.push({ node, path })
  }
  const cyclic = nodesOnCycles(edges)
  const first = order.find(({ node }) => cyclic.has(node))
  if (first) add('binding_cycle', first.path, `${first.node.slice(2)} depends on itself through its bindings`)

  return problems.sort((a, b) => PROBLEM_CODES.indexOf(a.code) - PROBLEM_CODES.indexOf(b.code))
}

/** Parses a known-valid value as a Document (throws with the first problem otherwise). */
export function parseDocument(input: unknown): Document {
  const problems = validateDocument(input)
  if (problems.length > 0) throw new Error(`${problems[0]!.code} at ${problems[0]!.path}: ${problems[0]!.message}`)
  return input as Document
}

/** What a problem points at, for the editor: the component / query / action and prop of its path. */
export function problemTarget(doc: Document, problem: Problem): { componentId?: string; queryId?: string; actionId?: string; prop?: string } {
  const segments = problem.path.split('.')
  if (segments[0] === 'pages' && segments[2] === 'components') {
    const component = doc.pages[Number(segments[1])]?.components[Number(segments[3])]
    if (!component) return {}
    if (segments[4] === 'actions') return { componentId: component.id, actionId: component.actions?.[Number(segments[5])]?.id }
    if (segments[4] === 'props') return { componentId: component.id, prop: segments[5] }
    return { componentId: component.id }
  }
  if (segments[0] === 'queries') {
    const query = doc.queries[Number(segments[1])]
    return query ? { queryId: query.id } : {}
  }
  return {}
}

