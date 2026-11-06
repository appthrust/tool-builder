// Dev-only, in-memory implementation of the tool-builder API contract
// (src/api/types.ts) for `bun run mock` and the tests. No token: the caller is
// picked by role — `?as=admin|editor|user` on any request (remembered in a
// cookie), else TOOL_BUILDER_MOCK_ROLE, else admin — and the scenario by
// `?scenario=none|pending-source|denied|app-installing` (cookie), else TOOL_BUILDER_MOCK_SCENARIO.
// The mock does not run SQL: query ids of the order desk map to functions over
// the seeded dataset (./mock-data) that honour the same inputs the SQL binds.
// Built-in app sources answer from ./mock-installed-apps.
import { API_BASE } from '../api/types'
import type {
  ActionRun,
  Column,
  DataSource,
  Grants,
  Me,
  ProjectDatabase,
  QueryResult,
  Release,
  ReleaseDetail,
  SourceSchema,
  Tool,
  ToolSummary,
} from '../api/types'
import { documentChanges } from '../features/editor/releases/changes'
import { emptyDocument, PLACEHOLDER, type Document, type ParamType, type Query } from '../model/document'
import { validateDocument } from '../model/document.schema'
import {
  customerLookupDocument,
  GROUPS,
  orderDeskAt,
  orderDeskDraft,
  PEOPLE,
  RELEASE_NOTES,
  seedBusinessData,
  seedProducts,
  stockLevelsDocument,
  type BusinessData,
  type MockPerson,
  type Order,
  type Product,
} from './mock-data'
import { INSTALLED_APP_NAMES, INSTALLED_APP_OPERATIONS, InstalledAppNotFound, installedAppResponse, mockInstalledAppLinks, rowsOf } from './mock-installed-apps'

export type MockRole = 'admin' | 'editor' | 'user'
export type MockScenario = 'none' | 'pending-source' | 'denied' | 'app-installing'
export const MOCK_ROLES: readonly MockRole[] = ['admin', 'editor', 'user']
export const MOCK_SCENARIOS: readonly MockScenario[] = ['none', 'pending-source', 'denied', 'app-installing']

export const ROLE_COOKIE = 'tool_builder_mock_as'
export const SCENARIO_COOKIE = 'tool_builder_mock_scenario'

export type MockOptions = {
  role?: MockRole
  scenario?: MockScenario
  /** Delay before answering query and action runs, so loading states are visible in the browser. */
  latencyMs?: number
  /** Clock (tests pin it). */
  now?: () => number
}

/** A non-2xx answer in the console envelope. */
class MockFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
  }
}

type Caller = { person: MockPerson; admin: boolean }

type StoredRelease = Omit<Release, 'live'> & { document: Document }

type ToolRecord = {
  id: string
  slug: string
  name: string
  description: string
  createdAt: string
  archivedAt: string | null
  draft: Document
  /** Doubles as the draft's `If-Match` token (design: `If-Match: <draftUpdatedAt>`); unique per save. */
  draftUpdatedAt: string
  /** Append-only; publish and restore both add one, so the last is live. */
  releases: StoredRelease[]
  grants: Grants
}

type SourceRecord = Omit<DataSource, 'status' | 'statusMessage'> & { readyAt: number }

// `engine` is the platform provider id and `reason` a code, as cmd/server returns them; the SPA maps both to copy.
const PROJECT_DATABASES: ProjectDatabase[] = [
  { componentId: 'db-orders', applicationId: 'app-shop', applicationName: 'Online shop', name: 'orders-db', engine: 'CNPG', connectable: true, reason: null },
  { componentId: 'db-analytics', applicationId: 'app-insights', applicationName: 'Sales insights', name: 'analytics', engine: 'CNPG', connectable: true, reason: null },
  {
    componentId: 'db-legacy-crm',
    applicationId: 'app-crm',
    applicationName: 'Legacy CRM',
    name: 'crm-legacy',
    engine: 'Neon',
    connectable: false,
    reason: 'engine_unsupported',
  },
]

/**
 * Web components an HTTP source may target. Only those declaring `internalService` are reachable from the
 * built-in app (data-sources.md "HTTP sources"); the others answer `internal_service_required`.
 */
const WEB_COMPONENTS: Record<string, { name: string; internalService: boolean }> = {
  'web-storefront-api': { name: 'storefront-api', internalService: true },
  'web-inventory-api': { name: 'inventory-api', internalService: true },
  'web-admin-portal': { name: 'admin-portal', internalService: false },
}

const ORDER_COLUMNS: Column[] = [
  { name: 'number', type: 'text' },
  { name: 'customer_id', type: 'int4' },
  { name: 'status', type: 'text' },
  { name: 'total', type: 'numeric' },
  { name: 'currency', type: 'text' },
  { name: 'items', type: 'int4' },
  { name: 'payment_method', type: 'text' },
  { name: 'carrier', type: 'text' },
  { name: 'tracking_number', type: 'text' },
  { name: 'created_at', type: 'timestamptz' },
  { name: 'shipped_at', type: 'timestamptz' },
  { name: 'delivered_at', type: 'timestamptz' },
]
const CUSTOMER_COLUMNS: Column[] = [
  { name: 'id', type: 'int4' },
  { name: 'name', type: 'text' },
  { name: 'email', type: 'text' },
  { name: 'prefecture', type: 'text' },
  { name: 'created_at', type: 'timestamptz' },
]
const REFUND_COLUMNS: Column[] = [
  { name: 'id', type: 'int4' },
  { name: 'order_number', type: 'text' },
  { name: 'amount', type: 'numeric' },
  { name: 'reason', type: 'text' },
  { name: 'created_at', type: 'timestamptz' },
]

/** `information_schema` as the engine would read it, per Platform database component. */
const SCHEMAS: Record<string, SourceSchema> = {
  'db-orders': {
    tables: [
      { schema: 'public', name: 'customers', kind: 'table', columns: columnsOf(CUSTOMER_COLUMNS, 'id', ['prefecture']) },
      { schema: 'public', name: 'orders', kind: 'table', columns: columnsOf(ORDER_COLUMNS, 'number', ['carrier', 'tracking_number', 'shipped_at', 'delivered_at']) },
      { schema: 'public', name: 'refunds', kind: 'table', columns: columnsOf(REFUND_COLUMNS, 'id', ['reason']) },
      { schema: 'public', name: 'open_orders', kind: 'view', columns: columnsOf(ORDER_COLUMNS, null, ORDER_COLUMNS.map((column) => column.name)) },
    ],
  },
  'db-analytics': {
    tables: [
      {
        schema: 'public',
        name: 'daily_sales',
        kind: 'table',
        columns: [
          { name: 'day', type: 'date', nullable: false, primaryKey: true },
          { name: 'orders', type: 'int4', nullable: false, primaryKey: false },
          { name: 'revenue', type: 'numeric', nullable: false, primaryKey: false },
        ],
      },
    ],
  },
}

