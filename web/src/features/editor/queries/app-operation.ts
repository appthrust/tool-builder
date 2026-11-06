// The operation picker of a `builtin-app` source fills an ordinary HTTP query from
// one operation of the linked built-in app's contract (`GET /data-sources/{id}/operations`):
// method, full path with `{{ placeholders }}`, a JSON body template, where the
// rows are, and a Param per included operation parameter. The result is not a
// new document type; the author can keep editing it like any HTTP query.
// Design: builtin-app-connect tool-builder-sources.md §5.
//
// Only required parameters are included by default. The engine encodes a null
// path value as `null`, so an optional filter is added only when the author
// asks for it (and then binds it to something with a value).
import type { AppOperation, AppOperationParam } from '../../../api/types'
import { HTTP_METHODS, PLACEHOLDER, type HttpMethod, type Param, type ParamType, type Query } from '../../../model/document'
import { setMode } from './query-ops'

/** The placeholder an operation parameter becomes: its name with anything outside `[A-Za-z0-9_]` as `_`. */
export function placeholderFor(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`
}

/**
 * The Param type of an operation parameter (OpenAPI schema type). Lists in the URL travel as one
 * comma-separated text value (`?ids=a,b`); lists in a JSON body stay JSON arrays.
 */
export function paramTypeOf(param: AppOperationParam): ParamType {
  switch (param.type) {
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return param.in === 'body' ? 'textList' : 'text'
    default:
      return 'text'
  }
}

/** The operation's method as a document method; anything else is not offered. */
export function methodOf(operation: AppOperation): HttpMethod | undefined {
  const method = operation.method.toUpperCase()
  return (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : undefined
}

/** `/api/directory/v1/groups/{id}/members` → `/api/directory/v1/groups/{{ id }}/members`. */
export function templatePath(operation: AppOperation): string {
  return operation.path.replace(/\{([^{}/]+)\}/g, (_, name: string) => `{{ ${placeholderFor(name)} }}`)
}

/** `{{id}}` and `{{  id }}` read the same; compares paths without their query string. */
function normalizedPath(path: string): string {
  return (path.split('?')[0] ?? '').replace(new RegExp(PLACEHOLDER.source, 'g'), (_, name: string) => `{{ ${name} }}`)
}

/** The operation a query was generated from (same method and path), if any. */
export function matchOperation(query: Query, operations: readonly AppOperation[]): AppOperation | undefined {
  const http = query.http
  if (!http) return undefined
  const path = normalizedPath(http.path)
  return operations.find((operation) => methodOf(operation) === http.method && templatePath(operation) === path)
}

/** Optional parameters of `operation` the query currently carries a placeholder for. */
export function includedOptional(query: Query, operation: AppOperation): Set<string> {
  const names = new Set(query.params.map((param) => param.name))
  return new Set(operation.params.filter((param) => !param.required && names.has(placeholderFor(param.name))).map((param) => param.name))
}

/**
 * The query filled from `operation`: GET operations become read queries, any other method a write
 * query (the engine runs reads with GET only). Path parameters and required parameters are always
 * included, optional ones when named in `optional`. Params already on the query keep their binding.
 */
export function applyOperation(query: Query, operation: AppOperation, optional: ReadonlySet<string> = new Set()): Query {
  const method = methodOf(operation)
  if (!method) return query
  const included = operation.params.filter((param) => param.in === 'path' || param.required || optional.has(param.name))
  const search = included
    .filter((param) => param.in === 'query')
    .map((param) => `${encodeURIComponent(param.name)}={{ ${placeholderFor(param.name)} }}`)
  const bodyParams = included.filter((param) => param.in === 'body')
  const body =
    method === 'GET'
      ? undefined
      : bodyParams.length === 0
        ? '{}'
        : `{\n${bodyParams.map((param) => `  ${JSON.stringify(param.name)}: {{ ${placeholderFor(param.name)} }}`).join(',\n')}\n}`
  const existing = new Map(query.params.map((param) => [param.name, param]))
  const seen = new Set<string>()
  const params: Param[] = []
  for (const param of included) {
    const name = placeholderFor(param.name)
    if (seen.has(name)) continue
    seen.add(name)
    params.push({ name, type: paramTypeOf(param), bind: existing.get(name)?.bind ?? { literal: null } })
  }
  const moded = setMode(query, method === 'GET' ? 'read' : 'write')
  return {
    ...moded,
    http: {
      method,
      path: search.length === 0 ? templatePath(operation) : `${templatePath(operation)}?${search.join('&')}`,
      ...(body === undefined ? {} : { body }),
      ...(method === 'GET' && operation.resultPath ? { resultPath: operation.resultPath } : {}),
    },
    params,
  }
}
