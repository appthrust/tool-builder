import { describe, expect, test } from 'bun:test'
import { emptyDocument, FILTER_OPS, PARAM_TYPES, type Document, type Filter, type Query } from '../../../model/document'
import { validateDocument } from '../../../model/document.schema'
import { documentChanges } from '../releases/changes'
import { addFilter, effectiveSql, filterAcceptsType, filterParamNames, removeFilter, updateFilter } from './filter-ops'
import { PLACEHOLDER_NAME } from './placeholders'
import { updateQuery } from './query-ops'

const query = (over: Partial<Query> = {}): Query => ({ id: 'q', name: 'q', sourceId: 'ds', mode: 'read', sql: { text: 'select * from orders' }, params: [], timeoutMs: 10000, rowLimit: 500, ...over })
const document = (over: Partial<Query> = {}): Document => ({ ...emptyDocument(), queries: [query(over)] })
const filter: Filter = { column: 'status', op: 'eq', param: 'status', skipWhenEmpty: true }

function withStatus(): Document {
  return addFilter(document(), 'q', { column: 'status', op: 'eq', type: 'text', skipWhenEmpty: true })
}

describe('filter operations', () => {
  test('adds a filter and null-bound parameter without editing SQL', () => {
    const doc = document()
    const next = addFilter(doc, 'q', { column: 'status', op: 'eq', type: 'text', skipWhenEmpty: true })
    expect(doc.queries[0]!.params).toEqual([])
    expect(next.queries[0]!.params).toEqual([{ name: 'status', type: 'text', bind: { literal: null } }])
    expect(next.queries[0]!.filters).toEqual([filter])
    expect(next.queries[0]!.sql).toBe(doc.queries[0]!.sql)
    expect(validateDocument(next)).toEqual([])
  })

  test('sanitizes column names and deduplicates existing parameters', () => {
    let doc = withStatus()
    for (const column of ['status', 'order total', '2026', '日本語']) {
      doc = addFilter(doc, 'q', { column, op: 'eq', type: 'text', skipWhenEmpty: false })
    }
    expect(doc.queries[0]!.params.map((param) => param.name)).toEqual(['status', 'status_2', 'order_total', '_2026', '___'])
    for (const param of doc.queries[0]!.params) expect(PLACEHOLDER_NAME.test(param.name)).toBe(true)
  })

  test('reuses an existing param including its type, bind and order', () => {
    const doc = withStatus()
    const next = addFilter(doc, 'q', { column: 'other_status', op: 'neq', type: 'text', param: 'status', skipWhenEmpty: false })
    expect(next.queries[0]!.params).toBe(doc.queries[0]!.params)
    expect(filterParamNames(next.queries[0]!)).toEqual(['status'])
    expect(validateDocument(next)).toEqual([])
  })

  test('updates a filter without rewriting SQL and detects a query change', () => {
    const doc = withStatus()
    const next = updateFilter(doc, 'q', 0, { column: 'state', op: 'contains', skipWhenEmpty: false })
    expect(next.queries[0]!.filters).toEqual([{ ...filter, column: 'state', op: 'contains', skipWhenEmpty: false }])
    expect(next.queries[0]!.params).toBe(doc.queries[0]!.params)
    expect(documentChanges(doc, next)).toEqual([{ kind: 'query', id: 'q', label: 'q', op: 'changed' }])
  })

  test('removes a param only when its last filter and placeholder use are gone', () => {
    const doc = addFilter(withStatus(), 'q', { column: 'state', op: 'eq', type: 'text', param: 'status', skipWhenEmpty: true })
    const one = removeFilter(doc, 'q', 0)
    expect(one.queries[0]!.params).toHaveLength(1)
    const none = removeFilter(one, 'q', 0)
    expect(none.queries[0]!.params).toEqual([])
    expect(none.queries[0]!.filters).toBeUndefined()
    const both = updateQuery(one, 'q', (q) => ({ ...q, sql: { text: 'select {{status}}' } }))
    expect(removeFilter(both, 'q', 0).queries[0]!.params).toHaveLength(1)
  })

  test('retargeting a filter removes its orphaned old parameter', () => {
    const doc = addFilter(withStatus(), 'q', { column: 'state', op: 'eq', type: 'text', skipWhenEmpty: true })
    const next = updateFilter(doc, 'q', 0, { param: 'state' })
    expect(next.queries[0]!.params.map((p) => p.name)).toEqual(['state'])
    expect(filterParamNames(next.queries[0]!)).toEqual(['state'])
  })

  test('missing targets and unchanged patches preserve document identity', () => {
    const doc = withStatus()
    expect(updateFilter(doc, 'q', 0, { column: 'status' })).toBe(doc)
    expect(updateFilter(doc, 'q', 8, {})).toBe(doc)
    expect(removeFilter(doc, 'q', -1)).toBe(doc)
    expect(removeFilter(doc, 'missing', 0)).toBe(doc)
    const write = document({ mode: 'write' })
    expect(addFilter(write, 'q', { ...filter, type: 'text' })).toBe(write)
    const http = document({ sql: undefined, http: { method: 'GET', path: '/' } })
    expect(addFilter(http, 'q', { ...filter, type: 'text' })).toBe(http)
  })
})

