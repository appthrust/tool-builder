import { describe, expect, test } from 'bun:test'
import { ORDER_DESK } from '../dev/mock-data'
import { componentRegistry } from '../renderer/registry'
import { COMPONENT_TYPES, type Component, type ComponentType, type Document, type Param, type Query, type Ref } from './document'
import { edgeKey, edgesAround, flowEdges, flowHints, type FlowEdge } from './flow'

const component = (id: string, type: ComponentType, props: Component['props'] = {}): Component => ({
  id,
  type,
  layout: { x: 0, y: 0, w: 4, h: 2 },
  props,
})
const query = (id: string, params: Param[] = []): Query => ({
  id,
  name: id,
  sourceId: 'ds',
  mode: 'read',
  sql: { text: 'select 1' },
  params,
  timeoutMs: 10000,
  rowLimit: 100,
})
const document = (components: Component[] = [], queries: Query[] = []): Document => ({
  schemaVersion: 1,
  pages: [{ id: 'main', title: '', components }],
  queries,
})
const bound = (name: string, ref: Ref): Param => ({ name, type: 'text', bind: { ref } })
const reader = (id: string, queryId: string) => component(id, 'table', { query: { kind: 'value', value: queryId } })
const search: Ref = { component: 'search', prop: 'value' }

const orderDeskEdges: FlowEdge[] = [
  { kind: 'param', from: search, to: 'orders', queryId: 'search_orders', param: 'search' },
  { kind: 'param', from: { component: 'status', prop: 'value' }, to: 'orders', queryId: 'search_orders', param: 'statuses' },
  { kind: 'form', from: { component: 'refundForm', prop: 'values' }, to: 'orders', actionId: 'issue_refund' },
  { kind: 'param', from: { component: 'orders', prop: 'selectedRow.number' }, to: 'detail', queryId: 'order_detail', param: 'number' },
]

