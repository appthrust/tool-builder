import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyDocument, type Component, type Document, type Query } from '../../../model/document'
import { newComponent } from '../../../renderer/registry'
import { connectOptions, placeholderName } from './connect-options'

const orderDesk = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json'), 'utf8')
) as Document

function docOf(components: Component[], queries: Query[] = []): Document {
  const doc = emptyDocument()
  return { ...doc, pages: [{ ...doc.pages[0]!, components }], queries }
}

const httpQuery: Query = {
  id: 'customer',
  name: 'customer',
  sourceId: 'crm',
  mode: 'read',
  http: { method: 'GET', path: '/customers/{{ id }}' },
  params: [{ name: 'id', type: 'text', bind: { literal: null } }],
  timeoutMs: 10_000,
  rowLimit: 500,
}

const withQuery = (component: Component, queryId: string): Component => ({ ...component, props: { ...component.props, query: { kind: 'value', value: queryId } } })

describe('connectOptions', () => {
  test('order desk: search into orders lists search_orders params, the filter, then the placeholder', () => {
    expect(connectOptions(orderDesk, { from: { component: 'search', prop: 'value' }, targetId: 'orders' })).toEqual([
      { kind: 'param', queryId: 'search_orders', queryName: 'search_orders', param: orderDesk.queries[1]!.params[0]!, boundTo: { component: 'search', prop: 'value' } },
      { kind: 'param', queryId: 'search_orders', queryName: 'search_orders', param: orderDesk.queries[1]!.params[1]!, boundTo: { component: 'status', prop: 'value' } },
      { kind: 'filter', queryId: 'search_orders', queryName: 'search_orders' },
      // `search` is already a parameter of the query, so the suggestion does not reuse it.
      { kind: 'placeholder', queryId: 'search_orders', queryName: 'search_orders', suggestedName: 'search_2' },
    ])
  })

  test('order desk: a table row into the detail', () => {
    const options = connectOptions(orderDesk, { from: { component: 'orders', prop: 'selectedRow' }, targetId: 'detail' })
    expect(options.map((option) => option.kind)).toEqual(['param', 'filter', 'placeholder'])
    expect(options[2]).toEqual({ kind: 'placeholder', queryId: 'order_detail', queryName: 'order_detail', suggestedName: 'orders' })
  })

  test('order desk: targets that take nothing, and the source itself', () => {
    expect(connectOptions(orderDesk, { from: { component: 'search', prop: 'value' }, targetId: 'refundForm' })).toEqual([])
    expect(connectOptions(orderDesk, { from: { component: 'search', prop: 'value' }, targetId: 'search' })).toEqual([])
    expect(connectOptions(orderDesk, { from: { component: 'search', prop: 'value' }, targetId: 'gone' })).toEqual([])
  })

  test('order desk: a select whose options query is not chosen', () => {
    expect(connectOptions(orderDesk, { from: { component: 'search', prop: 'value' }, targetId: 'status' })).toEqual([{ kind: 'noQuery' }])
  })

  test('refable props of the target', () => {
    const doc = docOf([newComponent('searchInput', 'search'), newComponent('text', 'text1')])
    expect(connectOptions(doc, { from: { component: 'search', prop: 'value' }, targetId: 'text1' })).toEqual([
      { kind: 'prop', prop: 'heading', label: 'toolBuilder.renderer.field.heading' },
      { kind: 'prop', prop: 'body', label: 'toolBuilder.renderer.field.body' },
    ])
  })

  test('a stat without a query: noQuery first, then its refable delta', () => {
    const doc = docOf([newComponent('searchInput', 'search'), newComponent('stat', 'stat1')])
    expect(connectOptions(doc, { from: { component: 'search', prop: 'value' }, targetId: 'stat1' })).toEqual([
      { kind: 'noQuery' },
      { kind: 'prop', prop: 'delta', label: 'toolBuilder.renderer.field.delta' },
    ])
  })

  test('an HTTP query gets params and the placeholder but no filter; an unbound param has no boundTo', () => {
    const doc = docOf([newComponent('date', 'from'), withQuery(newComponent('detail', 'detail1'), 'customer')], [httpQuery])
    expect(connectOptions(doc, { from: { component: 'from', prop: 'value' }, targetId: 'detail1' })).toEqual([
      { kind: 'param', queryId: 'customer', queryName: 'customer', param: httpQuery.params[0]! },
      { kind: 'placeholder', queryId: 'customer', queryName: 'customer', suggestedName: 'from' },
    ])
  })

  test('a query id that names no query offers neither params nor noQuery', () => {
    const doc = docOf([newComponent('searchInput', 'search'), withQuery(newComponent('stat', 'stat1'), 'missing')])
    expect(connectOptions(doc, { from: { component: 'search', prop: 'value' }, targetId: 'stat1' })).toEqual([
      { kind: 'prop', prop: 'delta', label: 'toolBuilder.renderer.field.delta' },
    ])
  })
})

describe('placeholderName', () => {
  test('sanitizes to an identifier and avoids taken names', () => {
    expect(placeholderName('search', new Set())).toBe('search')
    expect(placeholderName('search', new Set(['search', 'search_2']))).toBe('search_3')
    expect(placeholderName('my-input', new Set())).toBe('my_input')
    expect(placeholderName('1st', new Set())).toBe('_1st')
  })
})
