import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Document } from '../../../model/document'
import { validateDocument } from '../../../model/document.schema'
import { freeQueryId, newQuery, removeQuery, setMode, updateQuery } from './query-ops'

const orderDesk = JSON.parse(
  readFileSync(new URL('../../../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json', import.meta.url), 'utf8'),
) as Document

describe('query ops', () => {
  test('updateQuery syncs params from the edited text and keeps the document valid', () => {
    const next = updateQuery(orderDesk, 'order_detail', (q) => ({ ...q, sql: { text: 'select * from orders where number = {{ number }} and status = {{ status }}' } }))
    const query = next.queries.find((q) => q.id === 'order_detail')!
    expect(query.params.map((p) => p.name)).toEqual(['number', 'status'])
    expect(query.params[0]!.bind).toEqual({ ref: { component: 'orders', prop: 'selectedRow.number' } })
    expect(validateDocument(next)).toEqual([])
  })

  test('identity when the edit returns the same query or the id is unknown', () => {
    expect(updateQuery(orderDesk, 'order_detail', (q) => q)).toBe(orderDesk)
    expect(updateQuery(orderDesk, 'nope', (q) => ({ ...q, name: 'x' }))).toBe(orderDesk)
    expect(removeQuery(orderDesk, 'nope')).toBe(orderDesk)
  })

  test('freeQueryId suffixes taken ids', () => {
    expect(freeQueryId(orderDesk, 'refunds')).toBe('refunds')
    expect(freeQueryId(orderDesk, 'search_orders')).toBe('search_orders_2')
  })

  test('new queries are valid in the document', () => {
    const read = newQuery(orderDesk, { name: 'refunds', sourceId: 'ds_orders', kind: 'postgres', mode: 'read' })
    const write = newQuery(orderDesk, { name: 'cancel', sourceId: 'ds_orders', kind: 'postgres', mode: 'write' })
    expect(read).toMatchObject({ id: 'refunds', sql: { text: '' }, rowLimit: 500, timeoutMs: 10000 })
    expect(write.rowLimit).toBe(0)
    const doc = { ...orderDesk, queries: [...orderDesk.queries, { ...read, sql: { text: 'select 1' } }, { ...write, sql: { text: 'select 1' } }] }
    expect(validateDocument(doc)).toEqual([])
  })

  test('setMode adjusts row limit and http read method', () => {
    const http = newQuery(orderDesk, { name: 'resend', sourceId: 'ds_api', kind: 'http', mode: 'write' })
    expect(http.http).toEqual({ method: 'POST', path: '/' })
    const read = setMode(http, 'read')
    expect(read.http?.method).toBe('GET')
    expect(read.rowLimit).toBe(500)
    expect(setMode(read, 'read')).toBe(read)
  })
})