describe('flowEdges', () => {
  test('collapses the order-desk queries and retains the form-to-action connection', () => {
    expect(flowEdges(ORDER_DESK)).toEqual(orderDeskEdges)
    // `status` is a select with fixed options: no query needed, so no hint.
    expect(flowHints(ORDER_DESK)).toEqual([])
  })

  test('fans a bound query out to every reader with a distinct stable key', () => {
    const doc = document([component('search', 'searchInput'), reader('orders', 'q'), reader('otherOrders', 'q')], [query('q', [bound('term', search)])])
    const edges = flowEdges(doc)
    expect(edges).toEqual([
      { kind: 'param', from: search, to: 'orders', queryId: 'q', param: 'term' },
      { kind: 'param', from: search, to: 'otherOrders', queryId: 'q', param: 'term' },
    ])
    expect(new Set(edges.map(edgeKey)).size).toBe(2)
    expect(flowEdges(structuredClone(doc)).map(edgeKey)).toEqual(edges.map(edgeKey))
  })

  test('includes nested components stored in the flat parentId hierarchy', () => {
    const doc = document(
      [
        component('outer', 'container'),
        { ...component('inner', 'container'), parentId: 'outer' },
        { ...component('search', 'searchInput'), parentId: 'inner' },
        { ...reader('orders', 'q'), parentId: 'inner' },
        { ...component('caption', 'text', { body: { kind: 'ref', ref: { component: 'orders', prop: 'selectedRow.number' } } }), parentId: 'outer' },
      ],
      [query('q', [bound('term', search)])]
    )
    expect(flowEdges(doc)).toEqual([
      { kind: 'param', from: search, to: 'orders', queryId: 'q', param: 'term' },
      { kind: 'prop', from: { component: 'orders', prop: 'selectedRow.number' }, to: 'caption', prop: 'body' },
    ])
    expect(flowHints(doc)).toEqual([])
  })

  test('orders by target and then source document order, not query or edge kind', () => {
    const first: Ref = { component: 'first', prop: 'values.amount' }
    const second: Ref = { component: 'second', prop: 'value' }
    const doc = document(
      [
        component('first', 'form'),
        component('second', 'searchInput'),
        {
          ...reader('target', 'laterQuery'),
          props: { query: { kind: 'value', value: 'laterQuery' }, caption: { kind: 'ref', ref: second } },
          actions: [{ id: 'submit', label: 'Submit', queryId: 'write', input: { formComponent: 'first' } }],
        },
        reader('laterTarget', 'firstQuery'),
      ],
      [query('firstQuery', [bound('term', second)]), query('laterQuery', [bound('second', second), bound('first', first)])]
    )
    expect(flowEdges(doc)).toEqual([
      { kind: 'param', from: first, to: 'target', queryId: 'laterQuery', param: 'first' },
      { kind: 'form', from: { component: 'first', prop: 'values' }, to: 'target', actionId: 'submit' },
      { kind: 'param', from: second, to: 'target', queryId: 'laterQuery', param: 'second' },
      { kind: 'prop', from: second, to: 'target', prop: 'caption' },
      { kind: 'param', from: second, to: 'laterTarget', queryId: 'firstQuery', param: 'term' },
    ])
  })

  test('skips dangling and non-exposed refs across all three connection kinds', () => {
    const missing: Ref = { component: 'missing', prop: 'value' }
    const hidden: Ref = { component: 'search', prop: 'label' }
    const unknownType: Ref = { component: 'unknown', prop: 'value' }
    const doc = document(
      [
        component('search', 'searchInput'),
        component('unknown', 'map' as ComponentType),
        {
          ...reader('orders', 'q'),
          props: {
            query: { kind: 'value', value: 'q' },
            missing: { kind: 'ref', ref: missing },
            hidden: { kind: 'ref', ref: hidden },
            unknownType: { kind: 'ref', ref: unknownType },
          },
          actions: [
            { id: 'missingForm', label: 'Missing', queryId: 'write', input: { formComponent: 'missing' } },
            { id: 'notForm', label: 'Not a form', queryId: 'write', input: { formComponent: 'search' } },
          ],
        },
      ],
      [query('q', [bound('missing', missing), bound('hidden', hidden), bound('unknownType', unknownType)])]
    )
    expect(flowEdges(doc)).toEqual([])
    expect(flowHints(doc)).toEqual([
      { componentId: 'search', kind: 'unconnectedInput' },
      { componentId: 'orders', kind: 'unconnectedInput' },
    ])
  })

  test('ignores literal parameters and query names that do not match a query id', () => {
    const q = { ...query('q', [{ name: 'term', type: 'text', bind: { literal: 'search.value' } }]), name: 'Display name' }
    const doc = document([component('search', 'searchInput'), reader('orders', 'q'), reader('other', 'Display name')], [q])
    expect(flowEdges(doc)).toEqual([])
  })

  test('is deterministic and leaves the document unchanged', () => {
    const doc = structuredClone(ORDER_DESK)
    const before = structuredClone(doc)
    expect(flowEdges(doc)).toEqual(flowEdges(doc))
    expect(flowHints(doc)).toEqual(flowHints(doc))
    expect(doc).toEqual(before)
  })

  test('accepts an empty document or a draft without a page', () => {
    expect(flowEdges(document())).toEqual([])
    expect(flowHints(document())).toEqual([])
    expect(flowEdges({ schemaVersion: 1, pages: [], queries: [] })).toEqual([])
    expect(flowHints({ schemaVersion: 1, pages: [], queries: [] })).toEqual([])
  })
})

