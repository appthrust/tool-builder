import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Document } from '../../../model/document'
import { bindParam, disconnectEdge, findComponent, setProp, unbindParam } from './document-ops'

const orderDesk = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json'), 'utf8')
) as Document

const query = (doc: Document, id: string) => doc.queries.find((candidate) => candidate.id === id)!

describe('param bindings', () => {
  test('bindParam replaces only that param bind', () => {
    const next = bindParam(orderDesk, 'search_orders', 'statuses', { component: 'search', prop: 'value' })
    expect(query(next, 'search_orders').params).toEqual([
      orderDesk.queries[1]!.params[0]!,
      { name: 'statuses', type: 'textList', bind: { ref: { component: 'search', prop: 'value' } } },
    ])
    expect(query(next, 'search_orders').params[0]).toBe(orderDesk.queries[1]!.params[0]!)
    for (const id of ['open_count', 'order_detail', 'issue_refund']) expect(query(next, id)).toBe(query(orderDesk, id))
    expect(next.pages).toBe(orderDesk.pages)
    expect(query(orderDesk, 'search_orders').params[1]!.bind).toEqual({ ref: { component: 'status', prop: 'value' } })
  })

  test('bindParam is a no-op for an unknown query or param, or the same ref', () => {
    expect(bindParam(orderDesk, 'nope', 'search', { component: 'search', prop: 'value' })).toBe(orderDesk)
    expect(bindParam(orderDesk, 'search_orders', 'nope', { component: 'search', prop: 'value' })).toBe(orderDesk)
    expect(bindParam(orderDesk, 'search_orders', 'search', { component: 'search', prop: 'value' })).toBe(orderDesk)
  })

  test('unbindParam yields a null literal', () => {
    const next = unbindParam(orderDesk, 'order_detail', 'number')
    expect(query(next, 'order_detail').params[0]).toEqual({ name: 'number', type: 'text', bind: { literal: null } })
    expect(unbindParam(next, 'order_detail', 'number')).toBe(next)
  })
})

describe('disconnectEdge', () => {
  test('param edge unbinds the param', () => {
    const next = disconnectEdge(orderDesk, { kind: 'param', from: { component: 'search', prop: 'value' }, to: 'orders', queryId: 'search_orders', param: 'search' })
    expect(query(next, 'search_orders').params[0]!.bind).toEqual({ literal: null })
    expect(query(next, 'search_orders').params[1]).toBe(orderDesk.queries[1]!.params[1]!)
  })

  test('prop edge removes the prop', () => {
    const withRef = setProp(orderDesk, 'openCount', 'delta', { kind: 'ref', ref: { component: 'search', prop: 'value' } })
    const next = disconnectEdge(withRef, { kind: 'prop', from: { component: 'search', prop: 'value' }, to: 'openCount', prop: 'delta' })
    expect('delta' in findComponent(next, 'openCount')!.props).toBe(false)
    expect(findComponent(next, 'openCount')!.props).toEqual(findComponent(orderDesk, 'openCount')!.props)
  })

  test('form edge leaves the document untouched (same object)', () => {
    expect(disconnectEdge(orderDesk, { kind: 'form', from: { component: 'refundForm', prop: 'values' }, to: 'orders', actionId: 'issue_refund' })).toBe(orderDesk)
  })
})
