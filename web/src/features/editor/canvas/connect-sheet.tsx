// The Connect sheet: opened when an output port is dropped on a component.
// It offers what `connectOptions` finds (a parameter of the target's query,
// a structured filter on it, a refable prop, or a new placeholder in the
// query) and writes the choice through the draft store. A placeholder is
// never spliced into query text here: the sheet hands the name to the query
// editor, where the author puts it (values reach SQL only as bound
// parameters, design D4). A filter adds `Query.filters[]` plus its param and
// binds that param to the source; the server composes the SQL.
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Link2 } from 'lucide-react'
import { RadioGroup } from 'radix-ui'
import { useId, useState, type ReactNode } from 'react'
import { useText } from '../../../i18n'
import type { Component, Document, Filter, FilterOp, ParamType, Ref } from '../../../model/document'
import { dataQueryOf } from '../../../model/document.schema'
import { useQueryState } from '../../../renderer/runtime-context'
import { paths } from '../../../routes/paths'
import { Button, cn, Dialog, Field, Notice, Select } from '../../../ui'
import type { Update } from '../properties/prop-editors'
import { exposedPaths } from '../properties/ref-picker'
import { addFilter, filterAcceptsType } from '../queries/filter-ops'
import { FilterFields } from '../queries/filters-section'
import { refKey } from '../queries/placeholders'
import { connectOptions, type ConnectOption, type ConnectRequest } from './connect-options'
import { bindParam, findComponent, setProp } from './document-ops'

export type { ConnectRequest } from './connect-options'

/** Heads whose value is a record the author may narrow to one field (`selectedRow.<column>`, `values.<field>`). */
const REFINABLE_HEADS = ['selectedRow', 'values']

/** Stable id of an option inside the radio group. */
export function optionKey(option: ConnectOption): string {
  switch (option.kind) {
    case 'param':
      return `param:${option.queryId}:${option.param.name}`
    case 'filter':
      return `filter:${option.queryId}`
    case 'prop':
      return `prop:${option.prop}`
    case 'placeholder':
      return `placeholder:${option.queryId}`
    case 'noQuery':
      return 'noQuery'
  }
}

type FilterDraft = Omit<Filter, 'param'>

/**
 * The param type a filter bound to `source.path` gets: a date picker binds a
 * date, a multiple select a text list, everything else text (a column value,
 * a search string, a form field). The author can retype it in the query editor.
 */
export function filterParamType(source: Component | undefined, path: string): ParamType {
  if (!source) return 'text'
  if (source.type === 'date' && path === 'value') return 'date'
  const multiple = source.props.multiple
  if (source.type === 'select' && path === 'value' && multiple?.kind === 'value' && multiple.value === true) return 'textList'
  return 'text'
}

/** First filter the sheet proposes for a source of `type`: list → `in`, text → `contains`, else `eq`. */
export function initialFilter(type: ParamType): FilterDraft {
  const op: FilterOp = type === 'textList' || type === 'numberList' ? 'in' : type === 'text' ? 'contains' : 'eq'
  return { column: '', op, skipWhenEmpty: true }
}

const FILTER_OPS_ALL: readonly FilterOp[] = ['eq', 'neq', 'contains', 'gte', 'lte', 'in']

/** Where the query editor opens to insert `{{ name }}` (the queries page reads `insert`). */
export function placeholderHref(slug: string, queryId: string, name: string): string {
  return `${paths.editQuery(slug, queryId)}?insert=${encodeURIComponent(name)}`
}

const sameRef = (a: Ref | undefined, b: Ref) => a !== undefined && a.component === b.component && a.prop === b.prop

/** The option the sheet starts on: an unbound parameter, else anything that would change, else the first. */
function initialKey(options: readonly ConnectOption[], ref: Ref, doc: Document, targetId: string): string | undefined {
  const actionable = options.filter((option) => option.kind !== 'noQuery')
  const changes = (option: ConnectOption) =>
    option.kind === 'param' ? !sameRef(option.boundTo, ref) : option.kind === 'prop' ? !isPropBoundTo(doc, targetId, option.prop, ref) : true
  const pick = actionable.find((option) => option.kind === 'param' && !option.boundTo) ?? actionable.find(changes) ?? actionable[0]
  return pick ? optionKey(pick) : undefined
}

