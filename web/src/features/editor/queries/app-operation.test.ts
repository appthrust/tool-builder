import { describe, expect, test } from 'bun:test'
import type { AppOperation } from '../../../api/types'
import { emptyDocument, type Query } from '../../../model/document'
import { validateDocument } from '../../../model/document.schema'
import { applyOperation, includedOptional, matchOperation, placeholderFor, templatePath } from './app-operation'
import { newQuery, updateQuery } from './query-ops'

const listGroups: AppOperation = {
  id: 'listGroups',
  method: 'GET',
  path: '/api/directory/v1/groups',
  summary: 'Find groups by name and direct parent',
  resultPath: 'items',
  params: [
    { name: 'q', in: 'query', type: 'string', required: false },
    { name: 'parentId', in: 'query', type: 'string', required: false },
    { name: 'limit', in: 'query', type: 'integer', required: false },
  ],
}
const members: AppOperation = {
  id: 'listGroupMembers',
  method: 'GET',
  path: '/api/directory/v1/groups/{id}/members',
  summary: '',
  resultPath: 'items',
  params: [{ name: 'id', in: 'path', type: 'string', required: true }],
}
const search: AppOperation = {
  id: 'search',
  method: 'GET',
  path: '/api/knowledge/v1/search',
  summary: '',
  resultPath: 'hits',
  params: [
    { name: 'query', in: 'query', type: 'string', required: true },
    { name: 'collections', in: 'query', type: 'array', required: false },
    { name: 'topK', in: 'query', type: 'integer', required: false },
  ],
}
const importRecords: AppOperation = {
  id: 'import',
  method: 'POST',
  path: '/api/directory/v1/import',
  summary: '',
  params: [
    { name: 'records', in: 'body', type: 'array', required: true },
    { name: 'dry-run', in: 'body', type: 'boolean', required: false },
  ],
}

const doc = emptyDocument()
const fresh = (): Query => newQuery(doc, { name: 'groups', sourceId: 'ds_directory', kind: 'builtin-app', mode: 'read' })

describe('built-in app operation → HTTP query', () => {
  test('a GET operation fills a read query with required inputs only', () => {
    const query = applyOperation(fresh(), search)
    expect(query.mode).toBe('read')
    expect(query.http).toEqual({ method: 'GET', path: '/api/knowledge/v1/search?query={{ query }}', resultPath: 'hits' })
    expect(query.params).toEqual([{ name: 'query', type: 'text', bind: { literal: null } }])
    expect(validateDocument({ ...doc, queries: [query] })).toEqual([])
  })

  test('optional inputs are added on request, typed from the schema; lists in the URL are comma text', () => {
    const query = applyOperation(fresh(), search, new Set(['topK', 'collections']))
    expect(query.http?.path).toBe('/api/knowledge/v1/search?query={{ query }}&collections={{ collections }}&topK={{ topK }}')
    expect(query.params.map((param) => [param.name, param.type])).toEqual([
      ['query', 'text'],
      ['collections', 'text'],
      ['topK', 'number'],
    ])
    expect(includedOptional(query, search)).toEqual(new Set(['collections', 'topK']))
  })

  test('path parameters become placeholders and are always included', () => {
    expect(templatePath(members)).toBe('/api/directory/v1/groups/{{ id }}/members')
    const query = applyOperation(fresh(), members)
    expect(query.http?.path).toBe('/api/directory/v1/groups/{{ id }}/members')
    expect(query.params.map((param) => param.name)).toEqual(['id'])
  })

  test('re-picking keeps the bindings of params with the same name', () => {
    const bound = { ...applyOperation(fresh(), listGroups, new Set(['q'])) }
    bound.params = bound.params.map((param) => (param.name === 'q' ? { ...param, bind: { ref: { component: 'search', prop: 'value' } } } : param))
    const widened = applyOperation(bound, listGroups, new Set(['q', 'limit']))
    expect(widened.params).toEqual([
      { name: 'q', type: 'text', bind: { ref: { component: 'search', prop: 'value' } } },
      { name: 'limit', type: 'number', bind: { literal: null } },
    ])
  })

  test('a non-GET operation becomes a write query with a JSON body template', () => {
    const query = applyOperation(fresh(), importRecords, new Set(['dry-run']))
    expect(query.mode).toBe('write')
    expect(query.rowLimit).toBe(0)
    expect(query.http?.method).toBe('POST')
    expect(query.http?.body).toBe('{\n  "records": {{ records }},\n  "dry-run": {{ dry_run }}\n}')
    expect(query.http?.resultPath).toBeUndefined()
    expect(query.params.map((param) => [param.name, param.type])).toEqual([
      ['records', 'textList'],
      ['dry_run', 'boolean'],
    ])
    expect(placeholderFor('1st')).toBe('_1st')
  })

  test('the generated query survives the editor sync and matches its operation back', () => {
    const query = fresh()
    const next = updateQuery({ ...doc, queries: [query] }, query.id, (current) => applyOperation(current, listGroups, new Set(['q'])))
    const stored = next.queries[0]!
    expect(stored.params.map((param) => param.name)).toEqual(['q'])
    expect(matchOperation(stored, [members, listGroups])?.id).toBe('listGroups')
    const spaced = { ...stored, http: { ...stored.http!, path: '/api/directory/v1/groups/{{id}}/members' } }
    expect(matchOperation(spaced, [members, listGroups])?.id).toBe('listGroupMembers')
    expect(matchOperation({ ...stored, http: { ...stored.http!, path: '/elsewhere' } }, [members, listGroups])).toBeUndefined()
  })
})
