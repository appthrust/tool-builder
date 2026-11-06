// Parameter bookkeeping for the query editor. A parameter is justified by a
// placeholder or a structured filter; SQL edits must preserve filter bindings.
import { type Component, type Document, exposedPropsOf, type Param, type ParamType, type Query, type Ref } from '../../../model/document'
import { queryPlaceholders } from '../../../model/document.schema'

/** Identifier rule of a placeholder name (same as PLACEHOLDER's capture). */
export const PLACEHOLDER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The params list matching `names` or `keep` (filter references). Existing
 * params keep their position, type and binding, preserving `$n` bind order.
 * New placeholders are appended as text parameters bound to a null literal.
 * A missing filter param is not invented: validation reports its unknown name.
 * Returns the same array when nothing changes.
 */
export function syncParams(params: Param[], names: readonly string[], keep: readonly string[] = []): Param[] {
  const wanted = new Set([...names, ...keep])
  const kept = params.filter((param) => wanted.has(param.name))
  const have = new Set(kept.map((param) => param.name))
  const added = names.filter((name) => !have.has(name)).map((name): Param => ({ name, type: 'text', bind: { literal: null } }))
  if (added.length === 0 && kept.length === params.length) return params
  return [...kept, ...added]
}

/** The query with params synced to its texts and filters (identity when already in sync). */
export function withSyncedParams(query: Query): Query {
  const params = syncParams(query.params, queryPlaceholders(query), (query.filters ?? []).map((filter) => filter.param))
  return params === query.params ? query : { ...query, params }
}

export type RefOption = { ref: Ref; label: string }

type FieldDef = { name?: unknown }

function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item: FieldDef) => (typeof item?.name === 'string' && item.name !== '' ? [item.name] : []))
}

function staticValue(component: Component, prop: string): unknown {
  const p = component.props[prop]
  return p?.kind === 'value' ? p.value : undefined
}

/**
 * Every reference a parameter may bind to, over the props components expose:
 * `table.selectedRow.<column>` per declared column (and the whole row),
 * `form.values.<field>` per declared field, `select/searchInput/date.value`,
 * `tabs.active`.
 */
export function refOptions(document: Document): RefOption[] {
  const options: RefOption[] = []
  for (const page of document.pages) {
    for (const component of page.components) {
      for (const head of exposedPropsOf(component.type)) {
        const sub =
          component.type === 'table' && head === 'selectedRow'
            ? namesOf(staticValue(component, 'columns'))
            : component.type === 'form' && head === 'values'
              ? namesOf(staticValue(component, 'fields'))
              : []
        if (sub.length === 0) options.push({ ref: { component: component.id, prop: head }, label: `${component.id}.${head}` })
        for (const name of sub) options.push({ ref: { component: component.id, prop: `${head}.${name}` }, label: `${component.id}.${head}.${name}` })
      }
    }
  }
  return options
}

export function refKey(ref: Ref): string {
  return `${ref.component}.${ref.prop}`
}

/**
 * The JSON value sent as a Run input for a sample typed in the parameters
 * panel. Lists are comma separated; empty text is `null` (the engine binds
 * SQL NULL); numbers that do not parse stay text so the server reports the
 * type error with its own code.
 */
export function sampleInput(type: ParamType, raw: string): unknown {
  const text = raw.trim()
  if (text === '') return null
  switch (type) {
    case 'number': {
      const n = Number(text)
      return Number.isFinite(n) ? n : text
    }
    case 'boolean':
      return text === 'true'
    case 'textList':
      return text.split(',').map((item) => item.trim()).filter((item) => item !== '')
    case 'numberList':
      return text
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
        .map((item) => (Number.isFinite(Number(item)) ? Number(item) : item))
    default:
      return raw
  }
}

/** Sample text prefilled from a literal binding, so Run works without retyping. */
export function sampleFromLiteral(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(String).join(', ')
  return String(value)
}
