// Editors for the list-valued props: table/detail columns, select options,
// form fields, tabs. Each edits the whole array value; rows reorder with
// up/down buttons (keyboard reachable), and typing into one cell is one undo
// step (`coalesce` key per cell).
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { Column } from '../../../api/types'
import type { MessageId } from '../../../copy'
import {
  COLUMN_FORMATS,
  FIELD_TYPES,
  type ColumnSpec,
  type FormFieldSpec,
  type OptionSpec,
  type TabSpec,
} from '../../../model/document.schema'
import { useText } from '../../../i18n'
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, IconButton, Select } from '../../../ui'
import { Checkbox, CompactInput, UNSET } from './controls'

/** `onChange(next, cellKey)`: `cellKey` names the edited cell so keystrokes coalesce into one undo step. */
type ListChange<T> = (next: T[], cellKey?: string) => void

function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by
  if (target < 0 || target >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[target]] = [next[target] as T, next[index] as T]
  return next
}

function RowTools<T>({ list, index, onChange, label }: { list: readonly T[]; index: number; onChange: ListChange<T>; label: string }) {
  const { t } = useText()
  return (
    <span className="flex shrink-0 items-center">
      <IconButton
        label={t('toolBuilder.editor.list.moveUp', { name: label })}
        icon={<ArrowUp />}
        disabled={index === 0}
        onClick={() => onChange(moved(list, index, -1))}
        className="size-7 md:size-7 md:w-7"
      />
      <IconButton
        label={t('toolBuilder.editor.list.moveDown', { name: label })}
        icon={<ArrowDown />}
        disabled={index === list.length - 1}
        onClick={() => onChange(moved(list, index, 1))}
        className="size-7 md:size-7 md:w-7"
      />
      <IconButton
        label={t('toolBuilder.editor.list.remove', { name: label })}
        icon={<Trash2 />}
        onClick={() => onChange(list.filter((_, i) => i !== index))}
        className="size-7 md:size-7 md:w-7"
      />
    </span>
  )
}

/** `base1`, `base2`, … not yet in `taken`. */
function freshName(base: string, taken: readonly string[]): string {
  for (let n = 1; ; n++) if (!taken.includes(`${base}${n}`)) return `${base}${n}`
}

