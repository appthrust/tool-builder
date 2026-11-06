import { describe, expect, test } from 'bun:test'
import { emptyDocument } from '../model/document'
import { createToolBuilderApi, isApiError, ToolBuilderApiError, type Fetcher } from './client'
import { API_BASE } from './types'

type Call = { url: string; init: RequestInit }

/** A fetcher that records each call and answers with the next response. */
function scripted(...responses: (Response | Error)[]): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url, init })
      const next = responses.shift()
      if (!next) throw new Error('no scripted response left')
      if (next instanceof Error) throw next
      return next
    },
  }
}

async function caught(promise: Promise<unknown>): Promise<ToolBuilderApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ToolBuilderApiError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

const noReauth = () => false

describe('ToolBuilderApiError mapping', () => {
  test('a coded answer keeps code, status and details and is final', async () => {
    const { fetcher } = scripted(Response.json({ error: 'draft_changed', message: 'draft changed', details: { draftVersion: 'v9' } }, { status: 409 }))
    const error = await caught(createToolBuilderApi(fetcher, noReauth).tools.saveDraft('order-desk', emptyDocument(), 'v8'))
    expect(error.status).toBe(409)
    expect(error.code).toBe('draft_changed')
    expect(error.message).toBe('draft changed')
    expect(error.details).toEqual({ draftVersion: 'v9' })
    expect(error.transient).toBe(false)
    expect(isApiError(error, 'draft_changed')).toBe(true)
    expect(isApiError(error, 'not_found')).toBe(false)
  })

  test('a 2xx that is not JSON (an edge page) is a transient api error, not a SyntaxError', async () => {
    const { fetcher } = scripted(new Response('<html>sign in</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    const error = await caught(createToolBuilderApi(fetcher, noReauth).me())
    expect(error.status).toBe(200)
    expect(error.code).toBe('unknown')
    expect(error.transient).toBe(true)
  })

  test('publish sends the saved draft version as If-Match', async () => {
    const { fetcher, calls } = scripted(Response.json({ number: 3 }, { status: 201 }))
    await createToolBuilderApi(fetcher, noReauth).releases.publish('order-desk', 'note', 'v8')
    expect(new Headers(calls[0]!.init.headers).get('If-Match')).toBe('v8')
  })

  test('a coded 5xx (pending data source) is an answer, not a transient failure', async () => {
    const { fetcher } = scripted(Response.json({ error: 'data_source_pending', message: 'still connecting' }, { status: 503 }))
    const error = await caught(createToolBuilderApi(fetcher, noReauth).tools.runQuery('order-desk', 'open_count', { inputs: {} }))
    expect(error.code).toBe('data_source_pending')
    expect(error.transient).toBe(false)
  })

  test('a 5xx without an envelope (proxy during a rollout) and a network failure are transient', async () => {
    const { fetcher } = scripted(new Response('<html>Bad gateway</html>', { status: 502 }), new TypeError('fetch failed'))
    const api = createToolBuilderApi(fetcher, noReauth)
    const proxy = await caught(api.tools.list())
    expect(proxy.status).toBe(502)
    expect(proxy.code).toBe('unknown')
    expect(proxy.transient).toBe(true)
    const network = await caught(api.me())
    expect(network.status).toBe(0)
    expect(network.transient).toBe(true)
  })

  test('a bare 404 reads as not_found; a 401 the edge cannot fix reaches the caller', async () => {
    const { fetcher } = scripted(new Response(null, { status: 404 }), Response.json({ error: 'unauthenticated', message: 'token rejected' }, { status: 401 }))
    const api = createToolBuilderApi(fetcher, noReauth)
    expect((await caught(api.tools.get('gone'))).code).toBe('not_found')
    const denied = await caught(api.me())
    expect(denied.status).toBe(401)
    expect(denied.transient).toBe(false)
  })

  test('the first 401 hands over to sign-in and never settles', async () => {
    const { fetcher } = scripted(new Response(null, { status: 401 }))
    let reauths = 0
    let settled = false
    createToolBuilderApi(fetcher, () => ++reauths === 1)
      .me()
      .then(
        () => (settled = true),
        () => (settled = true)
      )
    // Let the scripted fetch and the response handling run to completion (microtasks only).
    for (let tick = 0; tick < 20; tick++) await Promise.resolve()
    expect(settled).toBe(false)
    expect(reauths).toBe(1)
  })
})

describe('requests', () => {
  test('saveDraft PUTs the whole document with If-Match and returns the tool', async () => {
    const { fetcher, calls } = scripted(Response.json({ slug: 'order-desk', draftVersion: 'v2' }))
    const tool = await createToolBuilderApi(fetcher, noReauth).tools.saveDraft('order-desk', emptyDocument(), '2026-10-13T08:21:40.000Z')
    expect(tool.draftVersion).toBe('v2')
    expect(calls[0]!.url).toBe(`${API_BASE}/tools/order-desk/draft`)
    expect(calls[0]!.init.method).toBe('PUT')
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('if-match')).toBe('2026-10-13T08:21:40.000Z')
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(emptyDocument())
  })

  test('lists unwrap {data}, ids are path-encoded, 204 resolves undefined', async () => {
    const { fetcher, calls } = scripted(
      Response.json({ data: [{ id: 'run_1' }] }),
      new Response(null, { status: 204 }),
      Response.json({ runId: 'run_2', rowCount: 1, refresh: [], durationMs: 4 })
    )
    const api = createToolBuilderApi(fetcher, noReauth)
    expect(await api.runs.list('order-desk', 20)).toEqual([{ id: 'run_1' }] as never)
    expect(calls[0]!.url).toBe(`${API_BASE}/tools/order-desk/runs?limit=20`)
    expect(await api.dataSources.remove('ds/1')).toBeUndefined()
    expect(calls[1]!.url).toBe(`${API_BASE}/data-sources/ds%2F1`)
    expect(calls[1]!.init.method).toBe('DELETE')
    await api.tools.runAction('order-desk', 'issue_refund', { inputs: { amount: 1200 } })
    expect(calls[2]!.url).toBe(`${API_BASE}/tools/order-desk/actions/issue_refund/run`)
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ inputs: { amount: 1200 } })
  })

  test('only reads carry a timeout signal; query runs rely on the server-side timeout', async () => {
    const { fetcher, calls } = scripted(Response.json({ data: [] }), Response.json({ columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 1 }))
    const api = createToolBuilderApi(fetcher, noReauth)
    await api.tools.list()
    await api.tools.runDraftQuery('order-desk', 'search_orders', { inputs: {} })
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal)
    expect(calls[1]!.init.signal).toBeUndefined()
  })
})
