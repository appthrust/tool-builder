// Choose a component → one prop it exposes, for any prop that may be a `ref`
// (and for anything else that binds to a component value). Table rows expose
// `selectedRow` and `selectedRow.<column>`, forms `values` and
// `values.<field>`, inputs `value`, tabs `active` (model EXPOSED_PROPS).
import type { Component, Document, Ref } from '../../../model/document'
import { exposedPropsOf } from '../../../model/document'
import { dataQueryOf, type ColumnSpec, type FormFieldSpec } from '../../../model/document.schema'
import { definitionFor } from '../../../renderer/registry'
import { useQueryState } from '../../../renderer/runtime-context'
import { useText } from '../../../i18n'
import { Select } from '../../../ui'
import { componentsOf } from '../canvas/document-ops'

function listValue<T>(component: Component, name: string): T[] {
  const prop = component.props[name]
  return prop?.kind === 'value' && Array.isArray(prop.value) ? (prop.value as T[]) : []
}

/** Every prop path of `component` a ref may name, given the columns its query returned last. */
export function exposedPaths(component: Component, resultColumns: readonly string[]): string[] {
  const heads = exposedPropsOf(component.type)
  if (component.type === 'table') {
    const configured = listValue<ColumnSpec>(component, 'columns').map((column) => column.name)
    const columns = [...new Set([...configured, ...resultColumns])].filter((name) => name !== '')
    return [...heads, ...columns.map((name) => `selectedRow.${name}`)]
  }
  if (component.type === 'form') {
    const fields = listValue<FormFieldSpec>(component, 'fields').map((field) => field.name)
    return [...heads, ...fields.filter((name) => name !== '').map((name) => `values.${name}`)]
  }
  return [...heads]
}

/** Components another component can reference (they expose something); never `excludeId` itself. */
export function referenceableComponents(doc: Document, excludeId?: string): Component[] {
  return componentsOf(doc).filter((component) => component.id !== excludeId && exposedPropsOf(component.type).length > 0)
}

export function RefPicker({
  id,
  doc,
  value,
  onChange,
  excludeId,
  invalid,
}: {
  id: string
  doc: Document
  value: Ref | undefined
  onChange: (ref: Ref) => void
  excludeId?: string
  invalid?: boolean
}) {
  const { t } = useText()
  const candidates = referenceableComponents(doc, excludeId)
  const target = value ? componentsOf(doc).find((component) => component.id === value.component) : undefined
  // A dangling ref (target deleted) stays visible so the author sees what to fix.
  const componentOptions = candidates.map((component) => ({
    value: component.id,
    label: `${component.id} · ${t(definitionFor(component.type)?.label ?? 'toolBuilder.editor.unknownComponent')}`,
  }))
  if (value && !target) componentOptions.push({ value: value.component, label: t('toolBuilder.editor.ref.missing', { id: value.component }) })
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <Select
        id={id}
        aria-label={t('toolBuilder.editor.ref.component')}
        value={value?.component}
        placeholder={t('toolBuilder.editor.ref.chooseComponent')}
        options={componentOptions}
        invalid={invalid}
        onChange={(componentId) => {
          const next = componentsOf(doc).find((component) => component.id === componentId)
          if (!next) return
          onChange({ component: componentId, prop: exposedPropsOf(next.type)[0] ?? '' })
        }}
      />
      {target ? (
        <PropSelect id={`${id}-prop`} target={target} value={value?.prop} invalid={invalid} onChange={(prop) => onChange({ component: target.id, prop })} />
      ) : (
        <Select aria-label={t('toolBuilder.editor.ref.prop')} value={value?.prop} options={value ? [{ value: value.prop || '-', label: value.prop || '-' }] : []} onChange={() => undefined} disabled />
      )}
    </div>
  )
}

function PropSelect({ id, target, value, onChange, invalid }: { id: string; target: Component; value: string | undefined; onChange: (prop: string) => void; invalid?: boolean }) {
  const { t } = useText()
  const run = useQueryState(dataQueryOf(target))
  const resultColumns = run.result ? run.result.columns.map((column) => column.name) : []
  const paths = exposedPaths(target, resultColumns)
  if (value && !paths.includes(value)) paths.push(value)
  return (
    <Select
      id={id}
      aria-label={t('toolBuilder.editor.ref.prop')}
      value={value || undefined}
      placeholder={t('toolBuilder.editor.ref.chooseProp')}
      options={paths.map((path) => ({ value: path, label: path }))}
      invalid={invalid}
      onChange={onChange}
    />
  )
}
