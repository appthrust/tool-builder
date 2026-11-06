// Pure edits of the draft document the canvas and the property panel make.
// Every function returns a new Document (or the same one when nothing
// changes) so the draft store can keep undo history by reference.
//
// Placement rule (boring, like most grid builders): components may not
// overlap within one grid (same parent, same tab). A placed, moved or resized
// component keeps its cell and pushes overlapping siblings down, recursively;
// nothing is compacted upwards, so the author's empty rows stay.
import type { Action, Component, Document, Layout, ParamBind, Prop, Ref } from '../../../model/document'
import type { FlowEdge } from '../../../model/flow'
import { GRID_COLUMNS } from '../../../model/document.schema'
import { nextComponentId } from '../../../renderer/registry'
import { tabOf, withTab } from '../../../renderer/grid'

/** Where a component sits: its parent (undefined = page) and, under tabs, its tab id. */
export type Slot = { parentId: string | undefined; tab: string | undefined }

export function componentsOf(doc: Document): Component[] {
  return doc.pages[0]?.components ?? []
}

export function findComponent(doc: Document, id: string): Component | undefined {
  return componentsOf(doc).find((component) => component.id === id)
}

function withComponents(doc: Document, components: Component[]): Document {
  const [page, ...rest] = doc.pages
  if (!page) return doc
  return { ...doc, pages: [{ ...page, components }, ...rest] }
}

/** Replaces one component; `fn` returning the same object is a no-op. */
export function updateComponent(doc: Document, id: string, fn: (component: Component) => Component): Document {
  let changed = false
  const components = componentsOf(doc).map((component) => {
    if (component.id !== id) return component
    const next = fn(component)
    if (next !== component) changed = true
    return next
  })
  return changed ? withComponents(doc, components) : doc
}

export function slotOf(doc: Document, component: Component): Slot {
  const parent = component.parentId ? findComponent(doc, component.parentId) : undefined
  return { parentId: component.parentId, tab: parent?.type === 'tabs' ? tabOf(component, parent) : undefined }
}

function sameSlot(a: Slot, b: Slot): boolean {
  return a.parentId === b.parentId && a.tab === b.tab
}

function overlaps(a: Layout, b: Layout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Keeps a layout inside the 12 columns: width 1..12, x so the right edge fits, y and h ≥ 0 / 1. */
export function clampLayout(layout: Layout): Layout {
  const w = Math.min(GRID_COLUMNS, Math.max(1, Math.round(layout.w)))
  const x = Math.min(GRID_COLUMNS - w, Math.max(0, Math.round(layout.x)))
  return { x, y: Math.max(0, Math.round(layout.y)), w, h: Math.max(1, Math.round(layout.h)) }
}

/** Pushes siblings that overlap `anchorId` below it, then the ones those overlap, until the slot is settled. */
export function settle(doc: Document, anchorId: string): Document {
  let components = componentsOf(doc)
  const anchor = components.find((component) => component.id === anchorId)
  if (!anchor) return doc
  const slot = slotOf(doc, anchor)
  const queue = [anchorId]
  const fixed = new Set<string>()
  while (queue.length > 0) {
    const currentId = queue.shift() as string
    fixed.add(currentId)
    const current = components.find((component) => component.id === currentId)
    if (!current) continue
    components = components.map((component) => {
      if (fixed.has(component.id) || !sameSlot(slotOf(doc, component), slot) || !overlaps(component.layout, current.layout)) return component
      queue.push(component.id)
      return { ...component, layout: { ...component.layout, y: current.layout.y + current.layout.h } }
    })
  }
  return withComponents(doc, components)
}

/** Rows used by the components of one slot (the next free row). */
export function slotRows(doc: Document, slot: Slot): number {
  return componentsOf(doc)
    .filter((component) => sameSlot(slotOf(doc, component), slot))
    .reduce((rows, component) => Math.max(rows, component.layout.y + component.layout.h), 0)
}

/** Ids of a component and every component nested in it. */
export function subtreeIds(doc: Document, id: string): Set<string> {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const component of componentsOf(doc)) {
      if (component.parentId && ids.has(component.parentId) && !ids.has(component.id)) {
        ids.add(component.id)
        grew = true
      }
    }
  }
  return ids
}

function placeInSlot(component: Component, slot: Slot): Component {
  const { parentId: _previousParent, ...rest } = component
  const placed: Component = slot.parentId ? { ...rest, parentId: slot.parentId } : rest
  if (slot.tab !== undefined) return withTab(placed, slot.tab)
  if (!('tab' in placed.props)) return placed
  const { tab: _tab, ...props } = placed.props
  return { ...placed, props }
}

