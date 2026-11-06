import { describe, expect, test } from 'bun:test'
import type { ActionRun, InstalledAppLink, AppOperation, ApiError, DataSource, QueryResult, Release, Tool, ToolSummary } from '../api/types'
import { API_BASE } from '../api/types'
import { validateDocument } from '../model/document.schema'
import { customerLookupDocument, ORDER_DESK, orderDeskAt, orderDeskDraft, stockLevelsDocument } from './mock-data'
import { createMockToolBuilder, ROLE_COOKIE, type MockOptions } from './mock-tool-builder'

const NOW = Date.parse('2026-10-14T01:00:00Z')

type Answer<T> = { status: number; headers: Headers; body: T }
type Call = <T>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Answer<T>>

function mock(options: MockOptions = {}) {
  const instance = createMockToolBuilder({ now: () => NOW, ...options })
  const call: Call = async <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await instance.handle(
      new Request(`http://mock${API_BASE}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    )
    const text = await response.text()
    return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : undefined) as T }
  }
  return { instance, call }
}

const columnIndex = (result: QueryResult, name: string) => result.columns.findIndex((column) => column.name === name)

describe('seed documents', () => {
  test('every seeded document passes the SPA validator (the fixture, its history, the draft, the small tools)', () => {
    const documents = [ORDER_DESK, orderDeskDraft(), stockLevelsDocument(), customerLookupDocument(), ...Array.from({ length: 12 }, (_, index) => orderDeskAt(index + 1))]
    for (const document of documents) expect(validateDocument(document)).toEqual([])
  })

  test('v11 and its restore v13 equal the golden fixture; v12 is rolled back', async () => {
    expect(orderDeskAt(11)).toEqual(ORDER_DESK)
    const { call } = mock()
    const releases = (await call<{ data: Release[] }>('GET', '/tools/order-desk/releases')).body.data
    expect(releases.map((release) => release.number)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(releases[0]).toMatchObject({ live: true, restoredFrom: 11 })
    expect(releases.filter((release) => release.live)).toHaveLength(1)
    expect(releases.every((release) => release.changes.length > 0)).toBe(true)
  })
})

describe('roles and access', () => {
  test('the tool list is filtered by grants; admins see every tool', async () => {
    const slugs = async (role: MockOptions['role']) => (await mock({ role }).call<{ data: ToolSummary[] }>('GET', '/tools')).body.data.map((tool) => [tool.slug, tool.access])
    expect(await slugs('admin')).toEqual([
      ['customer-lookup', { use: true, edit: true }],
      ['order-desk', { use: true, edit: true }],
      ['stock-levels', { use: true, edit: true }],
    ])
    expect(await slugs('editor')).toEqual([
      ['customer-lookup', { use: true, edit: true }],
      ['order-desk', { use: true, edit: true }],
      ['stock-levels', { use: true, edit: true }],
    ])
    expect(await slugs('user')).toEqual([
      ['order-desk', { use: true, edit: false }],
      ['stock-levels', { use: true, edit: false }],
    ])
    expect(await slugs(undefined)).toHaveLength(3)
  })

  test('users get the live document only; editors also get the draft and its version', async () => {
    const user = (await mock({ role: 'user' }).call<Tool>('GET', '/tools/order-desk')).body
    expect(user.draft).toBeNull()
    expect(user.draftVersion).toBeNull()
    expect(user.live?.releaseNumber).toBe(13)
    const editor = (await mock({ role: 'editor' }).call<Tool>('GET', '/tools/order-desk')).body
    expect(editor.draft).toEqual(orderDeskDraft())
    expect(editor.draftVersion).toBe('2026-10-13T08:21:40.000Z')
  })

  test('the denied scenario answers tool_forbidden naming the editing groups, never the document', async () => {
    const { status, body } = await mock({ scenario: 'denied' }).call<ApiError>('GET', '/tools/order-desk')
    expect(status).toBe(403)
    expect(body).toEqual({ error: 'tool_forbidden', message: "Request access from the tool's editing groups", details: { toolName: 'Order desk', editors: ['IT プラットフォーム'] } })
    expect((await mock({ scenario: 'denied' }).call<{ data: ToolSummary[] }>('GET', '/tools')).body.data).toEqual([])
  })

  test('an unpublished tool is hidden from use-only callers (list and GET), like the server', async () => {
    const { call } = mock()
    const user = { cookie: `${ROLE_COOKIE}=user` }
    const group = (await call<{ effectiveGroupIds: string[] }>('GET', '/me', undefined, user)).body.effectiveGroupIds[0]!
    expect((await call('POST', '/tools', { slug: 'draft-only', name: 'Draft only' })).status).toBe(201)
    expect((await call('PUT', '/tools/draft-only/grants', { groups: [{ groupId: group, role: 'use' }], actions: [] })).status).toBe(200)
    const listed = async () => (await call<{ data: ToolSummary[] }>('GET', '/tools', undefined, user)).body.data.map((tool) => tool.slug)
    expect(await listed()).not.toContain('draft-only')
    const denied = await call<ApiError>('GET', '/tools/draft-only', undefined, user)
    expect(denied.status).toBe(403)
    expect(denied.body.error).toBe('tool_forbidden')
    expect((await call('PUT', '/tools/draft-only/grants', { groups: [{ groupId: group, role: 'edit' }], actions: [] })).status).toBe(200)
    expect(await listed()).toContain('draft-only')
  })

  test('an edit route without the edit grant is tool_forbidden too', async () => {
    const answer = await mock({ role: 'user' }).call<ApiError>('GET', '/tools/order-desk/grants')
    expect(answer.status).toBe(403)
    expect(answer.body.error).toBe('tool_forbidden')
  })

  test('admin-only routes refuse other roles; ?as= switches the caller and remembers it in a cookie', async () => {
    const { call } = mock()
    expect((await call('GET', '/data-sources')).status).toBe(200)
    const switched = await call<{ roles: { admin: boolean } }>('GET', '/me?as=user')
    expect(switched.body.roles.admin).toBe(false)
    expect(switched.headers.get('set-cookie')).toContain(`${ROLE_COOKIE}=user`)
    const asUser = await call<ApiError>('GET', '/data-sources', undefined, { cookie: `${ROLE_COOKIE}=user` })
    expect(asUser.status).toBe(403)
    expect(asUser.body.error).toBe('forbidden')
    expect((await call('PUT', '/tools/order-desk/grants', { groups: [], actions: [] }, { cookie: `${ROLE_COOKIE}=user` })).status).toBe(403)
    const editor = { cookie: `${ROLE_COOKIE}=editor` }
    expect((await call('GET', '/data-sources', undefined, editor)).status).toBe(200)
    expect((await call<ApiError>('POST', '/data-sources', { kind: 'postgres', name: 'A', slug: 'a', destinationComponentId: 'db-analytics' }, editor)).status).toBe(403)
    expect((await call('DELETE', '/data-sources/ds_storefront', undefined, editor)).status).toBe(403)
  })
})

describe('draft If-Match', () => {
  test('a save with the current version succeeds and moves the version; a stale one gets 409 with the server version', async () => {
    const { call } = mock()
    const tool = (await call<Tool>('GET', '/tools/order-desk')).body
    const document = structuredClone(tool.draft!)
    document.pages[0]!.title = 'Order desk (support)'
    const saved = await call<Tool>('PUT', '/tools/order-desk/draft', document, { 'if-match': tool.draftVersion! })
    expect(saved.status).toBe(200)
    expect(saved.body.draft?.pages[0]?.title).toBe('Order desk (support)')
    expect(saved.body.draftVersion).not.toBe(tool.draftVersion)

    const stale = await call<ApiError>('PUT', '/tools/order-desk/draft', document, { 'if-match': tool.draftVersion! })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toBe('draft_changed')
    expect(stale.body.details).toEqual({ draftVersion: saved.body.draftVersion, draft: saved.body.draft })

    expect((await call<ApiError>('PUT', '/tools/order-desk/draft', document)).status).toBe(409)
    // The token is compared exactly, like the server: the quoted ETag form is another token.
    expect((await call('PUT', '/tools/order-desk/draft', document, { 'if-match': `"${saved.body.draftVersion}"` })).status).toBe(409)
    expect((await call('PUT', '/tools/order-desk/draft', document, { 'if-match': saved.body.draftVersion! })).status).toBe(200)
  })

  test('two concurrent saves with the same version: exactly one wins, the other gets draft_changed', async () => {
    const { call } = mock()
    const tool = (await call<Tool>('GET', '/tools/order-desk')).body
    const first = structuredClone(tool.draft!)
    first.pages[0]!.title = 'First'
    const second = structuredClone(tool.draft!)
    second.pages[0]!.title = 'Second'
    const answers = await Promise.all([
      call<Tool | ApiError>('PUT', '/tools/order-desk/draft', first, { 'if-match': tool.draftVersion! }),
      call<Tool | ApiError>('PUT', '/tools/order-desk/draft', second, { 'if-match': tool.draftVersion! }),
    ])
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409])
    const winner = answers.findIndex((answer) => answer.status === 200)
    expect((await call<Tool>('GET', '/tools/order-desk')).body.draft?.pages[0]?.title).toBe(winner === 0 ? 'First' : 'Second')
  })

  test('a draft stores semantic problems mid-edit but rejects a document that does not decode; publish validates fully', async () => {
    const { call } = mock()
    const tool = (await call<Tool>('GET', '/tools/order-desk')).body
    const unfinished = structuredClone(tool.draft!)
    unfinished.queries[0]!.sql = { text: 'select * from orders where number = {{ missing }}' }
    const saved = await call<Tool>('PUT', '/tools/order-desk/draft', unfinished, { 'if-match': tool.draftVersion! })
    expect(saved.status).toBe(200)
    expect(saved.body.draft?.queries[0]?.sql?.text).toContain('{{ missing }}')

    const publish = await call<ApiError>('POST', '/tools/order-desk/releases', { note: 'broken' })
    expect(publish.status).toBe(400)
    expect(publish.body.error).toBe('invalid_document')
    expect(Array.isArray(publish.body.details?.problems)).toBe(true)

    const undecodable = await call<ApiError>('PUT', '/tools/order-desk/draft', { schemaVersion: 1, pages: 'none', queries: [] }, { 'if-match': saved.body.draftVersion! })
    expect(undecodable.status).toBe(400)
    expect(undecodable.body.error).toBe('invalid_document')
    expect((await call<Tool>('GET', '/tools/order-desk')).body.draftVersion).toBe(saved.body.draftVersion)
  })

  test('empty SQL is saved with the draft, but that query does not run and the draft does not publish', async () => {
    const { call } = mock()
    const tool = (await call<Tool>('GET', '/tools/order-desk')).body
    const draft = structuredClone(tool.draft!)
    const index = draft.queries.findIndex((query) => query.id === 'open_count')
    draft.queries[index]!.sql = { text: '  ' }
    expect((await call('PUT', '/tools/order-desk/draft', draft, { 'if-match': tool.draftVersion! })).status).toBe(200)
    const run = await call<ApiError>('POST', '/tools/order-desk/draft/queries/open_count/run', { inputs: {} })
    expect(run.status).toBe(400)
    expect(run.body).toMatchObject({ error: 'invalid_document', details: { problems: [{ code: 'empty_query', path: `queries.${index}.sql.text` }] } })
    expect((await call('POST', '/tools/order-desk/draft/queries/search_orders/run', { inputs: { search: '', statuses: [] } })).status).toBe(200)
    expect((await call<ApiError>('POST', '/tools/order-desk/releases', { note: '' })).body.error).toBe('invalid_document')
  })

  test('publish honours an optional If-Match; publish and restore check each query has its stored source', async () => {
    const { call, instance } = mock()
    const stale = await call<ApiError>('POST', '/tools/order-desk/releases', { note: '' }, { 'if-match': 'stale' })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toBe('draft_changed')
    expect(stale.body.details?.draftVersion).toBe('2026-10-13T08:21:40.000Z')

    instance.state.sources.splice(instance.state.sources.findIndex((source) => source.id === 'ds_orders'), 1)
    for (const [path, body] of [
      ['/tools/order-desk/releases', { note: '' }],
      ['/tools/order-desk/releases/11/restore', {}],
    ] as const) {
      const answer = await call<ApiError>('POST', path, body)
      expect(answer.status).toBe(400)
      expect(answer.body).toMatchObject({ error: 'invalid_document', details: { problems: [{ code: 'query_source_missing' }] } })
    }
  })

  test('PUT grants: action limits only for existing actions, distinct groups; an empty limit is kept', async () => {
    const { call } = mock()
    const put = (grants: unknown) => call<ApiError>('PUT', '/tools/order-desk/grants', grants)
    expect((await put({ groups: [], actions: [{ actionId: 'no_such_action', groupIds: [] }] })).status).toBe(400)
    expect((await put({ groups: [{ groupId: 'finance', role: 'use' }, { groupId: 'finance', role: 'edit' }], actions: [] })).status).toBe(400)
    expect((await put({ groups: [], actions: [{ actionId: 'issue_refund', groupIds: ['finance', 'finance'] }] })).status).toBe(400)
    const nobody = await call<{ actions: unknown[] }>('PUT', '/tools/order-desk/grants', { groups: [], actions: [{ actionId: 'issue_refund', groupIds: [] }] })
    expect(nobody.status).toBe(200)
    expect(nobody.body.actions).toEqual([{ actionId: 'issue_refund', groupIds: [] }])
  })

  test('publishing the draft records its changes against live and becomes live', async () => {
    const { call } = mock()
    const release = await call<Release>('POST', '/tools/order-desk/releases', { note: 'Resend confirmations' })
    expect(release.status).toBe(201)
    expect(release.body).toMatchObject({ number: 14, live: true, note: 'Resend confirmations' })
    expect(release.body.changes).toHaveLength(3)
    expect((await call<Tool>('GET', '/tools/order-desk')).body.live?.releaseNumber).toBe(14)
  })
})

describe('query param handling', () => {
  const run = (call: Call, queryId: string, inputs: Record<string, unknown>) =>
    call<QueryResult>('POST', `/tools/order-desk/queries/${queryId}/run`, { inputs })

  test('search_orders honours the search prefix (number or e-mail) and the status list', async () => {
    const { call, instance } = mock()
    const all = (await run(call, 'search_orders', { search: '', statuses: [] })).body
    expect(all.columns.map((column) => column.name)).toEqual(['number', 'customer', 'total', 'status', 'created_at'])
    expect(all.rowCount).toBe(48)
    const created = columnIndex(all, 'created_at')
    expect(all.rows.map((row) => row[created])).toEqual([...all.rows.map((row) => row[created])].sort().reverse())

    const open = (await run(call, 'search_orders', { search: null, statuses: ['open', 'delayed'] })).body
    const statusAt = columnIndex(open, 'status')
    expect(open.rowCount).toBe(instance.state.data.orders.filter((order) => order.status === 'open' || order.status === 'delayed').length)
    expect(new Set(open.rows.map((row) => row[statusAt]))).toEqual(new Set(['open', 'delayed']))

    const byNumber = (await run(call, 'search_orders', { search: 'so-1046', statuses: null })).body
    expect(byNumber.rows.map((row) => row[0])).toEqual(['SO-10468', 'SO-10467', 'SO-10466', 'SO-10465', 'SO-10464', 'SO-10463', 'SO-10462', 'SO-10461', 'SO-10460'])

    const customer = instance.state.data.customers.find((candidate) => candidate.id === instance.state.data.orders[0]!.customer_id)!
    const byEmail = (await run(call, 'search_orders', { search: customer.email.slice(0, 6), statuses: [] })).body
    expect(byEmail.rowCount).toBeGreaterThan(0)
    expect(byEmail.rows.every((row) => row[1] === customer.name)).toBe(true)
  })

  test('typed binds reject the wrong JSON type', async () => {
    const { call } = mock()
    const response = await run(call, 'search_orders', { search: 42 })
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({ error: 'query_failed', details: { param: 'search' } })
  })

  test('order_detail returns the one order; open_count counts open orders', async () => {
    const { call, instance } = mock()
    const detail = (await run(call, 'order_detail', { number: 'SO-10450' })).body
    expect(detail.rowCount).toBe(1)
    expect(detail.columns.length).toBeGreaterThanOrEqual(10)
    expect(detail.rows[0]![0]).toBe('SO-10450')
    expect((await run(call, 'order_detail', { number: 'SO-1' })).body.rowCount).toBe(0)
    const count = (await run(call, 'open_count', {})).body
    expect(count.rows).toEqual([[instance.state.data.orders.filter((order) => order.status === 'open').length]])
  })

  test('a write query cannot run as a live read; draft runs need confirmWrite and are recorded', async () => {
    const { call } = mock()
    expect((await run(call, 'issue_refund', {})).body).toMatchObject({ error: 'query_not_read_only' })
    const unconfirmed = await call<ApiError>('POST', '/tools/order-desk/draft/queries/issue_refund/run', { inputs: { number: 'SO-10450', amount: 100, reason: null } })
    expect(unconfirmed.body.error).toBe('write_not_confirmed')
    const confirmed = await call<QueryResult>('POST', '/tools/order-desk/draft/queries/issue_refund/run', { inputs: { number: 'SO-10450', amount: 100, reason: null }, confirmWrite: true })
    expect(confirmed.body.rowCount).toBe(1)
    const runs = (await call<{ data: ActionRun[] }>('GET', '/tools/order-desk/runs?limit=1')).body.data
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ actionId: '', queryId: 'issue_refund', status: 'ok', releaseNumber: 0 })
  })
})

describe('actions', () => {
  test('issue_refund runs for finance and support leads, is denied to plain support, and the database checks the amount', async () => {
    const { call, instance } = mock({ role: 'user' })
    const order = instance.state.data.orders.find((candidate) => candidate.status === 'shipped')!
    const ok = await call<{ runId: string; rowCount: number; refresh: string[] }>('POST', '/tools/order-desk/actions/issue_refund/run', {
      inputs: { number: order.number, amount: 500, reason: '配送遅延のお詫び' },
    })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ rowCount: 1, refresh: ['search_orders', 'order_detail'] })
    expect(instance.state.data.refunds.at(-1)).toMatchObject({ order_number: order.number, amount: '500' })

    const tooMuch = await call<ApiError>('POST', '/tools/order-desk/actions/issue_refund/run', { inputs: { number: order.number, amount: Number(order.total), reason: null } })
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.error).toBe('query_failed')

    const support = createMockToolBuilder({ now: () => NOW })
    support.state.tools.find((tool) => tool.slug === 'order-desk')!.grants.actions = [{ actionId: 'issue_refund', groupIds: ['finance'] }]
    const denied = await support.handle(
      new Request(`http://mock${API_BASE}/tools/order-desk/actions/issue_refund/run`, {
        method: 'POST',
        headers: { cookie: `${ROLE_COOKIE}=user` },
        body: JSON.stringify({ inputs: { number: order.number, amount: 100 } }),
      })
    )
    expect(denied.status).toBe(403)
    expect(((await denied.json()) as ApiError).error).toBe('action_denied')
    expect(support.state.runs.get('order-desk')![0]).toMatchObject({ status: 'denied', actionId: 'issue_refund' })
  })
})

