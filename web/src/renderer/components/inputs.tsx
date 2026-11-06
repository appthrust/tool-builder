// Input components that expose `value`: `searchInput` (text, debounced by the
// scheduler), `select` (single → string|null, multiple → string[]), `date`
// (YYYY-MM-DD or null). A one-row-high input carries its label as the
// accessible name and placeholder; taller ones show it above the control.
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { DropdownMenu as RMenu } from 'radix-ui'
import { useId, useMemo, type ReactNode } from 'react'
import { z } from 'zod'
import { useText } from '../../i18n'
import type { Component } from '../../model/document'
import { dataQueryOf, literalProp, optionSchema, type OptionSpec } from '../../model/document.schema'
import { cn, controlClasses, DropdownMenu, DropdownMenuContent, IconButton, Select, TextInput } from '../../ui'
import { rowObjects, useExposed, useQueryResult, useToolRuntime } from '../runtime-context'

/** Label above the control when the cell has room (two rows or more), else only as accessible name. */
function InputFrame({ component, label, htmlFor, children }: { component: Component; label: string; htmlFor: string; children: ReactNode }) {
  const tall = component.layout.h >= 2
  return (
    <div className="flex size-full min-w-0 flex-col justify-end gap-1.5">
      {tall && label ? (
        <label htmlFor={htmlFor} className="truncate text-xs font-medium text-stone-700 dark:text-stone-300">
          {label}
        </label>
      ) : null}
      {children}
    </div>
  )
}

const DARK_CONTROL = 'dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500'

export function SearchInputRuntime({ component }: { component: Component }) {
  const { t } = useText()
  const { runtime } = useToolRuntime()
  const id = useId()
  const value = useExposed(component.id, 'value')
  const text = typeof value === 'string' ? value : ''
  const label = literalProp(component, 'label', z.string()) ?? ''
  const placeholder = literalProp(component, 'placeholder', z.string()) || t('toolBuilder.renderer.type.searchInput')
  const set = (next: string) => runtime.setExposed(component.id, 'value', next)
  return (
    <InputFrame component={component} label={label} htmlFor={id}>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-stone-400" />
        <TextInput
          id={id}
          type="search"
          value={text}
          aria-label={label || placeholder}
          placeholder={placeholder}
          className={cn('pr-9 pl-8 text-[13px] [&::-webkit-search-cancel-button]:hidden', DARK_CONTROL)}
          onChange={(event) => set(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && text !== '') {
              event.preventDefault()
              set('')
            }
          }}
        />
        {text !== '' ? (
          <IconButton label={t('toolBuilder.renderer.search.clear')} icon={<X />} className="absolute top-1/2 right-0.5 -translate-y-1/2" onClick={() => set('')} />
        ) : null}
      </div>
    </InputFrame>
  )
}

/** Static options, or the rows of the select's query (value/label columns, default first/second). */
function useOptions(component: Component): OptionSpec[] {
  const queryId = dataQueryOf(component)
  const state = useQueryResult(queryId)
  const statics = literalProp(component, 'options', z.array(optionSchema))
  const valueColumn = literalProp(component, 'valueColumn', z.string())
  const labelColumn = literalProp(component, 'labelColumn', z.string())
  return useMemo(() => {
    if (queryId && state.result) {
      const columns = state.result.columns.map((column) => column.name)
      const valueKey = valueColumn || columns[0] || ''
      const labelKey = labelColumn || columns[1] || valueKey
      return rowObjects(state.result).map((row) => ({ value: String(row[valueKey] ?? ''), label: String(row[labelKey] ?? row[valueKey] ?? '') }))
    }
    return statics ?? []
  }, [labelColumn, queryId, state.result, statics, valueColumn])
}

const ANY = '\u0000any'

