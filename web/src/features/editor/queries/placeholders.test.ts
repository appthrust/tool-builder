import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Document, Param, Query } from '../../../model/document'
import { refOptions, sampleInput, syncParams, withSyncedParams } from './placeholders'

const orderDesk = JSON.parse(
  readFileSync(new URL('../../../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json', import.meta.url), 'utf8'),
) as Document

const query = (over: Partial<Query>): Query => ({ id: 'q', name: 'q', sourceId: 'ds', mode: 'read', params: [], timeoutMs: 10000, rowLimit: 500, ...over })

describe('placeholders', () => {
  test('golden order-desk queries are already in sync (identity)', () => {
    for (const q of orderDesk.queries) expect(withSyncedParams(q)).toBe(q)
  })

  test('http queries sync over path then body', () => {
    const q = query({ http: { method: 'POST', path: '/orders/{{ id }}', body: '{"a": {{ b }}, "c": {{id}}}' } })
    expect(withSyncedParams(q).params.map((p) => p.name)).toEqual(['id', 'b'])
  })

  test('sync keeps existing params with their type, binding and position; appends new; drops gone', () => {
    const params: Param[] = [
      { name: 'statuses', type: 'textList', bind: { ref: { component: 'status', prop: 'value' } } },
      { name: 'search', type: 'text', bind: { literal: 'A' } },
      { name: 'gone', type: 'number', bind: { literal: 1 } },
    ]
    const next = syncParams(params, ['search', 'limit', 'statuses'])
    expect(next).toEqual([params[0]!, params[1]!, { name: 'limit', type: 'text', bind: { literal: null } }])
  })

  test('sync returns the same array when nothing changes', () => {
    const params: Param[] = [{ name: 'a', type: 'text', bind: { literal: null } }]
    expect(syncParams(params, ['a'])).toBe(params)
  })

  test('withSyncedParams after typing a placeholder', () => {
    const q = query({ sql: { text: 'select * from orders where id = {{ id }}' } })
    expect(withSyncedParams(q).params).toEqual([{ name: 'id', type: 'text', bind: { literal: null } }])
  })

  test('filter-only params survive SQL edits with their binding and position', () => {
    const params: Param[] = [
      { name: 'status', type: 'textList', bind: { ref: { component: 'status', prop: 'value' } } },
      { name: 'old', type: 'text', bind: { literal: null } },
    ]
    const q = query({ sql: { text: 'select {{ fresh }}' }, params, filters: [{ column: 'status', op: 'in', param: 'status', skipWhenEmpty: true }] })
    const next = withSyncedParams(q)
    expect(next.params).toEqual([params[0]!, { name: 'fresh', type: 'text', bind: { literal: null } }])
    expect(next.params[0]).toBe(params[0])
    expect(withSyncedParams(next)).toBe(next)
  })

  test('sync does not invent missing filter params or drop shared uses', () => {
    const params: Param[] = [{ name: 'a', type: 'number', bind: { literal: 2 } }]
    expect(syncParams(params, [], ['a', 'missing'])).toBe(params)
    expect(syncParams(params, ['a'], ['a'])).toBe(params)
  })

  test('ref options cover exposed props with table columns and form fields', () => {
    const labels = refOptions(orderDesk).map((option) => option.label)
    expect(labels).toContain('search.value')
    expect(labels).toContain('status.value')
    expect(labels).toContain('orders.selectedRow.number')
    expect(labels).toContain('refundForm.values.amount')
    expect(labels).not.toContain('openCount.value')
  })

  test('sample inputs are typed', () => {
    expect(sampleInput('number', ' 42 ')).toBe(42)
    expect(sampleInput('number', 'x')).toBe('x')
    expect(sampleInput('text', '')).toBeNull()
    expect(sampleInput('boolean', 'true')).toBe(true)
    expect(sampleInput('textList', 'open, shipped,')).toEqual(['open', 'shipped'])
    expect(sampleInput('numberList', '1,2')).toEqual([1, 2])
    expect(sampleInput('text', 'A-1')).toBe('A-1')
  })
})