function columnsOf(columns: Column[], primaryKey: string | null, nullable: string[]): SourceSchema['tables'][number]['columns'] {
  return columns.map((column) => ({ name: column.name, type: column.type, nullable: nullable.includes(column.name), primaryKey: column.name === primaryKey }))
}

const ORDER_ROW = (order: Order) => ORDER_COLUMNS.map((column) => order[column.name as keyof Order])

const RELEASE_DATES = [
  '2026-08-04T02:10:00Z',
  '2026-08-06T06:42:00Z',
  '2026-08-12T01:30:00Z',
  '2026-08-19T08:05:00Z',
  '2026-08-27T04:55:00Z',
  '2026-09-03T02:20:00Z',
  '2026-09-04T07:48:00Z',
  '2026-09-10T03:15:00Z',
  '2026-09-18T05:33:00Z',
  '2026-09-25T01:02:00Z',
  '2026-10-02T06:27:00Z',
  '2026-10-08T09:40:00Z',
  '2026-10-09T05:12:00Z',
]
const RELEASE_PUBLISHERS = ['tanaka', 'tanaka', 'tanaka', 'tanaka', 'takahashi', 'tanaka', 'tanaka', 'tanaka', 'sato', 'takahashi', 'takahashi', 'tanaka', 'sato']

function publisher(key: string): Release['publishedBy'] {
  const person = PEOPLE[key]!
  return { subject: person.subject, displayName: person.displayName }
}

function seedOrderDeskReleases(): StoredRelease[] {
  const releases: StoredRelease[] = []
  let previous: Document | null = null
  for (let number = 1; number <= 13; number++) {
    // v13 restores v11 after v12's carrier column slowed the search: v12 shows as rolled back.
    const document = number === 13 ? orderDeskAt(11) : orderDeskAt(number)
    releases.push({
      id: `rel_order_desk_${number}`,
      number,
      note: RELEASE_NOTES[number] ?? '',
      changes: documentChanges(previous, document),
      publishedBy: publisher(RELEASE_PUBLISHERS[number - 1]!),
      publishedAt: new Date(RELEASE_DATES[number - 1]!).toISOString(),
      restoredFrom: number === 13 ? 11 : null,
      document,
    })
    previous = document
  }
  return releases
}

function seedTools(): ToolRecord[] {
  const stock = stockLevelsDocument()
  const stockV1 = structuredClone(stock)
  stockV1.pages[0]!.components[1]!.props.columns = {
    kind: 'value',
    value: [
      { name: 'sku', label: 'SKU' },
      { name: 'name', label: 'Product' },
      { name: 'stock', label: 'In stock' },
    ],
  }
  return [
    {
      id: 'tool_order_desk',
      slug: 'order-desk',
      name: 'Order desk',
      description: 'Search orders, check the details and issue refunds.',
      createdAt: '2026-08-03T23:58:00.000Z',
      archivedAt: null,
      draft: orderDeskDraft(),
      draftUpdatedAt: '2026-10-13T08:21:40.000Z',
      releases: seedOrderDeskReleases(),
      grants: {
        groups: [
          { groupId: 'cs-team', role: 'use' },
          { groupId: 'cs-leads', role: 'use' },
          { groupId: 'finance', role: 'use' },
          { groupId: 'it-platform', role: 'edit' },
        ],
        actions: [{ actionId: 'issue_refund', groupIds: ['finance', 'cs-leads'] }],
      },
    },
    {
      id: 'tool_stock_levels',
      slug: 'stock-levels',
      name: 'Stock levels',
      description: 'Check what is in stock in each warehouse.',
      createdAt: '2026-09-15T02:00:00.000Z',
      archivedAt: null,
      draft: stock,
      draftUpdatedAt: '2026-09-22T04:12:09.000Z',
      releases: [
        {
          id: 'rel_stock_levels_1',
          number: 1,
          note: 'First version',
          changes: documentChanges(null, stockV1),
          publishedBy: publisher('takahashi'),
          publishedAt: '2026-09-16T01:20:00.000Z',
          restoredFrom: null,
          document: stockV1,
        },
        {
          id: 'rel_stock_levels_2',
          number: 2,
          note: 'Show the warehouse',
          changes: documentChanges(stockV1, stock),
          publishedBy: publisher('takahashi'),
          publishedAt: '2026-09-22T04:15:00.000Z',
          restoredFrom: null,
          document: structuredClone(stock),
        },
      ],
      grants: {
        groups: [
          { groupId: 'cs-team', role: 'use' },
          { groupId: 'warehouse', role: 'use' },
          { groupId: 'it-platform', role: 'edit' },
        ],
        actions: [],
      },
    },
    {
      id: 'tool_customer_lookup',
      slug: 'customer-lookup',
      name: 'Customer lookup',
      description: 'Find a customer by name.',
      createdAt: '2026-10-10T05:30:00.000Z',
      archivedAt: null,
      draft: customerLookupDocument(),
      draftUpdatedAt: '2026-10-12T07:03:51.000Z',
      releases: [],
      grants: { groups: [{ groupId: 'it-platform', role: 'edit' }], actions: [] },
    },
  ]
}

function seedSources(): SourceRecord[] {
  return [
    {
      id: 'ds_orders',
      slug: 'orders-db',
      kind: 'postgres',
      name: 'Orders database',
      connectionName: 'orders-db',
      destinationComponentId: 'db-orders',
      baseUrl: null,
      createdBy: PEOPLE.sato!.displayName,
      createdAt: '2026-08-03T23:40:00.000Z',
      readyAt: 0,
    },
    {
      id: 'ds_storefront',
      slug: 'storefront-api',
      kind: 'http',
      name: 'Storefront API',
      connectionName: null,
      destinationComponentId: 'web-storefront-api',
      baseUrl: 'http://storefront-api-internal.shop.svc',
      createdBy: PEOPLE.sato!.displayName,
      createdAt: '2026-09-15T01:10:00.000Z',
      readyAt: 0,
    },
  ]
}