export function SelectRuntime({ component }: { component: Component }) {
  const { t } = useText()
  const { runtime } = useToolRuntime()
  const id = useId()
  const label = literalProp(component, 'label', z.string()) ?? ''
  const placeholder = literalProp(component, 'placeholder', z.string())
  const multiple = literalProp(component, 'multiple', z.boolean()) === true
  const options = useOptions(component).filter((option) => option.value !== '')
  const value = useExposed(component.id, 'value')

  if (multiple) {
    const chosen = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    const summary =
      chosen.length === 0
        ? t('toolBuilder.renderer.select.any')
        : chosen.length <= 2
          ? chosen.map((item) => options.find((option) => option.value === item)?.label ?? item).join(', ')
          : t('toolBuilder.renderer.select.count', { count: chosen.length })
    const toggle = (item: string) => runtime.setExposed(component.id, 'value', chosen.includes(item) ? chosen.filter((other) => other !== item) : [...chosen, item])
    return (
      <InputFrame component={component} label={label} htmlFor={id}>
        <DropdownMenu>
          <RMenu.Trigger
            id={id}
            aria-label={label ? `${label}: ${summary}` : summary}
            className={cn(controlClasses, DARK_CONTROL, 'flex h-10 w-full items-center gap-2 text-left text-[13px] md:h-9')}
          >
            {label && component.layout.h < 2 ? <span className="shrink-0 text-stone-500 dark:text-stone-400">{label}</span> : null}
            <span className={cn('min-w-0 flex-1 truncate', chosen.length === 0 && 'text-stone-500 dark:text-stone-400')}>{summary}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-stone-500" />
          </RMenu.Trigger>
          <DropdownMenuContent align="start" className="dark:border-stone-700 dark:bg-stone-900">
            {options.map((option) => (
              <RMenu.CheckboxItem
                key={option.value}
                checked={chosen.includes(option.value)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggle(option.value)}
                className="relative flex min-h-10 cursor-default items-center rounded-md py-2 pr-2.5 pl-8 text-sm text-stone-700 outline-none select-none md:min-h-0 data-highlighted:bg-stone-100 dark:text-stone-200 dark:data-highlighted:bg-stone-800"
              >
                <RMenu.ItemIndicator className="absolute left-2.5 inline-flex">
                  <Check aria-hidden className="size-4 text-accent" />
                </RMenu.ItemIndicator>
                {option.label || option.value}
              </RMenu.CheckboxItem>
            ))}
            {chosen.length > 0 ? (
              <>
                <RMenu.Separator className="-mx-1 my-1 h-px bg-stone-100 dark:bg-stone-800" />
                <RMenu.Item
                  onSelect={() => runtime.setExposed(component.id, 'value', [])}
                  className="flex min-h-10 cursor-default items-center rounded-md px-2.5 py-2 text-sm text-stone-600 outline-none select-none md:min-h-0 data-highlighted:bg-stone-100 dark:text-stone-300 dark:data-highlighted:bg-stone-800"
                >
                  {t('toolBuilder.renderer.select.clear')}
                </RMenu.Item>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </InputFrame>
    )
  }

  const current = typeof value === 'string' && value !== '' ? value : undefined
  return (
    <InputFrame component={component} label={label} htmlFor={id}>
      <Select
        id={id}
        aria-label={label || undefined}
        value={current}
        onChange={(next) => runtime.setExposed(component.id, 'value', next === ANY ? null : next)}
        placeholder={placeholder || (component.layout.h < 2 && label ? label : t('toolBuilder.renderer.select.any'))}
        options={[
          ...(current ? [{ value: ANY, label: t('toolBuilder.renderer.select.any') }] : []),
          ...options.map((option) => ({ value: option.value, label: option.label || option.value })),
        ]}
        className={cn('text-[13px]', DARK_CONTROL)}
      />
    </InputFrame>
  )
}

export function DateRuntime({ component }: { component: Component }) {
  const { t } = useText()
  const { runtime } = useToolRuntime()
  const id = useId()
  const label = literalProp(component, 'label', z.string()) ?? ''
  const value = useExposed(component.id, 'value')
  const text = typeof value === 'string' ? value : ''
  return (
    <InputFrame component={component} label={label} htmlFor={id}>
      <div className="relative">
        <TextInput
          id={id}
          type="date"
          value={text}
          aria-label={label || t('toolBuilder.renderer.type.date')}
          className={cn('pr-9 text-[13px] tabular-nums', DARK_CONTROL)}
          onChange={(event) => runtime.setExposed(component.id, 'value', event.target.value === '' ? null : event.target.value)}
        />
        {text !== '' ? (
          <IconButton
            label={t('toolBuilder.renderer.date.clear')}
            icon={<X />}
            className="absolute top-1/2 right-6 -translate-y-1/2"
            onClick={() => runtime.setExposed(component.id, 'value', null)}
          />
        ) : null}
      </div>
    </InputFrame>
  )
}
