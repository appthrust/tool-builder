import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { QueryResult } from '../api/types'
import { createToolRuntime, dependencyGraph, initialBindings, readRef, resolveInputs, TEXT_INPUT_DEBOUNCE_MS, type Timers } from './bindings'
import type { Document } from './document'

const orderDesk = JSON.parse(
  readFileSync(join(import.meta.dir, '../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json'), 'utf8')
) as Document

const query = (id: string) => orderDesk.queries.find((candidate) => candidate.id === id)!

/** Manual clock: `advance(ms)` fires due timers in order. */
function manualTimers() {
  let clock = 0
  let timers: { at: number; fn: () => void; cancelled: boolean }[] = []
  const api: Timers = {
    set: (fn, ms) => {
      const timer = { at: clock + ms, fn, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  }
  return {
    timers: api,
    advance(ms: number) {
      clock += ms
      const due = timers.filter((timer) => !timer.cancelled && timer.at <= clock).sort((a, b) => a.at - b.at)
      timers = timers.filter((timer) => !due.includes(timer) && !timer.cancelled)
      for (const timer of due) timer.fn()
    },
  }
}

const result = (rows: unknown[][]): QueryResult => ({ columns: [{ name: 'number', type: 'text' }], rows, rowCount: rows.length, truncated: false, durationMs: 3 })

function recordingRunner() {
  const calls: { queryId: string; inputs: Record<string, unknown> }[] = []
  const resolvers: (() => void)[] = []
  return {
    calls,
    run: (queryId: string, inputs: Record<string, unknown>) => {
      calls.push({ queryId, inputs })
      return new Promise<QueryResult>((resolve) => resolvers.push(() => resolve(result([[queryId]]))))
    },
    flush: async () => {
      for (const resolve of resolvers.splice(0)) resolve()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

describe('resolveInputs', () => {
  test('initial bindings make search ready and the detail wait for a row', () => {
    const state = initialBindings(orderDesk)
    expect(state.search).toEqual({ value: '' })
    expect(state.status).toEqual({ value: [] })
    expect(state.refundForm).toEqual({ values: { amount: null, reason: null } })
    expect(state.orders).toBeUndefined()
    expect(resolveInputs(query('search_orders'), state)).toEqual({ inputs: { search: '', statuses: [] }, ready: true, missing: [] })
    expect(resolveInputs(query('order_detail'), state)).toEqual({ inputs: {}, ready: false, missing: ['number'] })
  })

  test('path refs walk into the selected row; null is a value', () => {
    const state = { orders: { selectedRow: { number: 'A-1', total: '10.00' } }, refundForm: { values: { amount: 5, reason: null } } }
    expect(readRef(state, { component: 'orders', prop: 'selectedRow.number' })).toBe('A-1')
    expect(readRef(state, { component: 'orders', prop: 'selectedRow.missing' })).toBeUndefined()
    expect(resolveInputs(query('issue_refund'), state)).toEqual({ inputs: { number: 'A-1', amount: 5, reason: null }, ready: true, missing: [] })
  })

  test('literal binds pass through', () => {
    const q = { ...query('order_detail'), params: [{ name: 'number', type: 'text' as const, bind: { literal: 'X' } }] }
    expect(resolveInputs(q, {})).toEqual({ inputs: { number: 'X' }, ready: true, missing: [] })
  })

  test('dependency graph maps prop heads to queries', () => {
    const graph = dependencyGraph(orderDesk)
    expect(graph.get('search.value')).toEqual(['search_orders'])
    expect(graph.get('status.value')).toEqual(['search_orders'])
    expect(graph.get('orders.selectedRow')).toEqual(['order_detail', 'issue_refund'])
    expect(graph.get('refundForm.values')).toEqual(['issue_refund'])
  })
})

describe('scheduler', () => {
  test('activation runs once; waiting until a ref resolves', async () => {
    const clock = manualTimers()
    const runner = recordingRunner()
    const runtime = createToolRuntime({ document: orderDesk, run: runner.run, timers: clock.timers })
    runtime.activate('search_orders')
    const release = runtime.activate('search_orders')
    runtime.activate('order_detail')
    expect(runner.calls.map((call) => call.queryId)).toEqual(['search_orders'])
    expect(runtime.queries.state.order_detail).toMatchObject({ status: 'waiting', missing: ['number'] })
    expect(runtime.queries.state.search_orders).toMatchObject({ status: 'loading', refetching: true })
    await runner.flush()
    expect(runtime.queries.state.search_orders).toMatchObject({ status: 'success', refetching: false })
    release()

    // A row selection re-runs the detail immediately.
    runtime.setExposed('orders', 'selectedRow', { number: 'A-7' })
    expect(runner.calls.at(-1)).toEqual({ queryId: 'order_detail', inputs: { number: 'A-7' } })
    // Same value again: nothing runs.
    runtime.setExposed('orders', 'selectedRow', { number: 'A-7' })
    expect(runner.calls).toHaveLength(2)
    runtime.dispose()
  })

  test('text inputs debounce 250 ms; selects run immediately', async () => {
    const clock = manualTimers()
    const runner = recordingRunner()
    const runtime = createToolRuntime({ document: orderDesk, run: runner.run, timers: clock.timers })
    runtime.activate('search_orders')
    await runner.flush()
    runtime.setExposed('search', 'value', 'A')
    clock.advance(100)
    runtime.setExposed('search', 'value', 'A-')
    clock.advance(TEXT_INPUT_DEBOUNCE_MS - 1)
    expect(runner.calls).toHaveLength(1)
    clock.advance(1)
    expect(runner.calls).toHaveLength(2)
    expect(runner.calls[1]!.inputs).toEqual({ search: 'A-', statuses: [] })

    runtime.setExposed('status', 'value', ['open'])
    expect(runner.calls).toHaveLength(3)
    expect(runner.calls[2]!.inputs).toEqual({ search: 'A-', statuses: ['open'] })
    runtime.dispose()
  })

  test('stale responses are dropped; the previous result stays while refetching', async () => {
    let resolveFirst: (value: QueryResult) => void = () => {}
    let resolveSecond: (value: QueryResult) => void = () => {}
    let n = 0
    const runtime = createToolRuntime({
      document: orderDesk,
      run: () =>
        new Promise<QueryResult>((resolve) => {
          n++
          if (n === 1) resolveFirst = resolve
          else resolveSecond = resolve
        }),
    })
    runtime.activate('order_detail')
    runtime.setExposed('orders', 'selectedRow', { number: 'A-1' })
    runtime.setExposed('orders', 'selectedRow', { number: 'A-2' })
    resolveSecond(result([['A-2']]))
    await Promise.resolve()
    resolveFirst(result([['A-1']]))
    await Promise.resolve()
    expect(runtime.queries.state.order_detail!.result!.rows).toEqual([['A-2']])
    runtime.dispose()
  })

  test('inactive queries go stale and run on activation; refresh re-runs active ones', async () => {
    const runner = recordingRunner()
    const runtime = createToolRuntime({ document: orderDesk, run: runner.run, timers: manualTimers().timers })
    runtime.setExposed('orders', 'selectedRow', { number: 'A-3' })
    expect(runner.calls).toHaveLength(0)
    const release = runtime.activate('order_detail')
    expect(runner.calls).toEqual([{ queryId: 'order_detail', inputs: { number: 'A-3' } }])
    await runner.flush()
    runtime.refresh(['order_detail', 'search_orders'])
    expect(runner.calls.map((call) => call.queryId)).toEqual(['order_detail', 'order_detail'])
    await runner.flush()
    release()
    runtime.activate('search_orders')
    expect(runner.calls.map((call) => call.queryId)).toEqual(['order_detail', 'order_detail', 'search_orders'])
    runtime.dispose()
  })

  test('an answer for obsolete inputs does not land during the debounce', async () => {
    const clock = manualTimers()
    const runner = recordingRunner()
    const runtime = createToolRuntime({ document: orderDesk, run: runner.run, timers: clock.timers })
    runtime.activate('search_orders')
    expect(runner.calls).toHaveLength(1)
    // Typing starts while the first run is still in flight.
    runtime.setExposed('search', 'value', 'A')
    clock.advance(100)
    await runner.flush()
    expect(runtime.queries.state.search_orders).toMatchObject({ status: 'loading', refetching: true })
    expect(runtime.queries.state.search_orders!.result).toBeUndefined()
    clock.advance(TEXT_INPUT_DEBOUNCE_MS)
    expect(runner.calls).toHaveLength(2)
    expect(runner.calls[1]!.inputs).toEqual({ search: 'A', statuses: [] })
    await runner.flush()
    expect(runtime.queries.state.search_orders).toMatchObject({ status: 'success', refetching: false })
    runtime.dispose()
  })

  test('releasing the last viewer cancels a debounced run; the next activation runs it', async () => {
    const clock = manualTimers()
    const runner = recordingRunner()
    const runtime = createToolRuntime({ document: orderDesk, run: runner.run, timers: clock.timers })
    const release = runtime.activate('search_orders')
    await runner.flush()
    runtime.setExposed('search', 'value', 'B')
    release()
    clock.advance(TEXT_INPUT_DEBOUNCE_MS * 2)
    expect(runner.calls).toHaveLength(1)
    runtime.activate('search_orders')
    expect(runner.calls).toHaveLength(2)
    expect(runner.calls[1]!.inputs).toEqual({ search: 'B', statuses: [] })
    runtime.dispose()
  })

  test('errors keep the last result', async () => {
    let fail = false
    const runtime = createToolRuntime({
      document: orderDesk,
      run: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve(result([['ok']]))),
    })
    runtime.activate('search_orders')
    await Promise.resolve()
    await Promise.resolve()
    fail = true
    runtime.refresh(['search_orders'])
    await Promise.resolve()
    await Promise.resolve()
    expect(runtime.queries.state.search_orders).toMatchObject({ status: 'error', result: { rows: [['ok']] } })
    runtime.dispose()
  })

  test('setDocument re-runs changed queries and keeps user state', async () => {
    const clock = manualTimers()
    const runner = recordingRunner()
    const runtime = createToolRuntime({ document: orderDesk, run: runner.run, timers: clock.timers })
    runtime.activate('search_orders')
    await runner.flush()
    runtime.setExposed('search', 'value', 'B')
    clock.advance(TEXT_INPUT_DEBOUNCE_MS)
    await runner.flush()
    const edited: Document = {
      ...orderDesk,
      queries: orderDesk.queries.map((q) => (q.id === 'search_orders' ? { ...q, rowLimit: 100 } : q)),
    }
    runtime.setDocument(edited)
    clock.advance(TEXT_INPUT_DEBOUNCE_MS)
    expect(runner.calls).toHaveLength(3)
    expect(runner.calls[2]!.inputs).toEqual({ search: 'B', statuses: [] })
    expect(runtime.bindings.state.search).toEqual({ value: 'B' })
    runtime.dispose()
  })
})
