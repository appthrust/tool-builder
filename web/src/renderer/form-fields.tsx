// The fields of a `form` component, bound to its exposed `values`. Used by the
// form itself and by an action's dialog when the action takes its input from
// that form (`action.input.formComponent`).
import { useEffect, useId, useState } from 'react'
import { z } from 'zod'
import { useText, type Translate } from '../i18n'
import type { Component } from '../model/document'
import { formFieldSchema, literalProp, type FormFieldSpec } from '../model/document.schema'
import { cn, Field, Select, TextArea, TextInput } from '../ui'
import { useExposed, useToolRuntime } from './runtime-context'

export const formFieldsOf = (form: Component): FormFieldSpec[] => literalProp(form, 'fields', z.array(formFieldSchema)) ?? []

const isBlank = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/** Field name → error text for required fields left blank and numbers that do not parse. */
export function validateFormValues(fields: FormFieldSpec[], values: Record<string, unknown>, t: Translate): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const value = values[field.name]
    if (field.required && field.type !== 'boolean' && isBlank(value)) errors[field.name] = t('toolBuilder.renderer.form.required')
    else if (field.type === 'number' && typeof value === 'string') errors[field.name] = t('toolBuilder.renderer.form.number')
  }
  return errors
}

/** Values with every field reset to unset (booleans to false). */
export function emptyFormValues(fields: FormFieldSpec[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.name, field.type === 'boolean' ? false : null]))
}

export function FormFields({ form, errors, compact = false }: { form: Component; errors: Record<string, string>; compact?: boolean }) {
  const { runtime } = useToolRuntime()
  const exposed = useExposed(form.id, 'values')
  const values = exposed && typeof exposed === 'object' ? (exposed as Record<string, unknown>) : {}
  const fields = formFieldsOf(form)
  const set = (name: string, value: unknown) => runtime.setExposed(form.id, 'values', { ...values, [name]: value })
  return (
    <div className={cn('grid gap-3', compact && 'gap-2.5')}>
      {fields.map((field) => (
        <FormField key={field.name} field={field} value={values[field.name]} error={errors[field.name]} onChange={(value) => set(field.name, value)} />
      ))}
    </div>
  )
}

function FormField({ field, value, error, onChange }: { field: FormFieldSpec; value: unknown; error?: string; onChange: (value: unknown) => void }) {
  const { t } = useText()
  const id = useId()
  const label = field.label || field.name
  if (field.type === 'boolean') {
    return (
      <label className="flex min-h-10 items-center gap-2 text-sm text-stone-800 md:min-h-8 dark:text-stone-200">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-(--color-accent)" />
        {label}
      </label>
    )
  }
  return (
    <Field id={id} label={label} required={field.required} error={error}>
      {field.type === 'textarea' ? (
        <TextArea
          id={id}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          invalid={Boolean(error)}
          className="min-h-20"
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        />
      ) : field.type === 'select' ? (
        <Select
          id={id}
          value={typeof value === 'string' && value !== '' ? value : undefined}
          onChange={(next) => onChange(next)}
          options={(field.options ?? []).filter((option) => option.value !== '').map((option) => ({ value: option.value, label: option.label || option.value }))}
          placeholder={field.placeholder || t('toolBuilder.renderer.form.choose')}
          invalid={Boolean(error)}
        />
      ) : field.type === 'number' ? (
        <NumberInput id={id} value={value} placeholder={field.placeholder} invalid={Boolean(error)} onChange={onChange} />
      ) : (
        <TextInput
          id={id}
          type={field.type === 'date' ? 'date' : 'text'}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        />
      )}
    </Field>
  )
}

/**
 * Keeps the typed text locally so partial input (`1.`, `-`) survives; exposes
 * a number when it parses, null when empty, and the raw text otherwise (which
 * validation reports as "enter a number").
 */
function NumberInput({ id, value, placeholder, invalid, onChange }: { id: string; value: unknown; placeholder?: string; invalid: boolean; onChange: (value: unknown) => void }) {
  const [text, setText] = useState(() => (typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''))
  useEffect(() => {
    // An outside reset (after a successful action) clears the box.
    if (value === null || value === undefined) setText('')
    else if (typeof value === 'number' && Number(text) !== value) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only outside changes of `value` resync the text
  }, [value])
  return (
    <TextInput
      id={id}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      invalid={invalid}
      className="tabular-nums"
      onChange={(event) => {
        const next = event.target.value
        setText(next)
        const trimmed = next.trim()
        const number = Number(trimmed)
        onChange(trimmed === '' ? null : Number.isFinite(number) ? number : next)
      }}
    />
  )
}
