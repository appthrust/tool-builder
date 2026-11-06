// Fixture parity with the Go validator: every golden document under
// cmd/server/internal/domain/testdata/documents is accepted or
// rejected with the same first problem code.
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exposedPropsOf } from './document'
import { PROBLEM_CODES, exposesProp, isBlankSql, scanSql, validateDocument } from './document.schema'

const FIXTURES = join(import.meta.dir, '../../../cmd/server/internal/domain/testdata/documents')

const jsonFiles = (dir: string) =>
  readdirSync(join(FIXTURES, dir))
    .filter((name) => name.endsWith('.json'))
    .sort()

describe('golden fixtures', () => {
  test('both directories have fixtures', () => {
    expect(jsonFiles('valid').length).toBeGreaterThan(0)
    expect(jsonFiles('invalid').length).toBeGreaterThan(0)
  })

  test('the README reason list is the SPA code list, and every reason has an invalid fixture', () => {
    const readme = readFileSync(join(FIXTURES, 'README.md'), 'utf8')
    const list = /^Reason codes \(.*\):\n([\s\S]*?)\n\n/m.exec(readme)?.[1] ?? ''
    const listed = [...list.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]!).sort()
    expect(listed).toEqual([...PROBLEM_CODES].sort())
    const covered = new Set(jsonFiles('invalid').map((name) => (JSON.parse(readFileSync(join(FIXTURES, 'invalid', name), 'utf8')) as { reason: string }).reason))
    expect(listed.filter((code) => !covered.has(code))).toEqual([])
  })

  for (const name of jsonFiles('valid')) {
    test(`valid/${name} is accepted`, () => {
      const document = JSON.parse(readFileSync(join(FIXTURES, 'valid', name), 'utf8'))
      expect(validateDocument(document)).toEqual([])
    })
  }

  for (const name of jsonFiles('invalid')) {
    test(`invalid/${name} is rejected with its reason`, () => {
      const fixture = JSON.parse(readFileSync(join(FIXTURES, 'invalid', name), 'utf8')) as { reason: string; document: unknown }
      expect(PROBLEM_CODES as readonly string[]).toContain(fixture.reason)
      const problems = validateDocument(fixture.document)
      expect(problems.length).toBeGreaterThan(0)
      expect(problems[0]!.code).toBe(fixture.reason as (typeof PROBLEM_CODES)[number])
    })
  }
})

const base = () => ({
  schemaVersion: 1,
  pages: [{ id: 'main', title: '', components: [] as unknown[] }],
  queries: [] as unknown[],
})
const read = (id: string, text: string, params: unknown[] = []) => ({ id, name: id, sourceId: 'ds', mode: 'read', sql: { text }, params, timeoutMs: 10000, rowLimit: 100 })
const firstCode = (doc: unknown) => validateDocument(doc)[0]?.code