describe('data sources', () => {
  test('pending-source makes orders-db pending and its queries answer data_source_pending', async () => {
    const { call } = mock({ scenario: 'pending-source' })
    const sources = (await call<{ data: DataSource[] }>('GET', '/data-sources')).body.data
    expect(sources.map((source) => [source.slug, source.status])).toEqual([
      ['orders-db', 'pending'],
      ['storefront-api', 'ready'],
    ])
    const run = await call<ApiError>('POST', '/tools/order-desk/queries/open_count/run', { inputs: {} })
    expect(run.status).toBe(503)
    expect(run.body.error).toBe('data_source_pending')
  })

  test('a source in use cannot be removed; a new one starts pending; http targets need an internal address', async () => {
    let now = NOW
    const { call } = mock({ now: () => now })
    const inUse = await call<ApiError>('DELETE', '/data-sources/ds_orders')
    expect(inUse.status).toBe(409)
    expect(inUse.body).toMatchObject({ error: 'data_source_in_use', details: { tools: ['order-desk', 'customer-lookup'] } })
    const created = await call<DataSource>('POST', '/data-sources', { kind: 'postgres', name: 'Analytics', slug: 'analytics', destinationComponentId: 'db-analytics' })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ status: 'pending', connectionName: 'analytics' })
    now += 10_000
    expect((await call<{ data: DataSource[] }>('GET', '/data-sources')).body.data.find((source) => source.slug === 'analytics')?.status).toBe('ready')
    expect((await call<ApiError>('POST', '/data-sources', { kind: 'postgres', name: 'Again', slug: 'analytics', destinationComponentId: 'db-analytics' })).body.error).toBe('slug_taken')
    expect((await call<ApiError>('POST', '/data-sources', { kind: 'http', name: 'Portal', slug: 'portal', destinationComponentId: 'web-admin-portal' })).body.error).toBe('internal_service_required')
    expect((await call('DELETE', `/data-sources/${created.body.id}`)).status).toBe(204)
  })

  test('built-in app sources: links by state, creation by declared link only, status mirrors the link', async () => {
    const installing = mock({ scenario: 'app-installing' })
    const links = (await installing.call<{ items: InstalledAppLink[] }>('GET', '/links')).body.items
    expect(links.map((link) => [link.definition, link.state])).toEqual([
      ['directory', 'Ready'],
      ['knowledge', 'Installing'],
      ['builder-console', 'Absent'],
    ])
    const knowledge = await installing.call<DataSource>('POST', '/data-sources', { kind: 'builtin-app', definition: 'knowledge', name: 'Knowledge', slug: 'knowledge' })
    expect(knowledge.status).toBe(201)
    expect(knowledge.body).toMatchObject({ kind: 'builtin-app', definition: 'knowledge', status: 'pending', statusMessage: 'Knowledge is still installing' })
    expect(knowledge.body).not.toHaveProperty('baseUrl')
    const absent = await installing.call<DataSource>('POST', '/data-sources', { kind: 'builtin-app', definition: 'builder-console', name: 'Apps', slug: 'apps' })
    expect(absent.body).toMatchObject({ status: 'error', statusMessage: 'Builder Console is not installed in this Project' })
    const undeclared = await installing.call<ApiError>('POST', '/data-sources', { kind: 'builtin-app', definition: 'billing', name: 'Billing', slug: 'billing' })
    expect([undeclared.status, undeclared.body.error]).toEqual([400, 'link_not_declared'])
    const operations = (await installing.call<{ items: AppOperation[] }>('GET', `/data-sources/${knowledge.body.id}/operations`)).body.items
    expect(operations.find((operation) => operation.id === 'search')).toMatchObject({ method: 'GET', path: '/api/knowledge/v1/search', resultPath: 'hits' })
    expect((await installing.call<ApiError>('GET', '/data-sources/ds_orders/operations')).status).toBe(400)
  })

  test('a draft query on a Directory source runs through the picked operation', async () => {
    const { call } = mock()
    const directory = (await call<DataSource>('POST', '/data-sources', { kind: 'builtin-app', definition: 'directory', name: 'Directory', slug: 'directory' })).body
    expect(directory.status).toBe('ready')
    const tool = (await call<Tool>('GET', '/tools/customer-lookup')).body
    const draft = {
      ...tool.draft!,
      queries: [
        ...tool.draft!.queries,
        {
          id: 'groups',
          name: 'groups',
          sourceId: directory.id,
          mode: 'read' as const,
          http: { method: 'GET' as const, path: '/api/directory/v1/groups?q={{ q }}', resultPath: 'items' },
          params: [{ name: 'q', type: 'text' as const, bind: { literal: null } }],
          timeoutMs: 10000,
          rowLimit: 500,
        },
      ],
    }
    expect((await call('PUT', '/tools/customer-lookup/draft', draft, { 'if-match': tool.draftVersion! })).status).toBe(200)
    const run = await call<QueryResult>('POST', '/tools/customer-lookup/draft/queries/groups/run', { inputs: { q: 'support' } })
    expect(run.status).toBe(200)
    expect(run.body.columns.map((column) => column.name)).toEqual(['id', 'memberCount', 'name', 'path'])
    expect(run.body.rows.map((row) => row[columnIndex(run.body, 'id')])).toEqual(['cs-team', 'cs-leads'])
  })
})
