import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { QueryResult } from '../api/types'
import { I18nProvider } from '../i18n'
import { createToolRuntime, type ToolRuntime } from '../model/bindings'
import { COMPONENT_TYPES, emptyDocument, type Component, type Document } from '../model/document'
import { validateDocument } from '../model/document.schema'
import { ChartRuntime, DetailRuntime, StatRuntime } from './components/data'
import { SearchInputRuntime, SelectRuntime } from './components/inputs'
import { ButtonRuntime, FormRuntime, TabsRuntime, TextRuntime } from './components/layout'
import { TABLE_PAGE_SIZE, TableRuntime } from './components/table'
import { badgeTone, formatValue } from './format'
import { cellRect, childrenOf, gridHeight, gridRows, readingOrder, tabOf, withTab } from './grid'
import { componentRegistry, newComponent, nextComponentId, PALETTE } from './registry'
import { ToolRuntimeProvider } from './runtime-context'

const orderDesk = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json'), 'utf8')
) as Document
const component = (id: string) => orderDesk.pages[0]!.components.find((candidate) => candidate.id === id)!

const ORDERS: QueryResult = {
  columns: [
    { name: 'number', type: 'text' },
    { name: 'customer', type: 'text' },
    { name: 'total', type: 'numeric' },
    { name: 'status', type: 'text' },
  ],
  rows: Array.from({ length: 30 }, (_, i) => [`ORD-${20400 + i}`, `Customer ${i}`, `${100 + i}.50`, i % 2 ? 'open' : 'shipped']),
  rowCount: 30,
  truncated: true,
  durationMs: 12,
}
const RESULTS: Record<string, QueryResult> = {
  search_orders: ORDERS,
  order_detail: { columns: ORDERS.columns, rows: [ORDERS.rows[3]!], rowCount: 1, truncated: false, durationMs: 4 },
  open_count: { columns: [{ name: 'count', type: 'int8' }], rows: [['128']], rowCount: 1, truncated: false, durationMs: 2 },
}

/** A runtime whose activated queries have already resolved (static render has no effects). */
async function settledRuntime(document: Document, activate: string[], setup?: (runtime: ToolRuntime) => void): Promise<ToolRuntime> {
  const runtime = createToolRuntime({ document, run: async (queryId) => RESULTS[queryId] ?? { columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 1 } })
  setup?.(runtime)
  for (const id of activate) runtime.activate(id)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return runtime
}

const render = (runtime: ToolRuntime, node: ReactElement, document: Document = orderDesk, actions: 'enabled' | 'disabled' = 'enabled') =>
  renderToStaticMarkup(
    <I18nProvider language="en">
      <ToolRuntimeProvider slug="order-desk" document={document} source="live" runtime={runtime} actions={actions}>
        {node}
      </ToolRuntimeProvider>
    </I18nProvider>
  )

describe('grid', () => {
  test('cell geometry: 12 columns, 40px rows, 8px gaps', () => {
    // 1192 = 12 * 92 + 11 * 8
    expect(cellRect({ x: 0, y: 0, w: 1, h: 1 }, 1192)).toEqual({ left: 0, top: 0, width: 92, height: 40 })
    expect(cellRect({ x: 8, y: 3, w: 4, h: 5 }, 1192)).toEqual({ left: 800, top: 144, width: 392, height: 232 })
    expect(gridHeight(0)).toBe(0)
    expect(gridRows([newComponent('stat', 'a', { x: 0, y: 3, w: 2, h: 2 }), newComponent('table', 'b', { x: 2, y: 0, w: 6, h: 4 })])).toBe(5)
    expect(gridRows([], 2)).toBe(2)
  })

  test('reading order and children', () => {
    expect(readingOrder(orderDesk.pages[0]!.components).map((c) => c.id)).toEqual(['search', 'status', 'openCount', 'orders', 'detail', 'refundForm'])
    expect(childrenOf(orderDesk.pages[0]!.components).length).toBe(6)
    const tabs = newComponent('tabs', 'tabs1')
    const child: Component = { ...newComponent('text', 'text1'), parentId: 'tabs1' }
    expect(tabOf(child, tabs)).toBe('tab1')
    expect(tabOf(withTab(child, 'tab2'), tabs)).toBe('tab2')
    expect(tabOf(withTab(child, 'gone'), tabs)).toBe('tab1')
  })
})

describe('registry', () => {
  test('covers all 13 types; palette lists each once', () => {
    expect(Object.keys(componentRegistry).sort()).toEqual([...COMPONENT_TYPES].sort())
    expect(PALETTE.flatMap((group) => group.types).sort()).toEqual([...COMPONENT_TYPES].sort())
  })

  test('a fresh component of every type is a valid document; defaults satisfy the props schema', () => {
    const document = emptyDocument()
    let y = 0
    for (const type of COMPONENT_TYPES) {
      const id = nextComponentId(document, type)
      const fresh = newComponent(type, id, { x: 0, y, w: componentRegistry[type].defaultSize.w, h: componentRegistry[type].defaultSize.h })
      y += fresh.layout.h
      document.pages[0]!.components.push(fresh)
      const values = Object.fromEntries(Object.entries(fresh.props).map(([name, prop]) => [name, prop.kind === 'value' ? prop.value : undefined]))
      expect(componentRegistry[type].propsSchema.safeParse(values).success).toBe(true)
      for (const field of componentRegistry[type].fields) expect(Object.keys(componentRegistry[type].propsSchema.shape)).toContain(field.name)
    }
    expect(validateDocument(document)).toEqual([])
    expect(nextComponentId(document, 'table')).toBe('table2')
  })
})