describe('rules', () => {
  test('schema short-circuits later phases', () => {
    const doc = base()
    doc.pages.push({ id: 'main', title: '', components: [{ id: 'x' }] })
    expect(validateDocument(doc).every((problem) => problem.code === 'schema')).toBe(true)
  })

  test('one page', () => {
    const doc = base()
    doc.pages.push({ id: 'second', title: '', components: [] })
    expect(firstCode(doc)).toBe('one_page_required')
  })

  test('unknown type is not a schema error, and exposes nothing', () => {
    expect(exposedPropsOf('map')).toEqual([])
    expect(exposedPropsOf('constructor')).toEqual([])
    expect(exposedPropsOf('select')).toEqual(['value'])
    const doc = base()
    doc.pages[0]!.components.push({ id: 'a', type: 'map', layout: { x: 0, y: 0, w: 1, h: 1 }, props: {} })
    expect(firstCode(doc)).toBe('unknown_component_type')
  })

  test('per-type props: value-only ref and wrong value types', () => {
    const doc = base()
    doc.pages[0]!.components.push({ id: 't', type: 'table', layout: { x: 0, y: 0, w: 4, h: 4 }, props: { query: { kind: 'ref', ref: { component: 's', prop: 'value' } } } })
    expect(validateDocument(doc)[0]).toMatchObject({ code: 'schema', path: 'pages.0.components.0.props.query' })
    const doc2 = base()
    doc2.pages[0]!.components.push({ id: 't', type: 'table', layout: { x: 0, y: 0, w: 4, h: 4 }, props: { columns: { kind: 'value', value: [{ name: 'a', format: 'percent' }] } } })
    expect(firstCode(doc2)).toBe('schema')
  })

  test('duplicate ids at the second occurrence', () => {
    const doc = base()
    doc.queries.push(read('q', 'select 1'), read('q', 'select 2'))
    expect(validateDocument(doc)[0]).toMatchObject({ code: 'duplicate_id', path: 'queries.1.id' })
  })

  test('layout and parent', () => {
    const doc = base()
    doc.pages[0]!.components.push({ id: 'a', type: 'stat', layout: { x: 8, y: 0, w: 6, h: 1 }, props: {} })
    expect(firstCode(doc)).toBe('layout_out_of_grid')
    const doc2 = base()
    doc2.pages[0]!.components.push(
      { id: 's', type: 'stat', layout: { x: 0, y: 0, w: 2, h: 1 }, props: {} },
      { id: 'a', type: 'stat', layout: { x: 0, y: 0, w: 2, h: 1 }, parentId: 's', props: {} }
    )
    expect(firstCode(doc2)).toBe('unknown_parent')
    const doc3 = base()
    doc3.pages[0]!.components.push(
      { id: 'c1', type: 'container', layout: { x: 0, y: 0, w: 2, h: 1 }, parentId: 'c2', props: {} },
      { id: 'c2', type: 'container', layout: { x: 0, y: 0, w: 2, h: 1 }, parentId: 'c1', props: {} }
    )
    expect(firstCode(doc3)).toBe('unknown_parent')
  })

  test('query source, timeout, row limit', () => {
    const doc = base()
    doc.queries.push({ id: 'q', name: 'q', sourceId: 'ds', mode: 'read', params: [], timeoutMs: 10000, rowLimit: 1 })
    expect(firstCode(doc)).toBe('query_source_missing')
    const doc2 = base()
    doc2.queries.push({ ...read('q', 'select 1'), timeoutMs: 30001 })
    expect(firstCode(doc2)).toBe('timeout_out_of_range')
    const doc3 = base()
    doc3.queries.push({ ...read('q', 'select 1'), rowLimit: 0 })
    expect(firstCode(doc3)).toBe('row_limit_out_of_range')
    const doc4 = base()
    doc4.queries.push({ ...read('q', 'delete from t'), mode: 'write', rowLimit: 0 })
    expect(validateDocument(doc4)).toEqual([])
  })

  test('empty SQL is empty_query, not a shape error, and uses the server whitespace set', () => {
    const doc = base()
    doc.queries.push(read('q', ''))
    expect(validateDocument(doc)).toEqual([{ code: 'empty_query', path: 'queries.0.sql.text', message: 'query "q" has no SQL' }])
    const doc2 = base()
    doc2.queries.push(read('q', ' \n\t\u00a0\u3000'))
    expect(firstCode(doc2)).toBe('empty_query')
    expect(isBlankSql('\u0085')).toBe(true)
    expect(isBlankSql('\ufeff')).toBe(false)
  })

  test('placeholders inside literals, identifiers and comments', () => {
    const p = [{ name: 'a', type: 'text', bind: { literal: null } }]
    for (const text of ["select '{{ a }}'", 'select "{{ a }}"', 'select 1 -- {{ a }}', 'select /* {{ a }} */ 1', 'select $$ {{ a }} $$', 'select 1 -- {{ a\n}}']) {
      const doc = base()
      doc.queries.push(read('q', text, p))
      expect(validateDocument(doc), text).toEqual([{ code: 'placeholder_in_literal', path: 'queries.0.sql.text', message: 'a {{ name }} placeholder inside quotes or a comment is not bound' }])
    }
    const doc = base()
    doc.queries.push(read('q', "select {{ a }}, 'x' -- y", p))
    expect(validateDocument(doc)).toEqual([])
  })

  test('placeholder padding is ASCII whitespace only', () => {
    const doc = base()
    doc.queries.push(read('q', 'select {{\u00a0a }}', [{ name: 'a', type: 'text', bind: { literal: null } }]))
    expect(firstCode(doc)).toBe('schema')
  })

  test('positional placeholders and statements', () => {
    const doc = base()
    doc.queries.push(read('q', 'select * from t where id = $1'))
    expect(firstCode(doc)).toBe('positional_placeholder')
    const doc2 = base()
    doc2.queries.push(read('q', 'select 1; select 2'))
    expect(firstCode(doc2)).toBe('multiple_statements')
    const doc3 = base()
    doc3.queries.push(read('q', "select ';', '$1', $$a;b$$, $x$ ; $x$ /* ; /* $1 */ */ -- ;\nfrom t"))
    expect(validateDocument(doc3)).toEqual([])
  })

  test('lexer', () => {
    expect(scanSql("select E'\\';' x")).toEqual({ positional: false, semicolon: false, placeholderInLiteral: false, unterminated: false })
    expect(scanSql("select 'abc")).toMatchObject({ unterminated: true })
    expect(scanSql('select /* /* */')).toMatchObject({ unterminated: true })
    expect(scanSql('select $q$ abc')).toMatchObject({ unterminated: true })
    expect(scanSql('select "a""b" ;')).toMatchObject({ semicolon: true })
  })

  test('malformed placeholders and http rules are schema problems', () => {
    const doc = base()
    doc.queries.push(read('q', 'select {{ a + 1 }}'))
    expect(firstCode(doc)).toBe('schema')
    const doc2 = base()
    doc2.queries.push({ id: 'q', name: 'q', sourceId: 'ds', mode: 'read', http: { method: 'POST', path: '/x' }, params: [], timeoutMs: 1000, rowLimit: 1 })
    expect(firstCode(doc2)).toBe('schema')
    const doc3 = base()
    doc3.queries.push({ id: 'q', name: 'q', sourceId: 'ds', mode: 'read', http: { method: 'GET', path: '//evil/x' }, params: [], timeoutMs: 1000, rowLimit: 1 })
    expect(firstCode(doc3)).toBe('schema')
  })

  test('placeholders and params pair up across sql, path and body', () => {
    const doc = base()
    doc.queries.push(read('q', 'select 1', [{ name: 'x', type: 'text', bind: { literal: null } }]))
    expect(firstCode(doc)).toBe('param_without_placeholder')
    const doc2 = base()
    doc2.queries.push({
      id: 'q',
      name: 'q',
      sourceId: 'ds',
      mode: 'write',
      http: { method: 'POST', path: '/orders/{{ id }}', body: '{"note": {{ note }}}' },
      params: [
        { name: 'id', type: 'text', bind: { literal: '1' } },
        { name: 'note', type: 'text', bind: { literal: null } },
      ],
      timeoutMs: 1000,
      rowLimit: 0,
    })
    expect(validateDocument(doc2)).toEqual([])
  })

  test('query references and actions', () => {
    const table = (props: Record<string, unknown>, actions?: unknown[]) => ({ id: 't', type: 'table', layout: { x: 0, y: 0, w: 6, h: 4 }, props, ...(actions ? { actions } : {}) })
    const doc = base()
    doc.pages[0]!.components.push(table({ query: { kind: 'value', value: 'nope' } }))
    expect(firstCode(doc)).toBe('unknown_query')
    const doc2 = base()
    doc2.queries.push(read('q', 'select 1'))
    doc2.pages[0]!.components.push(table({}, [{ id: 'a', label: 'A', queryId: 'missing' }]))
    expect(firstCode(doc2)).toBe('unknown_action_query')
    const doc3 = base()
    doc3.queries.push(read('q', 'select 1'))
    doc3.pages[0]!.components.push(table({}, [{ id: 'a', label: 'A', queryId: 'q' }]))
    expect(firstCode(doc3)).toBe('action_query_not_write')
    const doc4 = base()
    doc4.queries.push({ ...read('w', 'delete from t'), mode: 'write', rowLimit: 0 })
    doc4.pages[0]!.components.push(table({}, [{ id: 'a', label: 'A', queryId: 'w', input: { formComponent: 't' } }]))
    expect(firstCode(doc4)).toBe('unknown_form_component')
    const doc5 = base()
    doc5.queries.push({ ...read('w', 'delete from t'), mode: 'write', rowLimit: 0 })
    doc5.pages[0]!.components.push(table({}, [{ id: 'a', label: 'A', queryId: 'w', onSuccess: { refresh: ['w'] } }]))
    expect(firstCode(doc5)).toBe('write_query_not_action')
    const doc6 = base()
    doc6.pages[0]!.components.push({ id: 's', type: 'stat', layout: { x: 0, y: 0, w: 2, h: 1 }, props: {}, actions: [] })
    expect(firstCode(doc6)).toBe('schema')
  })

  test('refs: unknown component and exposure', () => {
    const doc = base()
    doc.queries.push(read('q', 'select {{ a }}', [{ name: 'a', type: 'text', bind: { ref: { component: 'ghost', prop: 'value' } } }]))
    expect(firstCode(doc)).toBe('unknown_ref_component')
    const doc2 = base()
    doc2.pages[0]!.components.push({ id: 's', type: 'select', layout: { x: 0, y: 0, w: 2, h: 1 }, props: {} })
    doc2.queries.push(read('q', 'select {{ a }}', [{ name: 'a', type: 'text', bind: { ref: { component: 's', prop: 'value.x' } } }]))
    expect(firstCode(doc2)).toBe('prop_not_exposed')
    expect(exposesProp('table', 'selectedRow.id')).toBe(true)
    expect(exposesProp('form', 'values.amount')).toBe(true)
    expect(exposesProp('select', 'value')).toBe(true)
    expect(exposesProp('table', 'selectedRow.')).toBe(false)
    expect(exposesProp('detail', 'value')).toBe(false)
  })

  test('cycle through a text prop ref', () => {
    const doc = base()
    doc.pages[0]!.components.push({ id: 'x', type: 'text', layout: { x: 0, y: 0, w: 2, h: 1 }, props: { body: { kind: 'ref', ref: { component: 'x', prop: 'value' } } } })
    // text exposes nothing, so exposure fails before the cycle phase.
    expect(firstCode(doc)).toBe('prop_not_exposed')
  })
})
