// Pure structured-filter edits. updateQuery owns placeholder/filter parameter
// synchronization, so removing the final use also removes its orphan parameter.
import { PLACEHOLDER, type Document, type Filter, type FilterOp, type ParamType, type Query } from '../../../model/document'
import { PLACEHOLDER_NAME } from './placeholders'
import { updateQuery } from './query-ops'

export function filterParamNames(query: Query): string[] {
  return [...new Set((query.filters ?? []).map((filter) => filter.param))]
}

export function filterAcceptsType(op: FilterOp, type: ParamType): boolean {
  return (op === 'in') === (type === 'textList' || type === 'numberList')
}

function freeParamName(query: Query, column: string): string {
  const sanitized = column.replace(/[^A-Za-z0-9_]/g, '_')
  const base = PLACEHOLDER_NAME.test(sanitized) ? sanitized : `_${sanitized}`
  const taken = new Set(query.params.map((param) => param.name))
  let name = base
  for (let suffix = 2; taken.has(name); suffix += 1) name = `${base}_${suffix}`
  return name
}

export function addFilter(doc: Document, queryId: string, filter: Omit<Filter, 'param'> & { param?: string; type: ParamType }): Document {
  return updateQuery(doc, queryId, (query) => {
    if (query.mode !== 'read' || !query.sql) return query
    const { type, param: existing, ...fields } = filter
    const param = existing ?? freeParamName(query, filter.column)
    return {
      ...query,
      filters: [...(query.filters ?? []), { ...fields, param }],
      params: existing === undefined ? [...query.params, { name: param, type, bind: { literal: null } }] : query.params,
    }
  })
}

export function updateFilter(doc: Document, queryId: string, index: number, patch: Partial<Filter>): Document {
  return updateQuery(doc, queryId, (query) => {
    const current = query.filters?.[index]
    if (!current) return query
    const next = { ...current, ...patch }
    if (next.column === current.column && next.op === current.op && next.param === current.param && next.skipWhenEmpty === current.skipWhenEmpty) return query
    return { ...query, filters: query.filters!.map((filter, i) => i === index ? next : filter) }
  })
}

export function removeFilter(doc: Document, queryId: string, index: number): Document {
  return updateQuery(doc, queryId, (query) => {
    if (!query.filters?.[index]) return query
    const filters = query.filters.filter((_, i) => i !== index)
    if (filters.length > 0) return { ...query, filters }
    const { filters: _filters, ...withoutFilters } = query
    return withoutFilters
  })
}

// Mirrors engine.sqlParamCast: declared parameter types also type NULL values,
// so PostgreSQL can resolve IS NULL and cardinality without inference errors.
const SQL_CAST: Record<ParamType, string> = {
  text: 'text',
  number: 'numeric',
  boolean: 'boolean',
  date: 'date',
  timestamp: 'timestamptz',
  textList: 'text[]',
  numberList: 'numeric[]',
}

/** Human-facing preview only; execution and validation remain on the server (D4).
 * Contains deliberately leaves SQL LIKE wildcards (% and _) meaningful.
 * PostgreSQL preserves an inner ORDER BY in practice, not by SQL standard.
 */
export function effectiveSql(query: Query): string {
  if (!query.sql) return ''
  const positions = new Map(query.params.map((param, index) => [param.name, { sql: `$${index + 1}::${SQL_CAST[param.type]}`, type: param.type }]))
  const text = query.sql.text.replace(PLACEHOLDER, (match, name: string) => positions.get(name)?.sql ?? match)
  if (!query.filters?.length) return text
  const clauses = query.filters.map((filter) => {
    const column = `_q."${filter.column.replaceAll('"', '""')}"`
    // An invalid draft keeps its missing placeholder visible, never invents $0.
    const binding = positions.get(filter.param)
    const param = binding?.sql ?? `{{ ${filter.param} }}`
    let condition: string
    switch (filter.op) {
      case 'eq': condition = `${column} = ${param}`; break
      case 'neq': condition = `${column} <> ${param}`; break
      case 'contains': condition = `${column}::text ILIKE '%' || ${param}${binding?.type === 'text' ? '' : '::text'} || '%'`; break
      case 'gte': condition = `${column} >= ${param}`; break
      case 'lte': condition = `${column} <= ${param}`; break
      case 'in': condition = `${column} = ANY(${param})`; break
    }
    if (!filter.skipWhenEmpty) return condition
    const empty = filter.op === 'in' ? ` OR cardinality(${param}) = 0` : binding?.type === 'text' ? ` OR ${param} = ''` : ''
    return `(${param} IS NULL${empty} OR ${condition})`
  })
  // A newline keeps a trailing -- comment from consuming the closing bracket.
  return `SELECT * FROM (${text}\n) AS _q WHERE ${clauses.join(' AND ')}`
}
