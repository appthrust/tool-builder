// One registry `type → definition` for all 13 component types: the runtime
// component, the props schema (over resolved values), the property-panel
// fields, the props other components may reference, defaults for a fresh
// component and its palette entry. The editor canvas and the runtime both
// render through it.
import {
  BarChart3,
  CalendarDays,
  CircleHelp,
  ClipboardList,
  Hash,
  ListFilter,
  Minus,
  MousePointerClick,
  PanelRight,
  PanelsTopLeft,
  Search,
  Square,
  Table,
  Type,
  type LucideIcon,
} from 'lucide-react'
import type { ComponentType as ReactComponentType } from 'react'
import { z } from 'zod'
import type { MessageId } from '../copy'
import { COMPONENT_TYPES, EXPOSED_PROPS, type Component, type ComponentType, type Document, type Layout, type Prop } from '../model/document'
import { isComponentType, propSpecOf, PROP_SPECS } from '../model/document.schema'
import { ChartRuntime, DetailRuntime, StatRuntime } from './components/data'
import { DateRuntime, SearchInputRuntime, SelectRuntime } from './components/inputs'
import { ButtonRuntime, ContainerRuntime, DividerRuntime, FormRuntime, TabsRuntime, TextRuntime } from './components/layout'
import { TableRuntime } from './components/table'

export type ComponentProps = { component: Component }

/**
 * How the property panel edits one prop. `refable` props may hold
 * `{kind: 'ref'}`; `column` lists columns of the component's own `query`
 * result; `choices` are the values of a `select` field.
 */
export type PropFieldKind = 'text' | 'textarea' | 'number' | 'boolean' | 'query' | 'select' | 'columns' | 'formFields' | 'options' | 'column' | 'tabs'

export type PropField = {
  name: string
  kind: PropFieldKind
  label: MessageId
  refable: boolean
  required?: boolean
  choices?: { value: string; label: MessageId }[]
}

export type PaletteGroup = 'data' | 'inputs' | 'layout'

export type ComponentDefinition = {
  type: ComponentType
  Runtime: ReactComponentType<ComponentProps>
  /** Editor-only view; undefined → the canvas renders `Runtime` (actions inert). */
  Editor?: ReactComponentType<ComponentProps>
  /** Resolved prop values (refs already read); every prop optional. */
  propsSchema: z.ZodObject
  fields: PropField[]
  exposes: readonly string[]
  defaultProps: Record<string, Prop>
  defaultSize: { w: number; h: number }
  icon: LucideIcon
  label: MessageId
  /** Where the component's `actions` run from. */
  actionsSlot: 'row' | 'submit' | 'click' | null
}

const field = (name: string, kind: PropFieldKind, label: MessageId, extra: Partial<PropField> = {}): PropField => ({ name, kind, label, refable: false, ...extra })

const QUERY = field('query', 'query', 'toolBuilder.renderer.field.query')
const COLUMNS = field('columns', 'columns', 'toolBuilder.renderer.field.columns')
const LABEL = field('label', 'text', 'toolBuilder.renderer.field.label')
const PLACEHOLDER = field('placeholder', 'text', 'toolBuilder.renderer.field.placeholder')
const TITLE = field('title', 'text', 'toolBuilder.renderer.field.title')

const FIELDS: Record<ComponentType, PropField[]> = {
  table: [QUERY, COLUMNS],
  detail: [QUERY, COLUMNS],
  form: [field('fields', 'formFields', 'toolBuilder.renderer.field.fields'), field('submitLabel', 'text', 'toolBuilder.renderer.field.submitLabel')],
  chart: [
    TITLE,
    QUERY,
    field('kind', 'select', 'toolBuilder.renderer.field.kind', {
      choices: [
        { value: 'bar', label: 'toolBuilder.renderer.chartKind.bar' },
        { value: 'line', label: 'toolBuilder.renderer.chartKind.line' },
        { value: 'area', label: 'toolBuilder.renderer.chartKind.area' },
      ],
    }),
    field('x', 'column', 'toolBuilder.renderer.field.x'),
    field('y', 'column', 'toolBuilder.renderer.field.y'),
  ],
  stat: [
    LABEL,
    QUERY,
    field('column', 'column', 'toolBuilder.renderer.field.column'),
    field('format', 'select', 'toolBuilder.renderer.field.format', {
      choices: [
        { value: 'number', label: 'toolBuilder.renderer.format.number' },
        { value: 'money', label: 'toolBuilder.renderer.format.money' },
      ],
    }),
    field('delta', 'text', 'toolBuilder.renderer.field.delta', { refable: true }),
  ],
  text: [field('heading', 'text', 'toolBuilder.renderer.field.heading', { refable: true }), field('body', 'textarea', 'toolBuilder.renderer.field.body', { refable: true })],
  select: [
    LABEL,
    PLACEHOLDER,
    field('options', 'options', 'toolBuilder.renderer.field.options'),
    field('multiple', 'boolean', 'toolBuilder.renderer.field.multiple'),
    field('query', 'query', 'toolBuilder.renderer.field.optionsQuery'),
    field('valueColumn', 'column', 'toolBuilder.renderer.field.valueColumn'),
    field('labelColumn', 'column', 'toolBuilder.renderer.field.labelColumn'),
  ],
  date: [LABEL],
  searchInput: [LABEL, PLACEHOLDER],
  button: [
    LABEL,
    field('variant', 'select', 'toolBuilder.renderer.field.variant', {
      choices: [
        { value: 'primary', label: 'toolBuilder.renderer.variant.primary' },
        { value: 'secondary', label: 'toolBuilder.renderer.variant.secondary' },
        { value: 'destructive', label: 'toolBuilder.renderer.variant.destructive' },
      ],
    }),
  ],
  container: [TITLE],
  tabs: [field('tabs', 'tabs', 'toolBuilder.renderer.type.tabs')],
  divider: [LABEL],
}