function isPropBoundTo(doc: Document, targetId: string, prop: string, ref: Ref): boolean {
  const current = findComponent(doc, targetId)?.props[prop]
  return current?.kind === 'ref' && sameRef(current.ref, ref)
}

export function ConnectSheet({
  slug,
  doc,
  request,
  onClose,
  update,
}: {
  slug: string
  doc: Document
  request: ConnectRequest | null
  onClose: () => void
  update: Update
}) {
  // Keep the last request after closing so the dialog does not empty while it
  // closes; every new request (a new drop) starts with fresh choices.
  const [shown, setShown] = useState({ request, drop: 0 })
  if (request && request !== shown.request) setShown({ request, drop: shown.drop + 1 })
  if (!shown.request) return <></>
  return <ConnectDialog key={shown.drop} slug={slug} doc={doc} request={shown.request} open={request !== null} onClose={onClose} update={update} />
}

function ConnectDialog({
  slug,
  doc,
  request,
  open,
  onClose,
  update,
}: {
  slug: string
  doc: Document
  request: ConnectRequest
  open: boolean
  onClose: () => void
  update: Update
}) {
  const { t } = useText()
  const navigate = useNavigate()
  const id = useId()
  const source = findComponent(doc, request.from.component)
  const run = useQueryState(source ? dataQueryOf(source) : undefined)
  const resultColumns = run.result ? run.result.columns.map((column) => column.name) : []
  const refinable = source !== undefined && REFINABLE_HEADS.includes(request.from.prop)
  const pathChoices = refinable ? exposedPaths(source, resultColumns).filter((path) => path === request.from.prop || path.startsWith(`${request.from.prop}.`)) : []
  const [path, setPath] = useState(request.from.prop)
  const ref: Ref = { component: request.from.component, prop: path }
  const options = connectOptions(doc, request)
  const [selectedKey, setSelectedKey] = useState(() => initialKey(options, ref, doc, request.targetId))
  const selected = options.find((option) => optionKey(option) === selectedKey)
  // The filter's column suggestions come from the target query's last draft run.
  const filterOption = options.find((option) => option.kind === 'filter')
  const targetRun = useQueryState(filterOption?.queryId)
  const targetColumns = targetRun.result ? targetRun.result.columns.map((column) => column.name) : []
  const filterType = filterParamType(source, path)
  const [filter, setFilter] = useState<FilterDraft>(() => initialFilter(filterType))
  const filterReady = filter.column.trim() !== '' && filterAcceptsType(filter.op, filterType)

  const connect = () => {
    if (!selected) return
    switch (selected.kind) {
      case 'param':
        update((d) => bindParam(d, selected.queryId, selected.param.name, ref))
        break
      case 'filter': {
        if (!filterReady) return
        // One undo step: the filter, its param, and the binding of that param to the source.
        update((d) => {
          const withFilter = addFilter(d, selected.queryId, { ...filter, column: filter.column.trim(), type: filterType })
          const added = withFilter.queries.find((query) => query.id === selected.queryId)?.filters?.at(-1)
          return added ? bindParam(withFilter, selected.queryId, added.param, ref) : d
        })
        break
      }
      case 'prop':
        update((d) => setProp(d, request.targetId, selected.prop, { kind: 'ref', ref }))
        break
      case 'placeholder':
        void navigate({ href: placeholderHref(slug, selected.queryId, selected.suggestedName) })
        break
      case 'noQuery':
        break
    }
    onClose()
  }

  const filterFields = filterOption ? (
    <FilterFields value={filter} onChange={setFilter} columns={targetColumns} disabledOps={FILTER_OPS_ALL.filter((op) => !filterAcceptsType(op, filterType))} />
  ) : undefined

  const actionable = options.some((option) => option.kind !== 'noQuery')
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      size="lg"
      title={t('toolBuilder.connect.title', { from: request.from.component, to: request.targetId })}
      description={actionable ? t('toolBuilder.connect.description') : undefined}
      footer={
        actionable ? (
          <>
            <Button onClick={onClose}>{t('toolBuilder.common.cancel')}</Button>
            <Button tone="primary" onClick={connect} disabled={!selected || selected.kind === 'noQuery' || (selected.kind === 'filter' && !filterReady)}>
              {selected?.kind === 'placeholder' ? t('toolBuilder.connect.openQuery') : t('toolBuilder.connect.submit')}
            </Button>
          </>
        ) : (
          <Button tone="primary" onClick={onClose}>
            {t('toolBuilder.common.close')}
          </Button>
        )
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{t('toolBuilder.connect.source')}</p>
            <p className="mt-1 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-xs text-accent-strong ring-1 ring-accent-line ring-inset">
                <Link2 aria-hidden className="size-3" />
                {refKey(ref)}
              </span>
              <ArrowRight aria-hidden className="size-3.5 text-stone-400" />
              <span className="font-mono text-xs text-stone-700 dark:text-stone-300">{request.targetId}</span>
            </p>
          </div>
          {pathChoices.length > 1 ? (
            <Field id={`${id}-path`} label={t('toolBuilder.connect.path')} className="min-w-48 flex-1">
              <Select id={`${id}-path`} value={path} onChange={setPath} options={pathChoices.map((choice) => ({ value: choice, label: <span className="font-mono text-xs">{choice}</span> }))} />
            </Field>
          ) : null}
        </div>
        <ConnectOptionList
          name={`${id}-option`}
          doc={doc}
          request={request}
          sourceRef={ref}
          options={options}
          value={selectedKey}
          onChange={setSelectedKey}
          filterFields={filterFields}
        />
      </div>
    </Dialog>
  )
}

