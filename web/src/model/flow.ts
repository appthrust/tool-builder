// Canvas connections are projections of document facts, never a second graph
// stored in the document. Query nodes are collapsed into input-to-reader edges.
import { queryRefs } from './bindings'
import { exposedPropsOf, isExposedProp, type Component, type ComponentType, type Document, type Ref } from './document'
import { dataQueryOf } from './document.schema'

export type FlowEdge =
  | { kind: 'param'; from: Ref; to: string; queryId: string; param: string }
  | { kind: 'prop'; from: Ref; to: string; prop: string }
  | { kind: 'form'; from: Ref; to: string; actionId: string }

export type FlowHint = { componentId: string; kind: 'unconnectedInput' | 'noData' }

// Keep model/ independent of renderer/. These are the types with a query field
// in renderer/registry.tsx FIELDS; flow.test.ts checks parity with that registry.
const QUERY_TYPES: Partial<Record<ComponentType, true>> = { table: true, detail: true, chart: true, stat: true, select: true }

function validRef(ref: Ref, componentById: ReadonlyMap<string, Component>): boolean {
  const source = componentById.get(ref.component)
  return source !== undefined && isExposedProp(source.type, ref.prop)
}

/** Drawable connections, ordered by target then source component document order. */
export function flowEdges(doc: Document): FlowEdge[] {
  // Children already share the page's flat component array, linked by parentId.
  const components = doc.pages.flatMap((page) => page.components)
  const componentById = new Map(components.map((component) => [component.id, component]))
  const componentOrder = new Map(components.map((component, index) => [component.id, index]))
  const queryById = new Map(doc.queries.map((query) => [query.id, query]))
  const edges: FlowEdge[] = []

  for (const component of components) {
    const queryId = dataQueryOf(component)
    const query = queryId === undefined ? undefined : queryById.get(queryId)
    if (query) {
      for (const param of query.params) {
        if ('ref' in param.bind && validRef(param.bind.ref, componentById)) {
          edges.push({ kind: 'param', from: param.bind.ref, to: component.id, queryId: query.id, param: param.name })
        }
      }
    }
    for (const [name, prop] of Object.entries(component.props)) {
      if (prop.kind === 'ref' && validRef(prop.ref, componentById)) {
        edges.push({ kind: 'prop', from: prop.ref, to: component.id, prop: name })
      }
    }
    for (const action of component.actions ?? []) {
      if (!action.input) continue
      const from: Ref = { component: action.input.formComponent, prop: 'values' }
      if (validRef(from, componentById)) {
        edges.push({ kind: 'form', from, to: component.id, actionId: action.id })
      }
    }
  }

  // Stable ties retain param, prop and action declaration order for one source.
  return edges.sort(
    (left, right) =>
      componentOrder.get(left.to)! - componentOrder.get(right.to)! ||
      componentOrder.get(left.from.component)! - componentOrder.get(right.from.component)!
  )
}

/** Stable identity includes the reader, so a query's fan-out stays selectable. */
export function edgeKey(edge: FlowEdge): string {
  switch (edge.kind) {
    case 'param':
      return JSON.stringify([edge.kind, edge.from.component, edge.from.prop, edge.to, edge.queryId, edge.param])
    case 'prop':
      return JSON.stringify([edge.kind, edge.from.component, edge.from.prop, edge.to, edge.prop])
    case 'form':
      return JSON.stringify([edge.kind, edge.from.component, edge.from.prop, edge.to, edge.actionId])
  }
}

/** Editor-only guidance; these hints are not validation Problems. */
export function flowHints(doc: Document): FlowHint[] {
  const components = doc.pages.flatMap((page) => page.components)
  const componentById = new Map(components.map((component) => [component.id, component]))
  const connected = new Set<string>()

  // Read raw connection facts, not just drawable edges: a query still consumes
  // its inputs when it has no component reader (and thus no collapsed edge).
  for (const query of doc.queries) {
    for (const ref of queryRefs(query)) {
      if (validRef(ref, componentById)) connected.add(ref.component)
    }
  }
  for (const component of components) {
    for (const prop of Object.values(component.props)) {
      if (prop.kind === 'ref' && validRef(prop.ref, componentById)) connected.add(prop.ref.component)
    }
    for (const action of component.actions ?? []) {
      if (!action.input) continue
      const ref: Ref = { component: action.input.formComponent, prop: 'values' }
      if (validRef(ref, componentById)) connected.add(ref.component)
    }
  }

  const hints: FlowHint[] = []
  for (const component of components) {
    if (exposedPropsOf(component.type).length > 0 && !connected.has(component.id)) {
      hints.push({ componentId: component.id, kind: 'unconnectedInput' })
    }
    // A select's query is optional: fixed `options` are a data source of their own.
    const options = component.type === 'select' ? component.props.options : undefined
    const hasFixedOptions = options?.kind === 'value' && Array.isArray(options.value) && options.value.length > 0
    if (Object.hasOwn(QUERY_TYPES, component.type) && dataQueryOf(component) === undefined && !hasFixedOptions) {
      hints.push({ componentId: component.id, kind: 'noData' })
    }
  }
  return hints
}

/** Upstream ends at the component; downstream starts at an exposed prop of it. */
export function edgesAround(doc: Document, componentId: string): { upstream: FlowEdge[]; downstream: FlowEdge[] } {
  const upstream: FlowEdge[] = []
  const downstream: FlowEdge[] = []
  for (const edge of flowEdges(doc)) {
    if (edge.to === componentId) upstream.push(edge)
    if (edge.from.component === componentId) downstream.push(edge)
  }
  return { upstream, downstream }
}