const value = (v: unknown): Prop => ({ kind: 'value', value: v })

const DEFAULTS: Record<ComponentType, { props: Record<string, Prop>; size: { w: number; h: number } }> = {
  table: { props: {}, size: { w: 8, h: 8 } },
  detail: { props: {}, size: { w: 4, h: 5 } },
  form: { props: { fields: value([]) }, size: { w: 4, h: 4 } },
  chart: { props: { kind: value('bar') }, size: { w: 6, h: 6 } },
  stat: { props: { format: value('number') }, size: { w: 3, h: 2 } },
  text: { props: {}, size: { w: 6, h: 1 } },
  select: { props: { options: value([]), multiple: value(false) }, size: { w: 3, h: 1 } },
  date: { props: {}, size: { w: 3, h: 1 } },
  searchInput: { props: {}, size: { w: 4, h: 1 } },
  button: { props: { variant: value('primary') }, size: { w: 2, h: 1 } },
  container: { props: {}, size: { w: 6, h: 6 } },
  tabs: {
    props: {
      tabs: value([
        { id: 'tab1', label: '' },
        { id: 'tab2', label: '' },
      ]),
    },
    size: { w: 6, h: 6 },
  },
  divider: { props: {}, size: { w: 12, h: 1 } },
}

const RUNTIME: Record<ComponentType, ReactComponentType<ComponentProps>> = {
  table: TableRuntime,
  detail: DetailRuntime,
  form: FormRuntime,
  chart: ChartRuntime,
  stat: StatRuntime,
  text: TextRuntime,
  select: SelectRuntime,
  date: DateRuntime,
  searchInput: SearchInputRuntime,
  button: ButtonRuntime,
  container: ContainerRuntime,
  tabs: TabsRuntime,
  divider: DividerRuntime,
}

const ICON: Record<ComponentType, LucideIcon> = {
  table: Table,
  detail: PanelRight,
  form: ClipboardList,
  chart: BarChart3,
  stat: Hash,
  text: Type,
  select: ListFilter,
  date: CalendarDays,
  searchInput: Search,
  button: MousePointerClick,
  container: Square,
  tabs: PanelsTopLeft,
  divider: Minus,
}

const ACTIONS_SLOT: Partial<Record<ComponentType, ComponentDefinition['actionsSlot']>> = { table: 'row', form: 'submit', button: 'click' }

/** zod object over a type's resolved prop values (the per-type spec plus the common `tab`). */
function propsSchemaOf(type: ComponentType): z.ZodObject {
  const names = [...Object.keys(PROP_SPECS[type]), 'tab']
  return z.object(Object.fromEntries(names.map((name) => [name, propSpecOf(type, name)!.schema.nullable().optional()])))
}

export const componentRegistry: Readonly<Record<ComponentType, ComponentDefinition>> = Object.fromEntries(
  COMPONENT_TYPES.map((type) => [
    type,
    {
      type,
      Runtime: RUNTIME[type],
      propsSchema: propsSchemaOf(type),
      fields: FIELDS[type],
      exposes: EXPOSED_PROPS[type],
      defaultProps: DEFAULTS[type].props,
      defaultSize: DEFAULTS[type].size,
      icon: ICON[type],
      label: `toolBuilder.renderer.type.${type}` as MessageId,
      actionsSlot: ACTIONS_SLOT[type] ?? null,
    } satisfies ComponentDefinition,
  ])
) as Record<ComponentType, ComponentDefinition>

/** The definition of a type from the palette (always known). */
export function definitionOf(type: ComponentType): ComponentDefinition {
  return componentRegistry[type]
}

/**
 * The definition of a component read from a document; undefined for a type this build does not know (a
 * draft may hold one: `unknown_component_type` is a problem, not a shape error). Callers show such a
 * component as unknown, with `UNKNOWN_COMPONENT_ICON`, instead of failing.
 */
export function definitionFor(type: string): ComponentDefinition | undefined {
  return isComponentType(type) ? componentRegistry[type] : undefined
}

export const UNKNOWN_COMPONENT_ICON: LucideIcon = CircleHelp

/** Palette order (design "UI": Data · Inputs · Layout & actions). */
export const PALETTE: readonly { group: PaletteGroup; label: MessageId; types: readonly ComponentType[] }[] = [
  { group: 'data', label: 'toolBuilder.renderer.palette.data', types: ['table', 'detail', 'chart', 'stat'] },
  { group: 'inputs', label: 'toolBuilder.renderer.palette.inputs', types: ['form', 'searchInput', 'select', 'date'] },
  { group: 'layout', label: 'toolBuilder.renderer.palette.layout', types: ['text', 'container', 'tabs', 'button', 'divider'] },
]

/** `table1`, `table2`, …: the first `<type><n>` no component of the document uses. */
export function nextComponentId(document: Document, type: ComponentType): string {
  const taken = new Set(document.pages.flatMap((page) => page.components.map((component) => component.id)))
  let n = 1
  while (taken.has(`${type}${n}`)) n++
  return `${type}${n}`
}

/** A fresh component of `type` with the registry defaults (layout at the top-left unless given). */
export function newComponent(type: ComponentType, id: string, layout?: Layout): Component {
  const { size, props } = DEFAULTS[type]
  return { id, type, layout: layout ?? { x: 0, y: 0, ...size }, props: structuredClone(props) }
}