type Row = { key: string; title: ReactNode; description?: ReactNode; tone?: 'warning'; detail?: ReactNode }
type Group = { id: 'params' | 'filter' | 'props' | 'query'; label: string; rows: Row[] }

/**
 * The choices as one radio group in sheet order: the target query's
 * parameters, the structured filter (with `filterFields` under it while
 * selected), refable props, then the placeholder. Exported for the
 * static-render test (the Dialog itself renders in a portal).
 */
export function ConnectOptionList({
  name,
  doc,
  request,
  sourceRef,
  options,
  value,
  onChange,
  filterFields,
}: {
  name: string
  doc: Document
  request: ConnectRequest
  sourceRef: Ref
  options: readonly ConnectOption[]
  value: string | undefined
  onChange: (key: string) => void
  /** The filter's column/operator controls, shown under the filter row while it is selected. */
  filterFields?: ReactNode
}) {
  const { t } = useText()
  if (options.length === 0) return <Notice>{t('toolBuilder.connect.nothing', { from: request.from.component, to: request.targetId })}</Notice>

  const target = findComponent(doc, request.targetId)
  const params = options.filter((option) => option.kind === 'param')
  const filters = options.filter((option) => option.kind === 'filter')
  const props = options.filter((option) => option.kind === 'prop')
  const placeholders = options.filter((option) => option.kind === 'placeholder')
  const paramGroup: Group | undefined = params[0]
    ? {
        id: 'params',
        label: t('toolBuilder.connect.paramsGroup', { query: params[0].queryName }),
        rows: params.map((option) => ({
          key: optionKey(option),
          title: <span className="font-mono">{`{{ ${option.param.name} }}`}</span>,
          ...(option.boundTo === undefined
            ? { description: t('toolBuilder.connect.param.unbound') }
            : sameRef(option.boundTo, sourceRef)
              ? { description: t('toolBuilder.connect.param.same') }
              : { description: t('toolBuilder.connect.replaces', { current: refKey(option.boundTo) }), tone: 'warning' as const }),
        })),
      }
    : undefined
  const filterGroup: Group | undefined = filters[0]
    ? {
        id: 'filter',
        label: t('toolBuilder.connect.filterGroup'),
        rows: filters.map((option) => ({
          key: optionKey(option),
          title: t('toolBuilder.connect.filter', { query: option.queryName }),
          description: t('toolBuilder.connect.filter.hint'),
          detail: filterFields,
        })),
      }
    : undefined
  const propGroup: Group | undefined = props[0]
    ? {
        id: 'props',
        label: t('toolBuilder.connect.propsGroup', { component: request.targetId }),
        rows: props.map((option) => {
          const current = target?.props[option.prop]
          const hasValue = current?.kind === 'value' && current.value !== undefined && current.value !== null && current.value !== ''
          return {
            key: optionKey(option),
            title: t(option.label),
            ...(current?.kind === 'ref'
              ? sameRef(current.ref, sourceRef)
                ? { description: t('toolBuilder.connect.param.same') }
                : { description: t('toolBuilder.connect.replaces', { current: refKey(current.ref) }), tone: 'warning' as const }
              : hasValue
                ? { description: t('toolBuilder.connect.replacesValue'), tone: 'warning' as const }
                : {}),
          }
        }),
      }
    : undefined
  const queryGroup: Group | undefined = placeholders[0]
    ? {
        id: 'query',
        label: t('toolBuilder.connect.queryGroup'),
        rows: placeholders.map((option) => ({
          key: optionKey(option),
          title: t('toolBuilder.connect.placeholder', { placeholder: `{{ ${option.suggestedName} }}`, query: option.queryName }),
          description: t('toolBuilder.connect.placeholder.hint'),
        })),
      }
    : undefined

  return (
    <div className="space-y-4">
      {options.some((option) => option.kind === 'noQuery') ? <Notice tone="warning">{t('toolBuilder.connect.noQuery', { to: request.targetId })}</Notice> : null}
      <RadioGroup.Root name={name} value={value ?? ''} onValueChange={onChange} aria-label={t('toolBuilder.connect.choose')} className="space-y-4">
        {paramGroup ? <OptionGroup group={paramGroup} name={name} value={value} /> : null}
        {filterGroup ? <OptionGroup group={filterGroup} name={name} value={value} /> : null}
        {propGroup ? <OptionGroup group={propGroup} name={name} value={value} /> : null}
        {queryGroup ? <OptionGroup group={queryGroup} name={name} value={value} /> : null}
      </RadioGroup.Root>
    </div>
  )
}