export function ColumnsEditor({
  id,
  value,
  onChange,
  resultColumns,
}: {
  id: string
  value: ColumnSpec[]
  onChange: ListChange<ColumnSpec>
  /** Columns of the bound query's last result; "Add" offers the ones not shown yet. */
  resultColumns: readonly Column[] | undefined
}) {
  const { t } = useText()
  const [custom, setCustom] = useState('')
  const shown = new Set(value.map((column) => column.name))
  const addable = (resultColumns ?? []).filter((column) => !shown.has(column.name))
  const formatOptions = [{ value: UNSET, label: t('toolBuilder.editor.columns.formatAuto') }, ...COLUMN_FORMATS.map((format) => ({ value: format, label: t(`toolBuilder.renderer.format.${format}`) }))]
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 ? <p className="text-[11px] text-stone-500">{t('toolBuilder.editor.columns.empty')}</p> : null}
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-md border border-stone-200 dark:divide-stone-800 dark:border-stone-700">
        {value.map((column, index) => (
          <li key={`${column.name}:${index}`} className="flex flex-col gap-1.5 px-2 py-2">
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-stone-800 dark:text-stone-200" title={column.name}>
                {column.name}
              </span>
              <RowTools list={value} index={index} onChange={onChange} label={column.name} />
            </div>
            <div className="grid grid-cols-[1fr_7.5rem] gap-1.5">
              <CompactInput
                id={`${id}-${index}-label`}
                aria-label={t('toolBuilder.editor.columns.label', { name: column.name })}
                placeholder={column.name}
                value={column.label ?? ''}
                onChange={(event) => {
                  const label = event.target.value
                  onChange(
                    value.map((c, i) => (i === index ? withOptional(c, 'label', label === '' ? undefined : label) : c)),
                    `${index}.label`
                  )
                }}
              />
              <Select
                aria-label={t('toolBuilder.editor.columns.formatOf', { name: column.name })}
                value={column.format ?? UNSET}
                options={formatOptions}
                onChange={(format) =>
                  onChange(value.map((c, i) => (i === index ? withOptional(c, 'format', format === UNSET ? undefined : (format as ColumnSpec['format'])) : c)))
                }
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-1.5">
        {resultColumns && resultColumns.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" icon={<Plus />} disabled={addable.length === 0}>
                {t('toolBuilder.editor.columns.add')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {addable.map((column) => (
                <DropdownMenuItem key={column.name} onSelect={() => onChange([...value, { name: column.name }])}>
                  <span className="font-mono text-xs">{column.name}</span>
                  <span className="ml-auto pl-4 text-[11px] text-stone-500">{column.type}</span>
                </DropdownMenuItem>
              ))}
              {addable.length > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onChange([...value, ...addable.map((column) => ({ name: column.name }))])}>
                    {t('toolBuilder.editor.columns.addAll', { count: addable.length })}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <form
          className="flex min-w-0 flex-1 items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            const name = custom.trim()
            if (!name || shown.has(name)) return
            onChange([...value, { name }])
            setCustom('')
          }}
        >
          <CompactInput
            aria-label={t('toolBuilder.editor.column.typeName')}
            placeholder={t('toolBuilder.editor.column.typeName')}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            className="font-mono"
          />
          <Button size="sm" type="submit" disabled={custom.trim() === '' || shown.has(custom.trim())}>
            {t('toolBuilder.editor.list.add')}
          </Button>
        </form>
      </div>
      {resultColumns === undefined ? <p className="text-[11px] text-stone-500">{t('toolBuilder.editor.columns.noResult')}</p> : null}
    </div>
  )
}

/** Sets or (undefined) removes an optional key, so unset stays absent in the document. */
function withOptional<T extends object, K extends keyof T>(item: T, key: K, next: T[K] | undefined): T {
  if (next !== undefined) return { ...item, [key]: next }
  const copy = { ...item }
  delete copy[key]
  return copy
}

export function OptionsEditor({ id, value, onChange }: { id: string; value: OptionSpec[]; onChange: ListChange<OptionSpec> }) {
  const { t } = useText()
  return (
    <div className="flex flex-col gap-1.5">
      {value.length > 0 ? (
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-x-1.5 gap-y-1 text-[10px] font-medium text-stone-500">
          <span>{t('toolBuilder.editor.ref.prop')}</span>
          <span>{t('toolBuilder.renderer.field.label')}</span>
          <span />
          {value.map((option, index) => (
            <OptionRow key={index} id={`${id}-${index}`} list={value} index={index} option={option} onChange={onChange} />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-stone-500">{t('toolBuilder.editor.options.empty')}</p>
      )}
      <Button
        size="sm"
        icon={<Plus />}
        className="self-start"
        onClick={() => {
          const valueName = freshName('option', value.map((option) => option.value))
          onChange([...value, { value: valueName, label: valueName }])
        }}
      >
        {t('toolBuilder.editor.options.add')}
      </Button>
    </div>
  )
}

function OptionRow({ id, list, index, option, onChange }: { id: string; list: OptionSpec[]; index: number; option: OptionSpec; onChange: ListChange<OptionSpec> }) {
  const { t } = useText()
  const set = (patch: Partial<OptionSpec>, cell: string) => onChange(list.map((o, i) => (i === index ? { ...o, ...patch } : o)), `${index}.${cell}`)
  return (
    <>
      <CompactInput id={`${id}-value`} aria-label={t('toolBuilder.editor.options.valueOf', { n: index + 1 })} value={option.value} onChange={(event) => set({ value: event.target.value }, 'value')} className="font-mono" />
      <CompactInput id={`${id}-label`} aria-label={t('toolBuilder.editor.options.labelOf', { n: index + 1 })} value={option.label} onChange={(event) => set({ label: event.target.value }, 'label')} />
      <RowTools list={list} index={index} onChange={onChange} label={option.label || option.value} />
    </>
  )
}

/** Field types reuse the renderer's names where one exists (the catalogs allow one id per English text). */
const FIELD_TYPE_LABEL = {
  text: 'toolBuilder.renderer.type.text',
  number: 'toolBuilder.renderer.format.number',
  boolean: 'toolBuilder.editor.fields.type.boolean',
  date: 'toolBuilder.renderer.type.date',
  select: 'toolBuilder.renderer.type.select',
  textarea: 'toolBuilder.editor.fields.type.textarea',
} as const satisfies Record<FormFieldSpec['type'], MessageId>

export function FormFieldsEditor({ id, value, onChange }: { id: string; value: FormFieldSpec[]; onChange: ListChange<FormFieldSpec> }) {
  const { t } = useText()
  const typeOptions = FIELD_TYPES.map((type) => ({ value: type, label: t(FIELD_TYPE_LABEL[type]) }))
  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 ? <p className="text-[11px] text-stone-500">{t('toolBuilder.editor.fields.empty')}</p> : null}
      <ul className="flex flex-col gap-2">
        {value.map((field, index) => {
          const set = (patch: Partial<FormFieldSpec>, cell?: string) =>
            onChange(
              value.map((f, i) => (i === index ? { ...f, ...patch } : f)),
              cell ? `${index}.${cell}` : undefined
            )
          const rowId = `${id}-${index}`
          return (
            <li key={index} className="flex flex-col gap-1.5 rounded-md border border-stone-200 p-2 dark:border-stone-700">
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-stone-800 dark:text-stone-200">{field.name || '—'}</span>
                <RowTools list={value} index={index} onChange={onChange} label={field.label || field.name} />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <CompactInput
                  id={`${rowId}-name`}
                  aria-label={t('toolBuilder.editor.fields.name')}
                  placeholder={t('toolBuilder.editor.fields.name')}
                  value={field.name}
                  invalid={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name)}
                  onChange={(event) => set({ name: event.target.value }, 'name')}
                  className="font-mono"
                />
                <CompactInput
                  id={`${rowId}-label`}
                  aria-label={t('toolBuilder.renderer.field.label')}
                  placeholder={t('toolBuilder.renderer.field.label')}
                  value={field.label ?? ''}
                  onChange={(event) => onChange(value.map((f, i) => (i === index ? withOptional(f, 'label', event.target.value || undefined) : f)), `${index}.label`)}
                />
                <Select aria-label={t('toolBuilder.editor.fields.typeLabel')} value={field.type} options={typeOptions} onChange={(type) => set({ type: type as FormFieldSpec['type'] })} />
                <CompactInput
                  id={`${rowId}-placeholder`}
                  aria-label={t('toolBuilder.renderer.field.placeholder')}
                  placeholder={t('toolBuilder.renderer.field.placeholder')}
                  value={field.placeholder ?? ''}
                  onChange={(event) => onChange(value.map((f, i) => (i === index ? withOptional(f, 'placeholder', event.target.value || undefined) : f)), `${index}.placeholder`)}
                />
              </div>
              <Checkbox id={`${rowId}-required`} checked={field.required ?? false} onChange={(required) => onChange(value.map((f, i) => (i === index ? withOptional(f, 'required', required || undefined) : f)))} label={t('toolBuilder.common.required')} />
              {field.type === 'select' ? (
                <div className="border-t border-stone-100 pt-1.5 dark:border-stone-800">
                  <p className="mb-1 text-[11px] font-medium text-stone-600 dark:text-stone-400">{t('toolBuilder.renderer.field.options')}</p>
                  <OptionsEditor id={`${rowId}-options`} value={field.options ?? []} onChange={(options, cell) => onChange(value.map((f, i) => (i === index ? { ...f, options } : f)), cell ? `${index}.options.${cell}` : undefined)} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <Button
        size="sm"
        icon={<Plus />}
        className="self-start"
        onClick={() => onChange([...value, { name: freshName('field', value.map((field) => field.name)), type: 'text' }])}
      >
        {t('toolBuilder.editor.fields.add')}
      </Button>
    </div>
  )
}

export function TabsEditor({ id, value, onChange }: { id: string; value: TabSpec[]; onChange: ListChange<TabSpec> }) {
  const { t } = useText()
  const hintId = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1">
        {value.map((tab, index) => (
          <li key={tab.id} className="flex items-center gap-1.5">
            <span className="w-12 shrink-0 truncate font-mono text-[10px] text-stone-500" title={tab.id}>
              {tab.id}
            </span>
            <CompactInput
              id={`${id}-${index}`}
              aria-label={t('toolBuilder.editor.tabs.labelOf', { id: tab.id })}
              aria-describedby={hintId}
              value={tab.label}
              onChange={(event) => onChange(value.map((x, i) => (i === index ? { ...x, label: event.target.value } : x)), `${index}.label`)}
            />
            <RowTools list={value} index={index} onChange={onChange} label={tab.label || tab.id} />
          </li>
        ))}
      </ul>
      <p id={hintId} className="text-[11px] text-stone-500">
        {t('toolBuilder.editor.tabs.hint')}
      </p>
      <Button
        size="sm"
        icon={<Plus />}
        className="self-start"
        onClick={() => {
          const tabId = freshName('tab', value.map((tab) => tab.id))
          onChange([...value, { id: tabId, label: t('toolBuilder.editor.tabs.newLabel', { n: value.length + 1 }) }])
        }}
      >
        {t('toolBuilder.editor.tabs.add')}
      </Button>
    </div>
  )
}