describe('format', () => {
  test('values by format', () => {
    expect(formatValue('1240', 'money', 'en')).toBe('1,240.00')
    expect(formatValue(null, 'money', 'en')).toBe('—')
    expect(formatValue('12345', 'number', 'ja')).toBe('12,345')
    expect(formatValue('2026-10-02T11:31:00Z', 'date', 'en')).toContain('2026')
    expect(formatValue({ a: 1 }, undefined, 'en')).toBe('{"a":1}')
    expect(badgeTone('Delivered')).toBe('green')
    expect(badgeTone('Refund requested')).toBe('amber')
    expect(badgeTone('Delayed')).toBe('rose')
    expect(badgeTone('anything')).toBe(badgeTone('anything'))
  })
})

describe('runtime components', () => {
  test('table: formatted columns, first page of 25, truncation and range', async () => {
    const runtime = await settledRuntime(orderDesk, ['search_orders'])
    const html = render(runtime, <TableRuntime component={component('orders')} />)
    expect(html).toContain('>Order<')
    expect(html).toContain('ORD-20400')
    expect(html).toContain('100.50')
    expect(html).not.toContain(`ORD-${20400 + TABLE_PAGE_SIZE}`)
    expect(html).toContain('Showing 1–25 of 30')
    expect(html).toContain('Page 1 of 2')
    expect(html).toContain('Showing the first 30 rows')
    expect(html).toContain('aria-label="Actions for ORD-20400"')
  })

  test('table selection is marked; detail waits for a row, then shows label/value pairs', async () => {
    const waiting = await settledRuntime(orderDesk, ['order_detail'])
    expect(render(waiting, <DetailRuntime component={component('detail')} />)).toContain('Select a row to see its details.')
    const selected = await settledRuntime(orderDesk, ['search_orders', 'order_detail'], (runtime) =>
      runtime.setExposed('orders', 'selectedRow', { number: 'ORD-20403', customer: 'Customer 3', total: '103.50', status: 'open' })
    )
    expect(render(selected, <TableRuntime component={component('orders')} />)).toContain('aria-selected="true"')
    const detail = render(selected, <DetailRuntime component={component('detail')} />)
    expect(detail).toContain('<dt')
    expect(detail).toContain('Customer 3')
  })

  test('stat, search, select, form', async () => {
    const runtime = await settledRuntime(orderDesk, ['open_count'], (r) => {
      r.setExposed('search', 'value', 'ORD-2')
      r.setExposed('status', 'value', ['open'])
    })
    expect(render(runtime, <StatRuntime component={component('openCount')} />)).toContain('128')
    const search = render(runtime, <SearchInputRuntime component={component('search')} />)
    expect(search).toContain('value="ORD-2"')
    expect(search).toContain('placeholder="Search order number or email"')
    expect(render(runtime, <SelectRuntime component={component('status')} />)).toContain('Open')
    const form = render(runtime, <FormRuntime component={component('refundForm')} />)
    expect(form).toContain('Amount')
    expect(form).toContain('Reason')
  })

  test('editor canvas: actions render inert', async () => {
    const button: Component = { ...newComponent('button', 'button1'), actions: [{ id: 'issue_refund', label: 'Issue refund', queryId: 'issue_refund' }] }
    const document: Document = { ...orderDesk, pages: [{ ...orderDesk.pages[0]!, components: [...orderDesk.pages[0]!.components, button] }] }
    const runtime = await settledRuntime(document, [])
    const html = render(runtime, <ButtonRuntime component={button} />, document, 'disabled')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Actions do not run in the editor')
  })

  test('text, tabs and chart states', async () => {
    const runtime = await settledRuntime(orderDesk, [])
    const text: Component = { ...newComponent('text', 'text1'), props: { heading: { kind: 'value', value: 'Order desk' }, body: { kind: 'value', value: 'Look up orders.' } } }
    expect(render(runtime, <TextRuntime component={text} />)).toContain('Order desk')
    const tabs: Component = { ...newComponent('tabs', 'tabs1'), props: { tabs: { kind: 'value', value: [{ id: 'a', label: 'Open' }, { id: 'b', label: 'Closed' }] } } }
    const tabsHtml = render(runtime, <TabsRuntime component={tabs} />)
    expect(tabsHtml).toContain('role="tablist"')
    expect(tabsHtml).toContain('Closed')
    expect(render(runtime, <ChartRuntime component={newComponent('chart', 'chart1')} />)).toContain('Choose the horizontal axis and value columns.')
  })
})