function OptionGroup({ group, name, value }: { group: Group; name: string; value: string | undefined }) {
  const labelId = `${name}-${group.id}`
  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">
        {group.label}
      </p>
      <div className="mt-2 grid gap-2">
        {group.rows.map((row) => {
          const selected = row.key === value
          return (
            <div key={row.key} className="grid gap-2">
              <RadioGroup.Item
                value={row.key}
                data-option={row.key}
                className={cn(
                  'flex w-full min-w-0 items-start gap-3 rounded-lg border bg-white px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:bg-stone-900',
                  selected ? 'border-accent bg-accent-soft/40 ring-1 ring-accent' : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800'
                )}
              >
                <span aria-hidden className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-accent' : 'border-stone-400 dark:border-stone-500')}>
                  {selected ? <span className="size-2 rounded-full bg-accent" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-stone-900 dark:text-stone-100">{row.title}</span>
                  {row.description ? (
                    <span className={cn('mt-0.5 block text-xs', row.tone === 'warning' ? 'text-busy-ink' : 'text-stone-500 dark:text-stone-400')}>{row.description}</span>
                  ) : null}
                </span>
              </RadioGroup.Item>
              {/* Form controls live outside the radio button (a button cannot contain inputs). */}
              {selected && row.detail ? <div className="ml-7 rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-900">{row.detail}</div> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