function seedRuns(): ActionRun[] {
  // Newest first. Refunds by the groups the action grant allows, one denied attempt by a support member
  // without it, one refund above the order total that the database rejected, and editor test runs.
  const entries: [string, string, ActionRun['status'], number | null, string | null, number][] = [
    ['2026-10-14T00:12:00Z', 'suzuki', 'ok', 1, null, 13],
    ['2026-10-13T08:30:00Z', 'tanaka', 'ok', 1, null, 0],
    ['2026-10-13T06:41:00Z', 'nakamura', 'denied', null, 'Only finance and support leads may issue refunds.', 13],
    ['2026-10-13T02:05:00Z', 'ito', 'ok', 1, null, 13],
    ['2026-10-12T07:58:00Z', 'ito', 'failed', null, 'refund total would exceed the order total (trigger refunds_within_total)', 13],
    ['2026-10-12T07:59:00Z', 'ito', 'ok', 1, null, 13],
    ['2026-10-11T04:20:00Z', 'suzuki', 'ok', 1, null, 13],
    ['2026-10-10T09:11:00Z', 'suzuki', 'ok', 1, null, 13],
    ['2026-10-09T03:47:00Z', 'ito', 'ok', 1, null, 12],
    ['2026-10-08T23:30:00Z', 'suzuki', 'ok', 1, null, 12],
    ['2026-10-07T05:16:00Z', 'ito', 'ok', 1, null, 11],
    ['2026-10-06T02:50:00Z', 'nakamura', 'denied', null, 'Only finance and support leads may issue refunds.', 11],
    ['2026-10-05T08:08:00Z', 'suzuki', 'ok', 1, null, 11],
    ['2026-10-03T01:39:00Z', 'ito', 'ok', 1, null, 11],
    ['2026-10-01T06:25:00Z', 'suzuki', 'ok', 1, null, 10],
    ['2026-09-29T07:44:00Z', 'ito', 'failed', null, 'null value in column "amount" of relation "refunds" violates not-null constraint', 10],
    ['2026-09-26T03:03:00Z', 'suzuki', 'ok', 1, null, 10],
    ['2026-09-24T05:57:00Z', 'ito', 'ok', 1, null, 9],
  ]
  return entries
    .map(([at, who, status, rowCount, error, releaseNumber], index) => {
      const person = PEOPLE[who]!
      const started = Date.parse(at)
      const draftRun = releaseNumber === 0
      return {
        id: `run_${String(entries.length - index).padStart(4, '0')}`,
        releaseNumber,
        actionId: draftRun ? '' : 'issue_refund',
        actionLabel: draftRun ? '' : 'Issue refund',
        queryId: 'issue_refund',
        actor: { subject: person.subject, displayName: person.displayName },
        status,
        rowCount,
        error,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date(started + (status === 'denied' ? 3 : 40 + index * 3)).toISOString(),
      }
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name) cookies[name] = decodeURIComponent(rest.join('='))
  }
  return cookies
}

function pick<T extends string>(allowed: readonly T[], ...candidates: (string | null | undefined)[]): T | undefined {
  for (const candidate of candidates) if (candidate && (allowed as readonly string[]).includes(candidate)) return candidate as T
  return undefined
}

function callerFor(role: MockRole, scenario: MockScenario): Caller {
  // `denied`: someone with no grant on any tool, so `/t/order-desk` answers 403 `tool_forbidden`.
  if (scenario === 'denied') return { person: PEOPLE.yamada!, admin: false }
  if (role === 'admin') return { person: PEOPLE.sato!, admin: true }
  if (role === 'editor') return { person: PEOPLE.tanaka!, admin: false }
  return { person: PEOPLE.suzuki!, admin: false }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new MockFailure(400, 'invalid_request', 'request body is not JSON')
  }
  if (!isObject(parsed)) throw new MockFailure(400, 'invalid_request', 'request body must be a JSON object')
  return parsed
}

/** Validates an input against the parameter type the way the engine binds it; `null` binds SQL NULL. */
function bindValue(name: string, type: ParamType, value: unknown): unknown {
  if (value === undefined || value === null) return null
  const ok =
    type === 'text'
      ? typeof value === 'string'
      : type === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : type === 'boolean'
          ? typeof value === 'boolean'
          : type === 'date'
            ? typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            : type === 'timestamp'
              ? typeof value === 'string' && !Number.isNaN(Date.parse(value))
              : type === 'textList'
                ? Array.isArray(value) && value.every((item) => typeof item === 'string')
                : Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
  if (!ok) throw new MockFailure(400, 'query_failed', `parameter "${name}" expects ${type}`, { param: name })
  return value
}

function bind(query: Query, inputs: unknown): Record<string, unknown> {
  const given = isObject(inputs) ? inputs : {}
  const args: Record<string, unknown> = {}
  for (const param of query.params) args[param.name] = bindValue(param.name, param.type, given[param.name])
  return args
}

/** A stable, plausible execution time: a few ms plus a little per row. */
function durationOf(queryId: string, rows: number): number {
  let hash = 0
  for (const char of queryId) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return 3 + (hash % 9) + Math.round(rows * 0.15)
}

function inferType(value: unknown): string {
  return typeof value === 'number' ? 'numeric' : typeof value === 'boolean' ? 'bool' : 'text'
}