/** Adds a new component at `layout` in `slot`; overlapping siblings move down. */
export function addComponent(doc: Document, component: Component, slot: Slot): Document {
  const placed = placeInSlot({ ...component, layout: clampLayout(component.layout) }, slot)
  return settle(withComponents(doc, [...componentsOf(doc), placed]), placed.id)
}

/** Moves a component to `x,y` of `slot` (possibly another parent). A component never moves into itself. */
export function moveComponent(doc: Document, id: string, slot: Slot, at: { x: number; y: number }): Document {
  const component = findComponent(doc, id)
  if (!component) return doc
  if (slot.parentId && subtreeIds(doc, id).has(slot.parentId)) return doc
  const layout = clampLayout({ ...component.layout, x: at.x, y: at.y })
  const current = slotOf(doc, component)
  if (sameSlot(current, slot) && layout.x === component.layout.x && layout.y === component.layout.y) return doc
  return settle(
    updateComponent(doc, id, (c) => placeInSlot({ ...c, layout }, slot)),
    id
  )
}

export function resizeComponent(doc: Document, id: string, size: { w: number; h: number }): Document {
  const component = findComponent(doc, id)
  if (!component) return doc
  const layout = clampLayout({ ...component.layout, w: size.w, h: size.h })
  if (layout.w === component.layout.w && layout.h === component.layout.h && layout.x === component.layout.x) return doc
  return settle(
    updateComponent(doc, id, (c) => ({ ...c, layout })),
    id
  )
}

/** Sets any layout field (the Style tab); same placement rule. */
export function setLayout(doc: Document, id: string, layout: Layout): Document {
  const component = findComponent(doc, id)
  if (!component) return doc
  const next = clampLayout(layout)
  if (next.x === component.layout.x && next.y === component.layout.y && next.w === component.layout.w && next.h === component.layout.h) return doc
  return settle(
    updateComponent(doc, id, (c) => ({ ...c, layout: next })),
    id
  )
}

/**
 * Removes a component and everything nested in it. References to it elsewhere
 * are left in place on purpose: they become validation problems the author
 * sees on the referencing component, instead of silently changing behaviour.
 */
export function removeComponent(doc: Document, id: string): Document {
  const ids = subtreeIds(doc, id)
  const components = componentsOf(doc)
  const kept = components.filter((component) => !ids.has(component.id))
  return kept.length === components.length ? doc : withComponents(doc, kept)
}

/** Every action id in the document (action ids are unique per tool: grants refer to them). */
export function actionIds(doc: Document): Set<string> {
  return new Set(componentsOf(doc).flatMap((component) => (component.actions ?? []).map((action) => action.id)))
}

/** `action1`, `action2`, … the first id not used in `doc` nor in `taken`. */
export function nextActionId(doc: Document, taken: Set<string> = new Set()): string {
  const used = actionIds(doc)
  for (let n = 1; ; n++) {
    const id = `action${n}`
    if (!used.has(id) && !taken.has(id)) return id
  }
}

/**
 * Copies a component and its nested components with fresh ids, placed right
 * below the original in the same slot. Refs between copied components point
 * at the copies; refs outside the subtree are kept. Action ids are new.
 */
export function duplicateComponent(doc: Document, id: string): { doc: Document; id: string | undefined } {
  const original = findComponent(doc, id)
  if (!original) return { doc, id: undefined }
  const ids = subtreeIds(doc, id)
  const subtree = componentsOf(doc).filter((component) => ids.has(component.id))
  const renames = new Map<string, string>()
  let working = doc
  for (const component of subtree) {
    const fresh = nextComponentId(working, component.type)
    renames.set(component.id, fresh)
    // Reserve the id so the next call does not hand it out again.
    working = withComponents(working, [...componentsOf(working), { ...component, id: fresh }])
  }
  const takenActions = new Set<string>()
  const copies = subtree.map((component) => {
    const copy = rewriteRefs({ ...component, id: renames.get(component.id) as string }, renames)
    const parentId = component.parentId ? (renames.get(component.parentId) ?? component.parentId) : undefined
    const actions = copy.actions?.map((action) => {
      const actionId = nextActionId(doc, takenActions)
      takenActions.add(actionId)
      return { ...action, id: actionId }
    })
    const layout = component.id === id ? { ...component.layout, y: component.layout.y + component.layout.h } : component.layout
    const { parentId: _parent, actions: _actions, ...rest } = copy
    return { ...rest, layout, ...(parentId ? { parentId } : {}), ...(actions ? { actions } : {}) }
  })
  const copyId = renames.get(id) as string
  return { doc: settle(withComponents(doc, [...componentsOf(doc), ...copies]), copyId), id: copyId }
}

