import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../../../i18n'
import type { Component, Document, Ref } from '../../../model/document'
import { connectOptions, type ConnectRequest } from './connect-options'
import { ConnectOptionList, filterParamType, initialFilter, optionKey, placeholderHref } from './connect-sheet'

const orderDesk = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json'), 'utf8')
) as Document

function render(request: ConnectRequest, filterFields?: ReactNode, sourceRef: Ref = request.from) {
  const options = connectOptions(orderDesk, request)
  return renderToStaticMarkup(
    <I18nProvider language="en">
      <ConnectOptionList
        name="connect"
        doc={orderDesk}
        request={request}
        sourceRef={sourceRef}
        options={options}
        value={options[0] ? optionKey(options[0]) : undefined}
        onChange={() => undefined}
        filterFields={filterFields}
      />
    </I18nProvider>
  )
}

const optionOrder = (html: string) => [...html.matchAll(/data-option="([^"]+)"/g)].map((match) => match[1])

describe('ConnectOptionList', () => {
  test('search into orders: search_orders params first, then the filter, the placeholder last', () => {
    const html = render({ from: { component: 'search', prop: 'value' }, targetId: 'orders' })
    expect(optionOrder(html)).toEqual(['param:search_orders:search', 'param:search_orders:statuses', 'filter:search_orders', 'placeholder:search_orders'])
    expect(html).toContain('Parameters of query search_orders')
    expect(html).toContain('Already receives this value')
    expect(html).toContain('Now status.value. Connecting replaces the current binding.')
    expect(html).toContain('Filter the rows of search_orders by this value')
    expect(html).toContain('Insert {{ search_2 }} into search_orders')
  })

  test('the filter fields render under the filter row only while it is selected', () => {
    const request: ConnectRequest = { from: { component: 'search', prop: 'value' }, targetId: 'orders' }
    const options = connectOptions(orderDesk, request)
    const markup = (value: string) =>
      renderToStaticMarkup(
        <I18nProvider language="en">
          <ConnectOptionList name="connect" doc={orderDesk} request={request} sourceRef={request.from} options={options} value={value} onChange={() => undefined} filterFields={<p id="filter-fields" />} />
        </I18nProvider>
      )
    expect(markup('filter:search_orders')).toContain('filter-fields')
    expect(markup('param:search_orders:search')).not.toContain('filter-fields')
    // A stat reading a read SQL query offers the filter before its refable prop.
    expect(optionOrder(render({ from: { component: 'search', prop: 'value' }, targetId: 'openCount' }))).toEqual(['filter:open_count', 'prop:delta', 'placeholder:open_count'])
  })

  test('filter param type and first operator follow the source', () => {
    const select = (multiple: boolean): Component => ({ id: 's', type: 'select', layout: { x: 0, y: 0, w: 1, h: 1 }, props: { multiple: { kind: 'value', value: multiple } } })
    expect(filterParamType(select(true), 'value')).toBe('textList')
    expect(filterParamType(select(false), 'value')).toBe('text')
    expect(filterParamType({ id: 'd', type: 'date', layout: { x: 0, y: 0, w: 1, h: 1 }, props: {} }, 'value')).toBe('date')
    expect(filterParamType(undefined, 'value')).toBe('text')
    expect(initialFilter('textList').op).toBe('in')
    expect(initialFilter('text').op).toBe('contains')
    expect(initialFilter('date').op).toBe('eq')
  })

  test('a target that takes nothing, and one without a query', () => {
    expect(render({ from: { component: 'search', prop: 'value' }, targetId: 'refundForm' })).toContain('refundForm has nothing that can take a value from search.')
    const html = render({ from: { component: 'search', prop: 'value' }, targetId: 'status' })
    expect(html).toContain('status has no query yet.')
    expect(optionOrder(html)).toEqual([])
  })

  test('placeholder handoff URL', () => {
    expect(placeholderHref('order-desk', 'search_orders', 'search_2')).toBe('/edit/order-desk/queries/search_orders?insert=search_2')
  })
})
