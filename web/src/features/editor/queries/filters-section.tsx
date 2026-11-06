import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { MessageId } from '../../../copy'
import { useText } from '../../../i18n'
import { FILTER_OPS, type Filter, type FilterOp, type Query } from '../../../model/document'
import { Badge, Button, Field, IconButton, Select } from '../../../ui'
import type { Draft } from '../draft-store'
import { addFilter, effectiveSql, filterAcceptsType, removeFilter, updateFilter } from './filter-ops'
import { CommitInput } from './params-panel'

const OP_LABEL: Record<FilterOp, MessageId> = {
  eq: 'toolBuilder.filters.op.eq',
  neq: 'toolBuilder.filters.op.neq',
  contains: 'toolBuilder.filters.op.contains',
  gte: 'toolBuilder.filters.op.gte',
  lte: 'toolBuilder.filters.op.lte',
  in: 'toolBuilder.filters.op.in',
}

/** Shared with the canvas Connect sheet; does not mutate a document. */
export function FilterFields({ value, onChange, columns, disabledOps = [] }: {
  value: Omit<Filter, 'param'>
  onChange: (value: Omit<Filter, 'param'>) => void
  columns: readonly string[]
  disabledOps?: readonly FilterOp[]
}) {
  const { t } = useText()
  const id = useId()
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-column`} label={t('toolBuilder.filters.column')} hint={columns.length === 0 ? t('toolBuilder.filters.columnHint') : undefined}>
          <CommitInput id={`${id}-column`} value={value.column} onCommit={(column) => onChange({ ...value, column })} list={`${id}-columns`} />
          <datalist id={`${id}-columns`}>
            {[...new Set(columns)].filter(Boolean).map((column) => <option key={column} value={column} />)}
          </datalist>
        </Field>
        <Field id={`${id}-op`} label={t('toolBuilder.filters.operator')} hint={disabledOps.length ? t('toolBuilder.filters.operatorHint') : undefined}>
          <Select
            id={`${id}-op`}
            value={value.op}
            onChange={(op) => onChange({ ...value, op: op as FilterOp })}
            options={FILTER_OPS.map((op) => ({ value: op, label: t(OP_LABEL[op]), disabled: disabledOps.includes(op) }))}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-stone-600 dark:text-stone-400">
        <input type="checkbox" checked={value.skipWhenEmpty} onChange={(event) => onChange({ ...value, skipWhenEmpty: event.target.checked })} className="size-4 accent-accent" />
        {t('toolBuilder.filters.skipEmpty')}
      </label>
    </div>
  )
}

export function FiltersSection({ query, columns, update }: { query: Query; columns: readonly string[]; update: Draft['update'] }) {
  const { t } = useText()
  const id = useId()
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState<Omit<Filter, 'param'>>({ column: '', op: 'eq', skipWhenEmpty: true })
  const filters = query.filters ?? []
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-sm font-semibold text-stone-900 dark:text-stone-100">{t('toolBuilder.filters.section')}</h2>
        {!adding ? <Button size="sm" tone="ghost" icon={<Plus />} onClick={() => { setValue({ column: '', op: 'eq', skipWhenEmpty: true }); setAdding(true) }}>{t('toolBuilder.filters.add')}</Button> : null}
      </div>
      {filters.length === 0 && !adding ? <p className="text-xs text-stone-500">{t('toolBuilder.filters.empty')}</p> : null}
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {filters.map((filter, index) => {
          const param = query.params.find((param) => param.name === filter.param)
          return (
            <li key={index} className="space-y-2 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono" aria-label={t('toolBuilder.filters.parameter', { name: filter.param })}><Badge>{filter.param}</Badge></span>
                <IconButton label={t('toolBuilder.filters.remove', { column: filter.column })} icon={<Trash2 />} onClick={() => update((doc) => removeFilter(doc, query.id, index))} />
              </div>
              <FilterFields
                value={filter}
                columns={columns}
                disabledOps={param ? FILTER_OPS.filter((op) => !filterAcceptsType(op, param.type)) : []}
                onChange={(next) => update((doc) => updateFilter(doc, query.id, index, next))}
              />
            </li>
          )
        })}
      </ul>
      {adding ? (
        <div className="space-y-3 rounded-lg bg-stone-50 p-3 dark:bg-stone-900">
          <FilterFields value={value} onChange={setValue} columns={columns} />
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setAdding(false)}>{t('toolBuilder.common.cancel')}</Button>
            <Button size="sm" tone="primary" icon={<Plus />} disabled={value.column === ''} onClick={() => {
              update((doc) => addFilter(doc, query.id, { ...value, type: value.op === 'in' ? 'textList' : 'text' }))
              setAdding(false)
            }}>{t('toolBuilder.filters.add')}</Button>
          </div>
        </div>
      ) : null}
      <details className="text-xs text-stone-600 dark:text-stone-400">
        <summary className="cursor-pointer py-1 font-medium">{t('toolBuilder.filters.effectiveSql')}</summary>
        <p className="my-2">{t('toolBuilder.filters.preview')}</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-stone-100 p-3 font-mono text-xs text-stone-800 dark:bg-stone-900 dark:text-stone-200"><code>{effectiveSql(query)}</code></pre>
      </details>
    </section>
  )
}