export function createMockToolBuilder(options: MockOptions = {}) {
  const now = options.now ?? Date.now
  const latencyMs = options.latencyMs ?? 0
  const data: BusinessData = seedBusinessData()
  const products: Product[] = seedProducts()
  const tools: ToolRecord[] = seedTools()
  const sources: SourceRecord[] = seedSources()
  /** Newest first, per tool slug; the seeded history belongs to the order desk. */
  const runs = new Map<string, ActionRun[]>([['order-desk', seedRuns()]])
  let sequence = 0
  const nextId = (prefix: string) => `${prefix}_${(++sequence).toString(36).padStart(4, '0')}`

  // -------------------------------------------------------------------------
  // Access

  const groupsOf = (caller: Caller) => caller.person.groupIds
  function accessOf(tool: ToolRecord, caller: Caller): ToolSummary['access'] {
    if (caller.admin) return { use: true, edit: true }
    const mine = tool.grants.groups.filter((grant) => groupsOf(caller).includes(grant.groupId))
    const edit = mine.some((grant) => grant.role === 'edit')
    return { use: edit || mine.length > 0, edit }
  }
  function findTool(slug: string): ToolRecord {
    const tool = tools.find((candidate) => candidate.slug === slug && candidate.archivedAt === null)
    if (!tool) throw new MockFailure(404, 'not_found', `no tool ${slug}`)
    return tool
  }
  /**
   * Like the server's `authorizedTool`: no grant, an edit route without the edit grant, or an unpublished
   * tool for a use-only caller is 403 `tool_forbidden` naming the editing groups.
   */
  function authorizedTool(slug: string, caller: Caller, edit: boolean): ToolRecord {
    const tool = findTool(slug)
    const access = accessOf(tool, caller)
    if (!access.use || (edit && !access.edit) || (!access.edit && !liveOf(tool))) {
      const editors = tool.grants.groups.filter((grant) => grant.role === 'edit').flatMap((grant) => GROUPS.filter((group) => group.id === grant.groupId).map((group) => group.name))
      throw new MockFailure(403, 'tool_forbidden', "Request access from the tool's editing groups", { toolName: tool.name, editors })
    }
    return tool
  }
  const requireUse = (slug: string, caller: Caller) => authorizedTool(slug, caller, false)
  const requireEdit = (slug: string, caller: Caller) => authorizedTool(slug, caller, true)
  function requireAdmin(caller: Caller) {
    if (!caller.admin) throw new MockFailure(403, 'forbidden', 'administrators only')
  }
  /** Reading data sources (list, schema): admins and editors of any tool; connecting and removing stay admin-only. */
  function requireAnyEditor(caller: Caller) {
    if (!caller.admin && !tools.some((tool) => tool.archivedAt === null && accessOf(tool, caller).edit)) throw new MockFailure(403, 'forbidden', 'editors only')
  }

  // -------------------------------------------------------------------------
  // DTOs

  const liveOf = (tool: ToolRecord) => tool.releases.at(-1)
  function summaryOf(tool: ToolRecord, caller: Caller): ToolSummary {
    return {
      id: tool.id,
      slug: tool.slug,
      name: tool.name,
      description: tool.description,
      liveReleaseNumber: liveOf(tool)?.number ?? null,
      draftUpdatedAt: tool.draftUpdatedAt,
      access: accessOf(tool, caller),
      createdAt: tool.createdAt,
      archivedAt: tool.archivedAt,
    }
  }
  function toolOf(tool: ToolRecord, caller: Caller): Tool {
    const summary = summaryOf(tool, caller)
    const live = liveOf(tool)
    return {
      ...summary,
      draft: summary.access.edit ? structuredClone(tool.draft) : null,
      draftVersion: summary.access.edit ? tool.draftUpdatedAt : null,
      live: live ? { releaseNumber: live.number, document: structuredClone(live.document) } : null,
    }
  }
  /** 409 `draft_changed` with the server's current draft, as the server sends it. */
  function draftChanged(tool: ToolRecord, caller: Caller): MockFailure {
    const current = toolOf(tool, caller)
    return new MockFailure(409, 'draft_changed', 'The draft changed in another editor', { draftVersion: current.draftVersion, draft: current.draft })
  }
  /** What publishing (and restoring) checks: every problem, then each query's stored source exists with the matching kind. */
  function publishable(document: Document) {
    const problems = validateDocument(document)
    if (problems.length > 0) throw new MockFailure(400, 'invalid_document', problems[0]!.message, { problems })
    document.queries.forEach((query, index) => {
      const source = sources.find((candidate) => candidate.id === query.sourceId)
      const message = !source ? 'Data source does not exist' : (source.kind === 'postgres') !== (query.sql !== undefined) ? 'Query and data source kinds do not match' : null
      if (message) throw new MockFailure(400, 'invalid_document', message, { problems: [{ code: 'query_source_missing', path: `queries.${index}.sourceId`, message }] })
    })
  }
  function releaseOf(tool: ToolRecord, release: StoredRelease): Release {
    const { document: _document, ...rest } = release
    return { ...rest, live: liveOf(tool)?.number === release.number }
  }
  function sourceOf(source: SourceRecord, scenario: MockScenario): DataSource {
    const { readyAt, ...rest } = source
    if (source.kind === 'builtin-app') {
      // Mirrors the link state (engine `State`): Ready → ready, Installing → pending, otherwise error.
      const definition = source.definition ?? ''
      const state = mockInstalledAppLinks(scenario === 'app-installing').find((link) => link.definition === definition)?.state
      const name = INSTALLED_APP_NAMES[definition] ?? definition
      if (state === 'Ready') return { ...rest, status: 'ready', statusMessage: null }
      if (state === 'Installing') return { ...rest, status: 'pending', statusMessage: `${name} is still installing` }
      return { ...rest, status: 'error', statusMessage: `${name} is not installed in this Project` }
    }
    const pending = (scenario === 'pending-source' && source.slug === 'orders-db') || now() < readyAt
    return {
      ...rest,
      status: pending ? 'pending' : 'ready',
      statusMessage: pending ? 'Waiting for the next rollout to deliver the connection to Internal Tool Builder.' : null,
    }
  }

  // -------------------------------------------------------------------------
  // Query execution over the dataset

  function sourceFor(query: Query, scenario: MockScenario): DataSource {
    const record = sources.find((source) => source.id === query.sourceId)
    if (!record) throw new MockFailure(400, 'query_failed', `data source ${query.sourceId} is not connected`)
    const source = sourceOf(record, scenario)
    if (source.kind === 'builtin-app' && source.status !== 'ready') throw new MockFailure(503, 'data_source_unavailable', source.statusMessage ?? `${source.name} is unavailable`)
    if (source.status === 'pending') throw new MockFailure(503, 'data_source_pending', `${source.name} is still being connected`)
    return source
  }

  const customerOf = (order: Order) => data.customers.find((customer) => customer.id === order.customer_id)!

  function readOrders(query: Query, args: Record<string, unknown>): { columns: Column[]; rows: unknown[][] } {
    const sql = query.sql?.text ?? ''
    if (query.id === 'open_count') {
      return { columns: [{ name: 'count', type: 'int8' }], rows: [[data.orders.filter((order) => order.status === 'open').length]] }
    }
    if (query.id === 'search_orders') {
      // `ilike coalesce({{ search }}, '') || '%'` on the number (and the e-mail once the SQL says so), and
      // `coalesce(cardinality({{ statuses }}), 0) = 0 or status = any(...)`: a null/empty search or status list matches all.
      const search = typeof args.search === 'string' ? args.search.toLowerCase() : ''
      const picked = Array.isArray(args.statuses) ? args.statuses.filter((status): status is string => typeof status === 'string') : []
      const statuses = picked.length > 0 ? picked : null
      const byEmail = sql.includes('c.email')
      const withCarrier = sql.includes('o.carrier')
      const rows = data.orders
        .filter((order) => {
          const customer = customerOf(order)
          const matches = search === '' || order.number.toLowerCase().startsWith(search) || (byEmail && customer.email.toLowerCase().startsWith(search))
          return matches && (statuses === null || statuses.includes(order.status))
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 50)
        .map((order) => {
          const base = [order.number, customerOf(order).name, order.total, order.status]
          return withCarrier ? [...base, order.carrier, order.created_at] : [...base, order.created_at]
        })
      const columns: Column[] = [
        { name: 'number', type: 'text' },
        { name: 'customer', type: 'text' },
        { name: 'total', type: 'numeric' },
        { name: 'status', type: 'text' },
        ...(withCarrier ? [{ name: 'carrier', type: 'text' }] : []),
        { name: 'created_at', type: 'timestamptz' },
      ]
      return { columns, rows }
    }
    if (query.id === 'order_detail') {
      const order = data.orders.find((candidate) => candidate.number === args.number)
      return { columns: ORDER_COLUMNS, rows: order ? [ORDER_ROW(order)] : [] }
    }
    // Any other read: the rows of the table named after `from`, as `select *` would return them.
    const table = /\bfrom\s+([a-z_]+)/i.exec(sql)?.[1]?.toLowerCase()
    if (table === 'orders') return { columns: ORDER_COLUMNS, rows: data.orders.map(ORDER_ROW) }
    if (table === 'open_orders') return { columns: ORDER_COLUMNS, rows: data.orders.filter((order) => order.status === 'open').map(ORDER_ROW) }
    if (table === 'customers') {
      const search = typeof args.search === 'string' ? args.search.toLowerCase() : ''
      const rows = data.customers.filter((customer) => customer.name.toLowerCase().includes(search) || customer.email.toLowerCase().includes(search))
      return { columns: CUSTOMER_COLUMNS, rows: rows.map((customer) => CUSTOMER_COLUMNS.map((column) => customer[column.name as keyof typeof customer])) }
    }
    if (table === 'refunds') return { columns: REFUND_COLUMNS, rows: data.refunds.map((refund) => REFUND_COLUMNS.map((column) => refund[column.name as keyof typeof refund])) }
    throw new MockFailure(400, 'query_failed', table ? `relation "${table}" does not exist` : 'syntax error at or near "select"')
  }

  function httpPath(query: Query, args: Record<string, unknown>): string {
    return (query.http?.path ?? '').replace(new RegExp(PLACEHOLDER.source, 'g'), (_, name: string) =>
      encodeURIComponent(args[name] === null || args[name] === undefined ? '' : String(args[name]))
    )
  }

  function readHttp(query: Query, args: Record<string, unknown>): { columns: Column[]; rows: unknown[][] } {
    const url = new URL(httpPath(query, args), 'http://storefront.invalid')
    if (url.pathname !== '/products') throw new MockFailure(400, 'query_failed', `storefront-api answered 404 for GET ${url.pathname}`)
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const rows = products.filter((product) => product.sku.toLowerCase().includes(q) || product.name.toLowerCase().includes(q))
    const names: (keyof Product)[] = ['sku', 'name', 'stock', 'warehouse', 'price']
    return { columns: names.map((name) => ({ name, type: inferType(products[0]![name]) })), rows: rows.map((product) => names.map((name) => product[name])) }
  }

  /** A `builtin-app` source's GET, answered from ./mock-installed-apps and read into rows like the engine does. */
  function readInstalledApp(source: DataSource, query: Query, args: Record<string, unknown>, caller: Caller): { columns: Column[]; rows: unknown[][] } {
    const url = new URL(httpPath(query, args), 'http://installed-app.invalid')
    let response: unknown
    try {
      response = installedAppResponse(source.definition ?? '', url, caller.person)
    } catch (error) {
      if (error instanceof InstalledAppNotFound) throw new MockFailure(400, 'query_failed', `${source.name} answered 404 for GET ${url.pathname}: ${error.message}`)
      throw error
    }
    const result = rowsOf(response, query.http?.resultPath)
    if (typeof result === 'string') throw new MockFailure(400, 'query_failed', result)
    return result
  }

  function read(query: Query, inputs: unknown, scenario: MockScenario, caller: Caller): QueryResult {
    const source = sourceFor(query, scenario)
    const args = bind(query, inputs)
    const { columns, rows } = source.kind === 'postgres' ? readOrders(query, args) : source.kind === 'builtin-app' ? readInstalledApp(source, query, args, caller) : readHttp(query, args)
    const truncated = rows.length > query.rowLimit
    const limited = truncated ? rows.slice(0, query.rowLimit) : rows
    return { columns, rows: limited, rowCount: limited.length, truncated, durationMs: durationOf(query.id, limited.length) }
  }

  function write(query: Query, inputs: unknown, scenario: MockScenario): number {
    const source = sourceFor(query, scenario)
    const args = bind(query, inputs)
    if (source.kind === 'builtin-app') {
      // The mock built-in apps answer reads only; a real write goes to the built-in app as sent.
      throw new MockFailure(400, 'query_failed', `${source.name} answered 405 for ${query.http?.method ?? 'POST'} ${httpPath(query, args)}`)
    }
    if (source.kind === 'http') {
      const path = httpPath(query, args)
      const match = /^\/orders\/([^/]+)\/resend-confirmation$/.exec(path)
      if (!match) throw new MockFailure(400, 'query_failed', `storefront-api answered 404 for ${query.http?.method ?? 'POST'} ${path}`)
      const number = decodeURIComponent(match[1]!)
      if (!data.orders.some((order) => order.number === number)) throw new MockFailure(400, 'query_failed', `storefront-api answered 404: order ${number} not found`)
      return 1
    }
    if (query.id !== 'issue_refund') throw new MockFailure(400, 'query_failed', 'the mock database only runs the order desk writes (issue_refund)')
    // insert into refunds (order_number, amount, reason) values ({{ number }}, {{ amount }}, {{ reason }})
    if (args.number === null) throw new MockFailure(400, 'query_failed', 'null value in column "order_number" of relation "refunds" violates not-null constraint')
    if (args.amount === null) throw new MockFailure(400, 'query_failed', 'null value in column "amount" of relation "refunds" violates not-null constraint')
    const order = data.orders.find((candidate) => candidate.number === args.number)
    if (!order) {
      throw new MockFailure(400, 'query_failed', 'insert or update on table "refunds" violates foreign key constraint "refunds_order_number_fkey"')
    }
    const amount = typeof args.amount === 'number' ? args.amount : Number.NaN
    if (amount <= 0) throw new MockFailure(400, 'query_failed', 'new row for relation "refunds" violates check constraint "refunds_amount_positive"')
    const refunded = data.refunds.filter((refund) => refund.order_number === order.number).reduce((sum, refund) => sum + Number(refund.amount), 0)
    if (refunded + amount > Number(order.total)) throw new MockFailure(400, 'query_failed', 'refund total would exceed the order total (trigger refunds_within_total)')
    data.refunds.push({
      id: 9001 + data.refunds.length,
      order_number: order.number,
      amount: String(amount),
      reason: typeof args.reason === 'string' ? args.reason : null,
      created_at: new Date(now()).toISOString(),
    })
    return 1
  }

  function recordRun(slug: string, run: Omit<ActionRun, 'id' | 'finishedAt'>, started: number): ActionRun {
    const entry: ActionRun = { ...run, id: nextId('run'), finishedAt: new Date(Math.max(now(), started + 1)).toISOString() }
    runs.set(slug, [entry, ...(runs.get(slug) ?? [])])
    return entry
  }

  // -------------------------------------------------------------------------
  // Routes

  type Context = { caller: Caller; scenario: MockScenario; url: URL; request: Request }
  type Handler = (context: Context, params: string[]) => Promise<Response> | Response

  const json = (body: unknown, status = 200) => Response.json(body, { status })
  const noContent = () => new Response(null, { status: 204 })
  const pause = () => (latencyMs > 0 ? Bun.sleep(latencyMs) : undefined)

  const routes: [string, RegExp, Handler][] = [
    [
      'GET',
      /^\/me$/,
      ({ caller }) =>
        json({
          subject: caller.person.subject,
          personId: caller.person.personId,
          displayName: caller.person.displayName,
          effectiveGroupIds: groupsOf(caller),
          roles: { admin: caller.admin },
        } satisfies Me),
    ],
    [
      'GET',
      /^\/data-sources$/,
      ({ caller, scenario }) => {
        requireAnyEditor(caller)
        return json({ data: sources.map((source) => sourceOf(source, scenario)) })
      },
    ],
    [
      'GET',
      /^\/links$/,
      ({ caller, scenario }) => {
        requireAnyEditor(caller)
        return json({ items: mockInstalledAppLinks(scenario === 'app-installing') })
      },
    ],
    [
      'POST',
      /^\/data-sources$/,
      async ({ caller, scenario, request }) => {
        requireAdmin(caller)
        const body = await readBody(request)
        const { kind, name, slug, destinationComponentId } = body
        if (kind !== 'postgres' && kind !== 'http' && kind !== 'builtin-app') throw new MockFailure(400, 'invalid_request', 'kind must be postgres, http or builtin-app')
        if (typeof name !== 'string' || name.trim() === '') throw new MockFailure(400, 'invalid_request', 'name is required')
        if (typeof slug !== 'string' || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) throw new MockFailure(400, 'invalid_request', 'slug must be a DNS label')
        if (sources.some((source) => source.slug === slug)) throw new MockFailure(409, 'slug_taken', `data source ${slug} already exists`)
        if (kind === 'builtin-app') {
          // Any declared link may be added, installed or not (it turns ready once installed).
          const definition = body.definition
          if (typeof definition !== 'string' || !mockInstalledAppLinks(false).some((link) => link.definition === definition)) {
            throw new MockFailure(400, 'link_not_declared', `Internal Tool Builder does not link to ${String(definition)}`)
          }
          const record: SourceRecord = {
            id: nextId('ds'),
            slug,
            kind,
            name: name.trim(),
            connectionName: null,
            definition,
            createdBy: caller.person.displayName,
            createdAt: new Date(now()).toISOString(),
            readyAt: 0,
          }
          sources.push(record)
          return json(sourceOf(record, scenario), 201)
        }
        if (typeof destinationComponentId !== 'string' || destinationComponentId === '') throw new MockFailure(400, 'invalid_request', 'destinationComponentId is required')
        if (kind === 'http') {
          const app = WEB_COMPONENTS[destinationComponentId]
          if (!app) throw new MockFailure(400, 'invalid_request', 'unknown web component')
          if (!app.internalService) throw new MockFailure(400, 'internal_service_required', `${app.name} does not declare internalService`)
        }
        let connectionName: string | null = null
        if (kind === 'postgres') {
          const database = PROJECT_DATABASES.find((candidate) => candidate.componentId === destinationComponentId)
          if (!database?.connectable) throw new MockFailure(400, 'invalid_request', database ? 'the database engine is not supported' : 'unknown database')
          connectionName = typeof body.connectionName === 'string' && body.connectionName !== '' ? body.connectionName : slug
          if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(connectionName)) throw new MockFailure(400, 'invalid_request', 'connectionName must be a DNS label')
        }
        const record: SourceRecord = {
          id: nextId('ds'),
          slug,
          kind,
          name: name.trim(),
          connectionName,
          destinationComponentId,
          baseUrl: kind === 'http' ? `http://${WEB_COMPONENTS[destinationComponentId]!.name}-internal.shop.svc` : null,
          createdBy: caller.person.displayName,
          createdAt: new Date(now()).toISOString(),
          // The Platform rollout that carries the new connection takes a moment.
          readyAt: now() + 8_000,
        }
        sources.push(record)
        return json(sourceOf(record, scenario), 201)
      },
    ],
    [
      'DELETE',
      /^\/data-sources\/([^/]+)$/,
      ({ caller }, [id]) => {
        requireAdmin(caller)
        const index = sources.findIndex((source) => source.id === id)
        if (index === -1) throw new MockFailure(404, 'not_found', `no data source ${id}`)
        const using = tools
          .filter((tool) => tool.archivedAt === null)
          .filter((tool) => [tool.draft, ...tool.releases.slice(-1).map((release) => release.document)].some((doc) => doc.queries.some((query) => query.sourceId === id)))
          .map((tool) => tool.slug)
        if (using.length > 0) throw new MockFailure(409, 'data_source_in_use', 'tools still use this data source', { tools: using })
        sources.splice(index, 1)
        return noContent()
      },
    ],
    [
      'GET',
      /^\/data-sources\/([^/]+)\/schema$/,
      ({ caller, scenario }, [id]) => {
        requireAnyEditor(caller)
        const record = sources.find((source) => source.id === id)
        if (!record) throw new MockFailure(404, 'not_found', `no data source ${id}`)
        const source = sourceOf(record, scenario)
        if (source.kind === 'builtin-app') return json({ items: INSTALLED_APP_OPERATIONS[source.definition ?? ''] ?? [] })
        if (source.kind !== 'postgres') throw new MockFailure(400, 'invalid_request', 'only postgres sources have a schema')
        if (source.status === 'pending') throw new MockFailure(503, 'data_source_pending', `${source.name} is still being connected`)
        return json(SCHEMAS[source.destinationComponentId ?? ''] ?? { tables: [] })
      },
    ],
    [
      'GET',
      /^\/data-sources\/([^/]+)\/operations$/,
      ({ caller }, [id]) => {
        requireAnyEditor(caller)
        const record = sources.find((source) => source.id === id)
        if (!record) throw new MockFailure(404, 'not_found', `no data source ${id}`)
        if (record.kind !== 'builtin-app') throw new MockFailure(400, 'invalid_request', 'only built-in app sources have operations')
        return json({ items: INSTALLED_APP_OPERATIONS[record.definition ?? ''] ?? [] })
      },
    ],
    [
      'GET',
      /^\/project\/databases$/,
      ({ caller }) => {
        requireAdmin(caller)
        return json({ data: PROJECT_DATABASES })
      },
    ],
    ['GET', /^\/groups$/, () => json({ data: GROUPS })],
    [
      'GET',
      /^\/tools$/,
      ({ caller }) =>
        json({
          data: tools
            // A use-only caller sees a tool once it is published (server: `use && (edit || live)`).
            .filter((tool) => tool.archivedAt === null && accessOf(tool, caller).use && (accessOf(tool, caller).edit || liveOf(tool) !== undefined))
            .map((tool) => summaryOf(tool, caller))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }),
    ],
    [
      'POST',
      /^\/tools$/,
      async ({ caller, request }) => {
        requireAdmin(caller)
        const body = await readBody(request)
        if (typeof body.slug !== 'string' || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(body.slug)) throw new MockFailure(400, 'invalid_request', 'slug must be a DNS label')
        if (typeof body.name !== 'string' || body.name.trim() === '') throw new MockFailure(400, 'invalid_request', 'name is required')
        if (tools.some((tool) => tool.slug === body.slug)) throw new MockFailure(409, 'slug_taken', `tool ${body.slug} already exists`)
        const at = new Date(now()).toISOString()
        const tool: ToolRecord = {
          id: nextId('tool'),
          slug: body.slug,
          name: body.name.trim(),
          description: typeof body.description === 'string' ? body.description : '',
          createdAt: at,
          archivedAt: null,
          draft: emptyDocument(),
          draftUpdatedAt: at,
          releases: [],
          grants: { groups: [], actions: [] },
        }
        tools.push(tool)
        return json(toolOf(tool, caller), 201)
      },
    ],
    ['GET', /^\/tools\/([^/]+)$/, ({ caller }, [slug]) => json(toolOf(requireUse(slug!, caller), caller))],
    [
      'PATCH',
      /^\/tools\/([^/]+)$/,
      async ({ caller, request }, [slug]) => {
        const tool = requireEdit(slug!, caller)
        const body = await readBody(request)
        if (body.name !== undefined) {
          if (typeof body.name !== 'string' || body.name.trim() === '') throw new MockFailure(400, 'invalid_request', 'name must not be empty')
          tool.name = body.name.trim()
        }
        if (body.description !== undefined) {
          if (typeof body.description !== 'string') throw new MockFailure(400, 'invalid_request', 'description must be a string')
          tool.description = body.description
        }
        return json(toolOf(tool, caller))
      },
    ],
    [
      'DELETE',
      /^\/tools\/([^/]+)$/,
      ({ caller }, [slug]) => {
        requireAdmin(caller)
        findTool(slug!).archivedAt = new Date(now()).toISOString()
        return noContent()
      },
    ],
    [
      'PUT',
      /^\/tools\/([^/]+)\/draft$/,
      async ({ caller, request }, [slug]) => {
        const tool = requireEdit(slug!, caller)
        const document = await readBody(request)
        // Compare and write with no await in between, so two concurrent saves with one token cannot both win.
        // The token is compared exactly, like the server (a quoted ETag form is a different token).
        if (request.headers.get('if-match') !== tool.draftUpdatedAt) throw draftChanged(tool, caller)
        // Like the server: a draft is work in progress, so any structurally decodable document is stored
        // (dangling refs, missing params, …); only `schema` problems reject it. Publishing validates fully.
        const structural = validateDocument(document).filter((problem) => problem.code === 'schema')
        if (structural.length > 0) throw new MockFailure(400, 'invalid_document', structural[0]!.message, { problems: structural })
        // It decodes as a Document (no `schema` problem).
        tool.draft = document as Document
        // Strictly increasing, so two saves in the same millisecond still get different tokens.
        tool.draftUpdatedAt = new Date(Math.max(now(), Date.parse(tool.draftUpdatedAt) + 1)).toISOString()
        return json(toolOf(tool, caller))
      },
    ],
    [
      'POST',
      /^\/tools\/([^/]+)\/draft\/queries\/([^/]+)\/run$/,
      async ({ caller, scenario, request }, [slug, queryId]) => {
        const tool = requireEdit(slug!, caller)
        const body = await readBody(request)
        const index = tool.draft.queries.findIndex((candidate) => candidate.id === queryId)
        const query = tool.draft.queries[index]
        if (!query) throw new MockFailure(404, 'not_found', `the draft has no query ${queryId}`)
        // A draft keeps unfinished queries; the one to run must have no problem of its own (empty SQL, bindings).
        const own = validateDocument(tool.draft).filter((problem) => problem.path === `queries.${index}` || problem.path.startsWith(`queries.${index}.`))
        if (own.length > 0) throw new MockFailure(400, 'invalid_document', own[0]!.message, { problems: own })
        await pause()
        if (query.mode === 'read') return json(read(query, body.inputs, scenario, caller))
        if (body.confirmWrite !== true) throw new MockFailure(400, 'write_not_confirmed', 'running a write query needs confirmWrite')
        const started = now()
        const base = { releaseNumber: 0, actionId: '', actionLabel: '', queryId: query.id, actor: { subject: caller.person.subject, displayName: caller.person.displayName }, startedAt: new Date(started).toISOString() }
        try {
          const rowCount = write(query, body.inputs, scenario)
          recordRun(tool.slug, { ...base, status: 'ok', rowCount, error: null }, started)
          return json({ columns: [], rows: [], rowCount, truncated: false, durationMs: durationOf(query.id, rowCount) } satisfies QueryResult)
        } catch (error) {
          if (error instanceof MockFailure) recordRun(tool.slug, { ...base, status: 'failed', rowCount: null, error: error.message }, started)
          throw error
        }
      },
    ],
    [
      'GET',
      /^\/tools\/([^/]+)\/releases$/,
      ({ caller }, [slug]) => {
        const tool = requireEdit(slug!, caller)
        return json({ data: [...tool.releases].reverse().map((release) => releaseOf(tool, release)) })
      },
    ],
    [
      'GET',
      /^\/tools\/([^/]+)\/releases\/(\d+)$/,
      ({ caller }, [slug, n]) => {
        const tool = requireEdit(slug!, caller)
        const release = tool.releases.find((candidate) => candidate.number === Number(n))
        if (!release) throw new MockFailure(404, 'not_found', `no release ${n}`)
        return json({ ...releaseOf(tool, release), document: structuredClone(release.document) } satisfies ReleaseDetail)
      },
    ],
    [
      'POST',
      /^\/tools\/([^/]+)\/releases$/,
      async ({ caller, request }, [slug]) => {
        const tool = requireEdit(slug!, caller)
        const body = await readBody(request)
        const ifMatch = request.headers.get('if-match')
        if (ifMatch !== null && ifMatch !== '' && ifMatch !== tool.draftUpdatedAt) throw draftChanged(tool, caller)
        publishable(tool.draft)
        const release: StoredRelease = {
          id: nextId('rel'),
          number: (liveOf(tool)?.number ?? 0) + 1,
          note: typeof body.note === 'string' ? body.note : '',
          changes: documentChanges(liveOf(tool)?.document ?? null, tool.draft),
          publishedBy: { subject: caller.person.subject, displayName: caller.person.displayName },
          publishedAt: new Date(now()).toISOString(),
          restoredFrom: null,
          document: structuredClone(tool.draft),
        }
        tool.releases.push(release)
        return json(releaseOf(tool, release), 201)
      },
    ],
    [
      'POST',
      /^\/tools\/([^/]+)\/releases\/(\d+)\/restore$/,
      async ({ caller, request }, [slug, n]) => {
        const tool = requireEdit(slug!, caller)
        const body = await readBody(request)
        const ifMatch = request.headers.get('if-match')
        if (ifMatch !== null && ifMatch !== '' && ifMatch !== tool.draftUpdatedAt) throw draftChanged(tool, caller)
        const source = tool.releases.find((candidate) => candidate.number === Number(n))
        if (!source) throw new MockFailure(404, 'not_found', `no release ${n}`)
        publishable(source.document)
        const release: StoredRelease = {
          id: nextId('rel'),
          number: liveOf(tool)!.number + 1,
          note: typeof body.note === 'string' ? body.note : '',
          changes: documentChanges(liveOf(tool)!.document, source.document),
          publishedBy: { subject: caller.person.subject, displayName: caller.person.displayName },
          publishedAt: new Date(now()).toISOString(),
          restoredFrom: source.number,
          document: structuredClone(source.document),
        }
        tool.releases.push(release)
        return json(releaseOf(tool, release), 201)
      },
    ],
    [
      'POST',
      /^\/tools\/([^/]+)\/queries\/([^/]+)\/run$/,
      async ({ caller, scenario, request }, [slug, queryId]) => {
        const tool = requireUse(slug!, caller)
        const body = await readBody(request)
        const live = liveOf(tool)
        if (!live) throw new MockFailure(404, 'not_found', 'this tool has not been published')
        const query = live.document.queries.find((candidate) => candidate.id === queryId)
        if (!query) throw new MockFailure(404, 'not_found', `the live release has no query ${queryId}`)
        if (query.mode !== 'read') throw new MockFailure(400, 'query_not_read_only', 'write queries run only through their action')
        await pause()
        return json(read(query, body.inputs, scenario, caller))
      },
    ],
    [
      'POST',
      /^\/tools\/([^/]+)\/actions\/([^/]+)\/run$/,
      async ({ caller, scenario, request }, [slug, actionId]) => {
        const tool = requireUse(slug!, caller)
        const body = await readBody(request)
        const live = liveOf(tool)
        if (!live) throw new MockFailure(404, 'not_found', 'this tool has not been published')
        const action = live.document.pages.flatMap((page) => page.components).flatMap((component) => component.actions ?? []).find((candidate) => candidate.id === actionId)
        if (!action) throw new MockFailure(404, 'not_found', `the live release has no action ${actionId}`)
        const query = live.document.queries.find((candidate) => candidate.id === action.queryId)!
        const started = now()
        const base = {
          releaseNumber: live.number,
          actionId: action.id,
          actionLabel: action.label,
          queryId: query.id,
          actor: { subject: caller.person.subject, displayName: caller.person.displayName },
          startedAt: new Date(started).toISOString(),
        }
        const grant = tool.grants.actions.find((candidate) => candidate.actionId === action.id)
        if (!caller.admin && grant && !grant.groupIds.some((groupId) => groupsOf(caller).includes(groupId))) {
          const message = 'your groups may not run this action'
          recordRun(tool.slug, { ...base, status: 'denied', rowCount: null, error: message }, started)
          throw new MockFailure(403, 'action_denied', message)
        }
        await pause()
        try {
          const rowCount = write(query, body.inputs, scenario)
          const run = recordRun(tool.slug, { ...base, status: 'ok', rowCount, error: null }, started)
          return json({ runId: run.id, rowCount, refresh: action.onSuccess?.refresh ?? [], durationMs: durationOf(query.id, rowCount) })
        } catch (error) {
          if (error instanceof MockFailure) recordRun(tool.slug, { ...base, status: 'failed', rowCount: null, error: error.message }, started)
          throw error
        }
      },
    ],
    ['GET', /^\/tools\/([^/]+)\/grants$/, ({ caller }, [slug]) => json(requireEdit(slug!, caller).grants)],
    [
      'PUT',
      /^\/tools\/([^/]+)\/grants$/,
      async ({ caller, request }, [slug]) => {
        const tool = requireEdit(slug!, caller)
        const body = await readBody(request)
        if (!Array.isArray(body.groups) || !Array.isArray(body.actions)) throw new MockFailure(400, 'invalid_request', 'groups and actions are required')
        // Like the server: distinct known groups, and action limits only for actions of the draft or the live
        // release, each with distinct known groups (an empty list is kept: nobody may run that action).
        const known = (groupId: unknown): groupId is string => typeof groupId === 'string' && GROUPS.some((group) => group.id === groupId)
        const groups: Grants['groups'] = []
        for (const entry of body.groups) {
          if (!isObject(entry) || !known(entry.groupId) || groups.some((grant) => grant.groupId === entry.groupId) || (entry.role !== 'use' && entry.role !== 'edit')) {
            throw new MockFailure(400, 'invalid_request', 'Each grant must name a distinct Directory group and a use or edit role')
          }
          groups.push({ groupId: entry.groupId, role: entry.role })
        }
        const actionIds = new Set(
          [tool.draft, ...(liveOf(tool) ? [liveOf(tool)!.document] : [])].flatMap((document) => document.pages.flatMap((page) => page.components.flatMap((component) => (component.actions ?? []).map((action) => action.id)))),
        )
        const actions: Grants['actions'] = []
        for (const entry of body.actions) {
          if (!isObject(entry) || typeof entry.actionId !== 'string' || !actionIds.has(entry.actionId) || actions.some((grant) => grant.actionId === entry.actionId) || !Array.isArray(entry.groupIds)) {
            throw new MockFailure(400, 'invalid_request', 'Each action grant must name a distinct existing action and group array')
          }
          if (!entry.groupIds.every(known) || new Set(entry.groupIds).size !== entry.groupIds.length) throw new MockFailure(400, 'invalid_request', 'Action groups must be distinct Directory groups')
          actions.push({ actionId: entry.actionId, groupIds: [...entry.groupIds] })
        }
        tool.grants = { groups, actions }
        return json(tool.grants)
      },
    ],
    [
      'GET',
      /^\/tools\/([^/]+)\/runs$/,
      ({ caller, url }, [slug]) => {
        const tool = requireEdit(slug!, caller)
        const limit = Number(url.searchParams.get('limit') ?? 50)
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new MockFailure(400, 'invalid_request', 'limit must be 1–200')
        return json({ data: (runs.get(tool.slug) ?? []).slice(0, limit) })
      },
    ],
  ]

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(`${API_BASE}/`)) return json({ error: 'not_found', message: `no mock for ${url.pathname}` }, 404)
    const path = url.pathname.slice(API_BASE.length)
    const cookies = parseCookies(request.headers.get('cookie'))
    const roleParam = pick(MOCK_ROLES, url.searchParams.get('as'))
    const scenarioParam = pick(MOCK_SCENARIOS, url.searchParams.get('scenario'))
    const role = roleParam ?? pick(MOCK_ROLES, cookies[ROLE_COOKIE]) ?? options.role ?? 'admin'
    const scenario = scenarioParam ?? pick(MOCK_SCENARIOS, cookies[SCENARIO_COOKIE]) ?? options.scenario ?? 'none'
    const context: Context = { caller: callerFor(role, scenario), scenario, url, request }
    let response: Response
    try {
      const route = routes.find(([method, pattern]) => method === request.method && pattern.test(path))
      if (!route) {
        const known = routes.some(([, pattern]) => pattern.test(path))
        throw new MockFailure(known ? 405 : 404, known ? 'method_not_allowed' : 'not_found', `no mock for ${request.method} ${url.pathname}`)
      }
      const params = route[1].exec(path)!.slice(1).map(decodeURIComponent)
      response = await route[2](context, params)
    } catch (error) {
      if (!(error instanceof MockFailure)) throw error
      response = json({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }, error.status)
    }
    if (roleParam) response.headers.append('set-cookie', `${ROLE_COOKIE}=${roleParam}; Path=/; SameSite=Lax`)
    if (scenarioParam) response.headers.append('set-cookie', `${SCENARIO_COOKIE}=${scenarioParam}; Path=/; SameSite=Lax`)
    return response
  }

  return { handle, state: { data, tools, sources, runs } }
}