describe('filter validation and preview', () => {
  test('every operator enforces scalar vs list parameter consistency', () => {
    for (const op of FILTER_OPS) {
      for (const type of PARAM_TYPES) {
        const doc = document({ params: [{ name: 'status', type, bind: { literal: null } }], filters: [{ ...filter, op }] })
        expect(validateDocument(doc).map((problem) => problem.code)).toEqual(filterAcceptsType(op, type) ? [] : ['filter_param_type'])
      }
    }
  })

  test('column limit counts UTF-8 bytes, with quotes and NUL rejected', () => {
    for (const column of ['', 'x'.repeat(64), '界'.repeat(22), 'a"b', 'a\0b']) {
      const doc = updateFilter(withStatus(), 'q', 0, { column })
      expect(validateDocument(doc)).toMatchObject([{ code: 'filter_column_invalid', path: 'queries.0.filters.0.column' }])
    }
    expect(validateDocument(updateFilter(withStatus(), 'q', 0, { column: '界'.repeat(21) }))).toEqual([])
  })

  test('unknown operators and missing required filter fields are schema errors', () => {
    for (const invalid of [{ ...filter, op: 'like' }, { ...filter, skipWhenEmpty: undefined }, { ...filter, column: null }]) {
      expect(validateDocument({ ...document(), queries: [{ ...query(), filters: [invalid] }] })[0]?.code).toBe('schema')
    }
  })

  test('no filter does not wrap and placeholder numbers follow parameter order', () => {
    const q = query({ sql: { text: 'select {{ second }}, {{first}}, {{ second }}' }, params: [
      { name: 'first', type: 'text', bind: { literal: 'never spliced' } },
      { name: 'second', type: 'number', bind: { literal: 2 } },
    ] })
    expect(effectiveSql(q)).toBe('select $2::numeric, $1::text, $2::numeric')
  })

  test('effective SQL matches all server clauses and empty guards', () => {
    const q = query({ sql: { text: 'select {{ needle }} -- trailing comment' }, params: [
      { name: 'needle', type: 'text', bind: { literal: '%private%' } },
      { name: 'statuses', type: 'textList', bind: { literal: [] } },
    ], filters: [
      { column: 'status', op: 'eq', param: 'needle', skipWhenEmpty: true },
      { column: 'status', op: 'neq', param: 'needle', skipWhenEmpty: false },
      { column: 'title', op: 'contains', param: 'needle', skipWhenEmpty: false },
      { column: 'total', op: 'gte', param: 'needle', skipWhenEmpty: false },
      { column: 'total', op: 'lte', param: 'needle', skipWhenEmpty: false },
      { column: 'status', op: 'in', param: 'statuses', skipWhenEmpty: true },
    ] })
    expect(effectiveSql(q)).toBe("SELECT * FROM (select $1::text -- trailing comment\n) AS _q WHERE ($1::text IS NULL OR $1::text = '' OR _q.\"status\" = $1::text) AND _q.\"status\" <> $1::text AND _q.\"title\"::text ILIKE '%' || $1::text || '%' AND _q.\"total\" >= $1::text AND _q.\"total\" <= $1::text AND ($2::text[] IS NULL OR cardinality($2::text[]) = 0 OR _q.\"status\" = ANY($2::text[]))")
    expect(effectiveSql(q)).not.toContain('%private%')
  })

  test('preview escapes identifier quotes even for an invalid draft', () => {
    const q = updateFilter(withStatus(), 'q', 0, { column: 'a"b', skipWhenEmpty: false }).queries[0]!
    expect(effectiveSql(q)).toContain('_q."a""b" = $1::text')
  })

  test('typed NULL guards do not compare numeric, boolean or date values to empty text', () => {
    for (const [type, cast] of [['number', 'numeric'], ['boolean', 'boolean'], ['date', 'date'], ['timestamp', 'timestamptz']] as const) {
      const q = query({ params: [{ name: 'status', type, bind: { literal: null } }], filters: [filter] })
      expect(effectiveSql(q)).toContain(`($1::${cast} IS NULL OR _q."status" = $1::${cast})`)
    }
    const q = query({ params: [{ name: 'status', type: 'number', bind: { literal: null } }], filters: [{ ...filter, op: 'contains' }] })
    expect(effectiveSql(q)).toContain(`_q."status"::text ILIKE '%' || $1::numeric::text || '%'`)
  })
})
