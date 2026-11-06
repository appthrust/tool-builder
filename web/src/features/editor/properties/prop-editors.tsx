// One editor per registry `PropField` (renderer/registry.tsx): the generic
// kinds (text, number, boolean, select) and the type-specific ones (query
// picker, columns, options, form fields, tabs, column picker). A field marked
// `refable` can switch between a fixed value and a reference to a value
// another component exposes.
import { Database, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import type { Component, Document, Prop, Ref } from '../../../model/document'
import { dataQueryOf, type ColumnSpec, type FormFieldSpec, type OptionSpec, type Problem, type TabSpec } from '../../../model/document.schema'
import type { PropField } from '../../../renderer/registry'
import { useQueryState } from '../../../renderer/runtime-context'
import { useText } from '../../../i18n'
import { paths } from '../../../routes/paths'
import { HrefLink, SegmentedControl, Select, TextArea } from '../../../ui'
import { setProp } from '../canvas/document-ops'
import type { UpdateOptions } from '../draft-store'
import { Checkbox, CompactInput, PanelField, UNSET } from './controls'
import { ColumnsEditor, FormFieldsEditor, OptionsEditor, TabsEditor } from './list-editors'
import { RefPicker } from './ref-picker'

export type Update = (fn: (doc: Document) => Document, options?: UpdateOptions) => void

type EditorProps = {
  slug: string
  doc: Document
  component: Component
  field: PropField
  problems: readonly Problem[]
  update: Update
}

function valueOf(prop: Prop | undefined): unknown {
  return prop?.kind === 'value' ? prop.value : undefined
}

function arrayOf<T>(prop: Prop | undefined): T[] {
  const value = valueOf(prop)
  return Array.isArray(value) ? (value as T[]) : []
}

export function PropEditor(props: EditorProps) {
  const { t } = useText()
  const { component, field, problems, update } = props
  const prop = component.props[field.name]
  const id = `prop-${component.id}-${field.name}`
  const [mode, setMode] = useState<'value' | 'ref'>(prop?.kind === 'ref' ? 'ref' : 'value')
  const effectiveMode = prop?.kind === 'ref' ? 'ref' : mode

  const switcher = field.refable ? (
    <SegmentedControl
      label={t('toolBuilder.editor.prop.mode', { name: t(field.label) })}
      value={effectiveMode}
      options={[
        { value: 'value', label: t('toolBuilder.editor.prop.fixed') },
        { value: 'ref', label: t('toolBuilder.editor.prop.bound') },
      ]}
      onChange={(next) => {
        if (next === null || next === effectiveMode) return
        setMode(next)
        // Back to a fixed value: drop the reference. Into ref mode: nothing is written until a component is chosen.
        if (next === 'value' && prop?.kind === 'ref') update((doc) => setProp(doc, component.id, field.name, undefined))
      }}
      className="[&_button]:h-6 [&_button]:px-2 [&_button]:text-[11px]"
    />
  ) : null

  return (
    <PanelField id={id} label={t(field.label)} problems={problems} aside={switcher} hint={effectiveMode === 'ref' ? t('toolBuilder.editor.prop.boundHint') : undefined}>
      {effectiveMode === 'ref' ? (
        <RefPicker
          id={id}
          doc={props.doc}
          excludeId={component.id}
          value={prop?.kind === 'ref' ? prop.ref : undefined}
          invalid={problems.length > 0}
          onChange={(ref: Ref) => update((doc) => setProp(doc, component.id, field.name, { kind: 'ref', ref }))}
        />
      ) : (
        <ValueEditor {...props} id={id} />
      )}
    </PanelField>
  )
}

function ValueEditor({ id, slug, doc, component, field, problems, update }: EditorProps & { id: string }) {
  const { t } = useText()
  const prop = component.props[field.name]
  const value = valueOf(prop)
  const invalid = problems.length > 0
  /** Writes the value (undefined/'' = unset); `cell` names a keystroke target so typing is one undo step. */
  const set = (next: unknown, cell?: string) =>
    update(
      (d) => setProp(d, component.id, field.name, next === undefined || next === '' ? undefined : { kind: 'value', value: next }),
      cell === undefined ? undefined : { coalesce: `${component.id}.${field.name}.${cell}` }
    )

  switch (field.kind) {
    case 'text':
      return <CompactInput id={id} value={typeof value === 'string' ? value : ''} invalid={invalid} onChange={(event) => set(event.target.value, '')} />
    case 'textarea':
      return (
        <TextArea id={id} value={typeof value === 'string' ? value : ''} invalid={invalid} onChange={(event) => set(event.target.value, '')} className="min-h-20 px-2 text-xs" />
      )
    case 'number':
      return (
        <CompactInput
          id={id}
          type="number"
          inputMode="decimal"
          value={typeof value === 'number' ? String(value) : ''}
          invalid={invalid}
          onChange={(event) => set(event.target.value === '' ? undefined : Number(event.target.value), '')}
        />
      )
    case 'boolean':
      return <Checkbox id={id} checked={value === true} onChange={(checked) => set(checked || undefined)} label={t('toolBuilder.editor.prop.on')} />
    case 'select':
      return (
        <Select
          id={id}
          value={typeof value === 'string' ? value : UNSET}
          invalid={invalid}
          options={[{ value: UNSET, label: t('toolBuilder.editor.prop.default') }, ...(field.choices ?? []).map((choice) => ({ value: choice.value, label: t(choice.label) }))]}
          onChange={(next) => set(next === UNSET ? undefined : next)}
        />
      )
    case 'query':
      return <QueryPicker id={id} slug={slug} doc={doc} value={typeof value === 'string' ? value : undefined} invalid={invalid} onChange={(next) => set(next)} />
    case 'column':
      return <ColumnPicker id={id} component={component} value={typeof value === 'string' ? value : undefined} invalid={invalid} onChange={(next) => set(next, '')} />
    case 'columns':
      return <ColumnsField id={id} component={component} value={arrayOf<ColumnSpec>(prop)} onChange={(next, cell) => set(next.length ? next : undefined, cell)} />
    case 'options':
      return <OptionsEditor id={id} value={arrayOf<OptionSpec>(prop)} onChange={(next, cell) => set(next.length ? next : undefined, cell)} />
    case 'formFields':
      return <FormFieldsEditor id={id} value={arrayOf<FormFieldSpec>(prop)} onChange={(next, cell) => set(next.length ? next : undefined, cell)} />
    case 'tabs':
      return <TabsEditor id={id} value={arrayOf<TabSpec>(prop)} onChange={(next, cell) => set(next.length ? next : undefined, cell)} />
  }
}

/** Read queries of the document (a write query only runs from an action). */
export function QueryPicker({
  id,
  slug,
  doc,
  value,
  invalid,
  onChange,
}: {
  id: string
  slug: string
  doc: Document
  value: string | undefined
  invalid?: boolean
  onChange: (queryId: string | undefined) => void
}) {
  const { t } = useText()
  const reads = doc.queries.filter((query) => query.mode === 'read')
  const current = value ? doc.queries.find((query) => query.id === value) : undefined
  const options = [{ value: UNSET, label: t('toolBuilder.editor.query.none') }, ...reads.map((query) => ({ value: query.id, label: query.name }))]
  if (value && (!current || current.mode !== 'read')) options.push({ value, label: current ? t('toolBuilder.editor.query.notRead', { name: current.name }) : t('toolBuilder.editor.ref.missing', { id: value }) })
  return (
    <div className="flex flex-col gap-1">
      <Select id={id} value={value ?? UNSET} options={options} invalid={invalid} onChange={(next) => onChange(next === UNSET ? undefined : next)} />
      {current ? (
        <p className="flex items-center gap-1.5 text-[11px] text-stone-500">
          <Database aria-hidden className="size-3" />
          <span>{current.sql ? 'SQL' : `HTTP ${current.http?.method ?? ''}`}</span>
          <span>·</span>
          <span>{current.mode === 'read' ? t('toolBuilder.editor.query.read') : t('toolBuilder.editor.query.write')}</span>
          <HrefLink href={paths.editQuery(slug, current.id)} className="ml-auto flex items-center gap-1 text-accent-strong hover:underline">
            {t('toolBuilder.editor.query.edit')}
            <ExternalLink aria-hidden className="size-3" />
          </HrefLink>
        </p>
      ) : reads.length === 0 ? (
        <p className="text-[11px] text-stone-500">
          {t('toolBuilder.editor.query.noneYet')}{' '}
          <HrefLink href={paths.editQueries(slug)} className="text-accent-strong hover:underline">
            {t('toolBuilder.editor.query.create')}
          </HrefLink>
        </p>
      ) : null}
    </div>
  )
}

/** One column of the component's own query result (chart axes, stat value). */
function ColumnPicker({ id, component, value, invalid, onChange }: { id: string; component: Component; value: string | undefined; invalid?: boolean; onChange: (name: string | undefined) => void }) {
  const { t } = useText()
  const run = useQueryState(dataQueryOf(component))
  const columns = run.result?.columns ?? []
  if (columns.length === 0) {
    // No result yet (query not chosen or not run): the name can still be typed.
    return (
      <div className="flex flex-col gap-1">
        <CompactInput id={id} value={value ?? ''} invalid={invalid} placeholder={t('toolBuilder.editor.column.typeName')} onChange={(event) => onChange(event.target.value || undefined)} className="font-mono" />
        <p className="text-[11px] text-stone-500">{t('toolBuilder.editor.column.noResult')}</p>
      </div>
    )
  }
  const options = [{ value: UNSET, label: t('toolBuilder.editor.prop.default') }, ...columns.map((column) => ({ value: column.name, label: `${column.name} · ${column.type}` }))]
  if (value && !columns.some((column) => column.name === value)) options.push({ value, label: t('toolBuilder.editor.column.missing', { name: value }) })
  return <Select id={id} value={value ?? UNSET} options={options} invalid={invalid} onChange={(next) => onChange(next === UNSET ? undefined : next)} />
}

function ColumnsField({ id, component, value, onChange }: { id: string; component: Component; value: ColumnSpec[]; onChange: (next: ColumnSpec[], cell?: string) => void }) {
  const run = useQueryState(dataQueryOf(component))
  return <ColumnsEditor id={id} value={value} onChange={onChange} resultColumns={run.result?.columns} />
}