describe('flowHints', () => {
  test('marks an unused input as unconnected', () => {
    expect(flowHints(document([component('search', 'searchInput')]))).toEqual([{ componentId: 'search', kind: 'unconnectedInput' }])
  })

  test('counts a raw query binding as connected even when the query has no reader', () => {
    const doc = document([component('search', 'searchInput')], [query('q', [bound('term', search)])])
    expect(flowEdges(doc)).toEqual([])
    expect(flowHints(doc)).toEqual([])
    expect(edgesAround(doc, 'search')).toEqual({ upstream: [], downstream: [] })
  })

  test('counts a form used only by an action input as connected', () => {
    const doc = document([
      component('form', 'form'),
      { ...component('submit', 'button'), actions: [{ id: 'save', label: 'Save', queryId: 'write', input: { formComponent: 'form' } }] },
    ])
    expect(flowEdges(doc)).toEqual([{ kind: 'form', from: { component: 'form', prop: 'values' }, to: 'submit', actionId: 'save' }])
    expect(flowHints(doc)).toEqual([])
  })

  test('counts direct prop references as connected without a query', () => {
    const doc = document([component('search', 'searchInput'), component('caption', 'text', { body: { kind: 'ref', ref: search } })])
    expect(flowEdges(doc)).toEqual([{ kind: 'prop', from: search, to: 'caption', prop: 'body' }])
    expect(flowHints(doc)).toEqual([])
  })

  test('incoming data does not make an exposing component an upstream source', () => {
    const doc = document([component('search', 'searchInput'), reader('orders', 'q')], [query('q', [bound('term', search)])])
    expect(flowHints(doc)).toEqual([{ componentId: 'orders', kind: 'unconnectedInput' }])
  })

  test('marks a table without a query as noData independently of its unused output', () => {
    expect(flowHints(document([component('orders', 'table')]))).toEqual([
      { componentId: 'orders', kind: 'unconnectedInput' },
      { componentId: 'orders', kind: 'noData' },
    ])
  })

  test('matches the registry types with query fields without importing the renderer into the model', () => {
    const doc = document(COMPONENT_TYPES.map((type) => component(type, type)))
    const actual = flowHints(doc).filter((hint) => hint.kind === 'noData').map((hint) => hint.componentId)
    const expected = COMPONENT_TYPES.filter((type) => componentRegistry[type].fields.some((field) => field.kind === 'query'))
    expect(actual).toEqual(expected)
  })

  test('uses dataQueryOf semantics rather than query existence for noData', () => {
    const doc = document([
      component('empty', 'detail', { query: { kind: 'value', value: '' } }),
      component('notString', 'chart', { query: { kind: 'value', value: 42 } }),
      component('ref', 'stat', { query: { kind: 'ref', ref: search } }),
      component('set', 'detail', { query: { kind: 'value', value: 'unknownQuery' } }),
      component('text', 'text'),
    ])
    expect(flowHints(doc)).toEqual([
      { componentId: 'empty', kind: 'noData' },
      { componentId: 'notString', kind: 'noData' },
      { componentId: 'ref', kind: 'noData' },
    ])
  })
})

describe('edgesAround', () => {
  test('returns incoming and outgoing edges in flow order', () => {
    const doc = structuredClone(ORDER_DESK)
    doc.pages[0]!.components.push(component('caption', 'text', { body: { kind: 'ref', ref: { component: 'orders', prop: 'selectedRow.customer' } } }))
    expect(edgesAround(doc, 'orders')).toEqual({
      upstream: orderDeskEdges.slice(0, 3),
      downstream: [orderDeskEdges[3], { kind: 'prop', from: { component: 'orders', prop: 'selectedRow.customer' }, to: 'caption', prop: 'body' }],
    })
    expect(edgesAround(doc, 'refundForm')).toEqual({ upstream: [], downstream: [orderDeskEdges[2]] })
    expect(edgesAround(doc, 'openCount')).toEqual({ upstream: [], downstream: [] })
    expect(edgesAround(doc, 'missing')).toEqual({ upstream: [], downstream: [] })
  })
})

describe('edgeKey', () => {
  test('distinguishes every connection fact including multiple params, paths and actions', () => {
    const edges: FlowEdge[] = [
      { kind: 'param', from: search, to: 'target', queryId: 'q', param: 'term' },
      { kind: 'param', from: search, to: 'target', queryId: 'q', param: 'other' },
      { kind: 'param', from: search, to: 'target', queryId: 'other', param: 'term' },
      { kind: 'prop', from: search, to: 'target', prop: 'body' },
      { kind: 'prop', from: search, to: 'target', prop: 'heading' },
      { kind: 'prop', from: { component: 'orders', prop: 'selectedRow.id' }, to: 'target', prop: 'body' },
      { kind: 'prop', from: { component: 'orders', prop: 'selectedRow.name' }, to: 'target', prop: 'body' },
      { kind: 'form', from: { component: 'form', prop: 'values' }, to: 'target', actionId: 'save' },
      { kind: 'form', from: { component: 'form', prop: 'values' }, to: 'target', actionId: 'send' },
    ]
    expect(new Set(edges.map(edgeKey)).size).toBe(edges.length)
    expect(structuredClone(edges).map(edgeKey)).toEqual(edges.map(edgeKey))
  })
})
