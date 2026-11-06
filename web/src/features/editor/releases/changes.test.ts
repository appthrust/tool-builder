import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Release } from '../../../api/types'
import type { Document } from '../../../model/document'
import { compareDocuments, documentChanges } from './changes'
import { releaseBadges } from './history'

const orderDesk = JSON.parse(
  readFileSync(new URL('../../../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json', import.meta.url), 'utf8'),
) as Document

const clone = (doc: Document): Document => structuredClone(doc)

describe('documentChanges', () => {
  test('identical documents have no changes', () => {
    expect(documentChanges(orderDesk, clone(orderDesk))).toEqual([])
  })

  test('first release lists everything as added in kind order', () => {
    const changes = documentChanges(null, orderDesk)
    expect(changes.map((c) => c.kind)).toEqual([
      'page',
      ...orderDesk.pages[0]!.components.map(() => 'component' as const),
      'action',
      ...orderDesk.queries.map(() => 'query' as const),
    ])
    expect(changes.every((c) => c.op === 'added')).toBe(true)
    // labels: page title else id; component label/title else id; query name
    expect(changes.find((c) => c.id === 'status')?.label).toBe('Status')
    expect(changes.find((c) => c.id === 'orders')?.label).toBe('orders')
    expect(changes.find((c) => c.id === 'issue_refund' && c.kind === 'action')?.label).toBe('Issue refund')
  })

  test('added/changed in `to` order, then removed in `from` order', () => {
    const next = clone(orderDesk)
    const comps = next.pages[0]!.components
    comps.splice(comps.findIndex((c) => c.id === 'detail'), 1)
    comps.splice(comps.findIndex((c) => c.id === 'search'), 1)
    comps.push({ id: 'note', type: 'text', layout: { x: 0, y: 20, w: 12, h: 1 }, props: { title: { kind: 'value', value: 'Note' } } })
    comps.find((c) => c.id === 'openCount')!.layout.w = 6
    next.queries.find((q) => q.id === 'search_orders')!.timeoutMs = 20000
    next.queries.splice(next.queries.findIndex((q) => q.id === 'open_count'), 1)
    next.pages[0]!.title = 'Orders'
    expect(documentChanges(orderDesk, next)).toEqual([
      { kind: 'page', op: 'changed', id: orderDesk.pages[0]!.id, label: 'Orders' },
      { kind: 'component', op: 'changed', id: 'openCount', label: 'Open orders' },
      { kind: 'component', op: 'added', id: 'note', label: 'Note' },
      { kind: 'component', op: 'removed', id: 'search', label: 'search' },
      { kind: 'component', op: 'removed', id: 'detail', label: 'detail' },
      { kind: 'query', op: 'changed', id: 'search_orders', label: 'search_orders' },
      { kind: 'query', op: 'removed', id: 'open_count', label: 'open_count' },
    ])
  })

  test('an action change is an action change, not a component change', () => {
    const next = clone(orderDesk)
    next.pages[0]!.components.find((c) => c.id === 'orders')!.actions![0]!.label = 'Refund'
    expect(documentChanges(orderDesk, next)).toEqual([{ kind: 'action', op: 'changed', id: 'issue_refund', label: 'Refund' }])
  })

  test('semantic JSON: key order, undefined, null and omit-empty strings are not changes', () => {
    const next = clone(orderDesk)
    const orders = next.pages[0]!.components.find((c) => c.id === 'orders')!
    next.pages[0]!.components[next.pages[0]!.components.indexOf(orders)] = { props: orders.props, actions: orders.actions, layout: orders.layout, type: orders.type, id: orders.id, parentId: '' }
    next.queries[0] = { ...next.queries[0]!, http: undefined }
    expect(documentChanges(orderDesk, next)).toEqual([])
  })

  test('a page change does not include its components', () => {
    const next = clone(orderDesk)
    next.pages[0]!.components[0]!.layout.x = 1
    expect(documentChanges(orderDesk, next).map((c) => c.kind)).toEqual(['component'])
  })

  test('compareDocuments keeps only components and queries with both sides', () => {
    const next = clone(orderDesk)
    next.queries.find((q) => q.id === 'order_detail')!.rowLimit = 2
    next.pages[0]!.components.find((c) => c.id === 'orders')!.actions![0]!.label = 'Refund'
    const rows = compareDocuments(next, orderDesk)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toMatchObject({ kind: 'query', id: 'order_detail', op: 'changed' })
    if (row?.kind !== 'query') throw new Error('expected a query row')
    expect(row.left?.rowLimit).toBe(2)
    expect(row.right?.rowLimit).toBe(1)
  })
})

describe('releaseBadges', () => {
  const release = (number: number, restoredFrom: number | null, live = false): Release => ({
    id: `r${number}`,
    number,
    note: '',
    changes: [],
    publishedBy: { subject: 's', displayName: 'S' },
    publishedAt: '2026-10-01T00:00:00Z',
    restoredFrom,
    live,
  })

  test('releases between the restored one and the restore are rolled back', () => {
    const badges = releaseBadges([release(13, 11, true), release(12, null), release(11, null), release(10, null)])
    expect(badges.get(13)).toBe('live')
    expect(badges.get(12)).toBe('rolledBack')
    expect(badges.get(11)).toBeNull()
    expect(badges.get(10)).toBeNull()
  })

  test('live is never shown rolled back', () => {
    const badges = releaseBadges([release(4, 3, false), release(3, null), release(2, 1), release(5, 2, true)])
    expect(badges.get(5)).toBe('live')
    expect(badges.get(4)).toBe('rolledBack')
    expect(badges.get(3)).toBe('rolledBack')
  })
})