function renameRef(ref: Ref, renames: Map<string, string>): Ref {
  const target = renames.get(ref.component)
  return target ? { ...ref, component: target } : ref
}

function rewriteRefs(component: Component, renames: Map<string, string>): Component {
  const props: Record<string, Prop> = {}
  for (const [name, prop] of Object.entries(component.props)) props[name] = prop.kind === 'ref' ? { kind: 'ref', ref: renameRef(prop.ref, renames) } : prop
  const actions = component.actions?.map((action) => {
    const form = action.input ? renames.get(action.input.formComponent) : undefined
    return form ? { ...action, input: { formComponent: form } } : action
  })
  return { ...component, props, ...(actions ? { actions } : {}) }
}

export const COMPONENT_ID = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Why `next` cannot be the new id of `id`, or undefined when it can. */
export function componentIdProblem(doc: Document, id: string, next: string): 'empty' | 'format' | 'taken' | undefined {
  if (next === '') return 'empty'
  if (!COMPONENT_ID.test(next)) return 'format'
  if (next !== id && componentsOf(doc).some((component) => component.id === next)) return 'taken'
  return undefined
}

/** Renames a component and every reference to it: props, query params, form inputs of actions, children. */
export function renameComponent(doc: Document, id: string, next: string): Document {
  if (id === next || componentIdProblem(doc, id, next) !== undefined) return doc
  const renames = new Map([[id, next]])
  const components = componentsOf(doc).map((component) => {
    const renamed = rewriteRefs(component.id === id ? { ...component, id: next } : component, renames)
    return renamed.parentId === id ? { ...renamed, parentId: next } : renamed
  })
  const queries = doc.queries.map((query) => ({
    ...query,
    params: query.params.map((param) => ('ref' in param.bind ? { ...param, bind: { ref: renameRef(param.bind.ref, renames) } } : param)),
  }))
  return { ...withComponents(doc, components), queries }
}

/** Sets one prop; `undefined` removes it (unset). */
export function setProp(doc: Document, id: string, name: string, prop: Prop | undefined): Document {
  return updateComponent(doc, id, (component) => {
    if (prop === undefined) {
      if (!(name in component.props)) return component
      const { [name]: _removed, ...props } = component.props
      return { ...component, props }
    }
    return { ...component, props: { ...component.props, [name]: prop } }
  })
}

export function setActions(doc: Document, id: string, actions: Action[]): Document {
  return updateComponent(doc, id, (component) => {
    if (actions.length === 0) {
      const { actions: _actions, ...rest } = component
      return rest
    }
    return { ...component, actions }
  })
}

export function setPageTitle(doc: Document, title: string): Document {
  const [page, ...rest] = doc.pages
  if (!page || page.title === title) return doc
  return { ...doc, pages: [{ ...page, title }, ...rest] }
}

function withParamBind(doc: Document, queryId: string, name: string, bind: ParamBind): Document {
  const index = doc.queries.findIndex((query) => query.id === queryId)
  const query = doc.queries[index]
  const param = query?.params.find((candidate) => candidate.name === name)
  if (!query || !param || JSON.stringify(param.bind) === JSON.stringify(bind)) return doc
  const params = query.params.map((candidate) => (candidate === param ? { ...candidate, bind } : candidate))
  return { ...doc, queries: doc.queries.map((candidate, i) => (i === index ? { ...query, params } : candidate)) }
}

/** Binds param `name` of query `queryId` to `ref`; nothing else changes (same doc when already bound so). */
export function bindParam(doc: Document, queryId: string, name: string, ref: Ref): Document {
  return withParamBind(doc, queryId, name, { ref: { component: ref.component, prop: ref.prop } })
}

/** Unbinds param `name` of query `queryId`: a null literal, like choosing "fixed value" in the parameters panel. */
export function unbindParam(doc: Document, queryId: string, name: string): Document {
  return withParamBind(doc, queryId, name, { literal: null })
}

/** Removes the connection an edge stands for. A form input edge is the action's own setting: unchanged here. */
export function disconnectEdge(doc: Document, edge: FlowEdge): Document {
  switch (edge.kind) {
    case 'param':
      return unbindParam(doc, edge.queryId, edge.param)
    case 'prop':
      return setProp(doc, edge.to, edge.prop, undefined)
    case 'form':
      return doc
  }
}
