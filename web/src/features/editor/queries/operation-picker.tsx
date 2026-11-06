// Operation picker of a `builtin-app` source's query: the linked built-in app's contract
// (`GET /data-sources/{id}/operations`) instead of a free path. Choosing an
// operation fills the HTTP request and its parameters (app-operation.ts);
// optional inputs are added one by one. The request form below stays editable.
// Design: builtin-app-connect tool-builder-sources.md §5.
import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { sourceOperationsQuery } from '../../../api/queries'
import type { AppOperation } from '../../../api/types'
import { useText } from '../../../i18n'
import type { Query } from '../../../model/document'
import { Badge, Loading, LoadFailed, Notice, Select } from '../../../ui'
import { applyOperation, includedOptional, matchOperation, methodOf } from './app-operation'

export function OperationPicker({
  sourceId,
  installedApp,
  query,
  onChange,
}: {
  sourceId: string
  /** The built-in app's display name. */
  installedApp: string
  query: Query
  onChange: (fn: (query: Query) => Query) => void
}) {
  const { t } = useText()
  const id = useId()
  const operations = useQuery(sourceOperationsQuery(sourceId))
  const offered = (operations.data ?? []).filter((operation) => methodOf(operation) !== undefined)
  const current = matchOperation(query, offered)
  const optional = current ? includedOptional(query, current) : new Set<string>()

  const choose = (operationId: string) => {
    const operation = offered.find((candidate) => candidate.id === operationId)
    if (operation && operation !== current) onChange((latest) => applyOperation(latest, operation))
  }
  const toggle = (operation: AppOperation, name: string, on: boolean) => {
    const next = new Set(optional)
    if (on) next.add(name)
    else next.delete(name)
    onChange((latest) => applyOperation(latest, operation, next))
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
      <div>
        <h2 id={`${id}-title`} className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          <label htmlFor={`${id}-select`}>{t('toolBuilder.queries.operation')}</label>
        </h2>
        <p className="mt-0.5 text-xs text-stone-500">{t('toolBuilder.queries.operation.hint', { name: installedApp })}</p>
      </div>
      {operations.isPending ? (
        <Loading className="py-2" />
      ) : operations.isError ? (
        <LoadFailed error={operations.error} onRetry={() => void operations.refetch()} />
      ) : offered.length === 0 ? (
        <p className="text-sm text-stone-500">{t('toolBuilder.queries.operation.none')}</p>
      ) : (
        <>
          <Select
            id={`${id}-select`}
            value={current?.id}
            onChange={choose}
            placeholder={t('toolBuilder.queries.operation.placeholder')}
            options={offered.map((operation) => ({
              value: operation.id,
              label: (
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="w-12 shrink-0 font-mono text-[11px] font-semibold text-stone-500">{operation.method.toUpperCase()}</span>
                  <span className="font-mono">{operation.id}</span>
                  {operation.summary ? <span className="truncate text-stone-500">— {operation.summary}</span> : null}
                </span>
              ),
            }))}
          />
          {current ? (
            <OperationDetail operation={current} optional={optional} onToggle={(name, on) => toggle(current, name, on)} />
          ) : query.http && query.http.path !== '/' ? (
            <p className="text-xs text-stone-500">{t('toolBuilder.queries.operation.custom')}</p>
          ) : null}
        </>
      )}
    </section>
  )
}

function OperationDetail({ operation, optional, onToggle }: { operation: AppOperation; optional: ReadonlySet<string>; onToggle: (name: string, on: boolean) => void }) {
  const { t } = useText()
  const id = useId()
  const method = methodOf(operation)
  const hasOptional = operation.params.some((param) => param.in !== 'path' && !param.required)
  return (
    <div className="space-y-3">
      {method && method !== 'GET' ? <Notice tone="warning">{t('toolBuilder.queries.operation.write', { method })}</Notice> : null}
      {operation.params.length > 0 ? (
        <div>
          <h3 className="text-xs font-medium text-stone-600 dark:text-stone-400">{t('toolBuilder.queries.operation.inputs')}</h3>
          <ul className="mt-1.5 divide-y divide-stone-100 rounded-md border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
            {operation.params.map((param) => {
              const always = param.in === 'path' || param.required
              const checkbox = `${id}-${param.in}-${param.name}`
              return (
                <li key={`${param.in}:${param.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  {always ? (
                    <span className="min-w-0 flex-1 font-mono text-stone-900 dark:text-stone-100">{param.name}</span>
                  ) : (
                    <label htmlFor={checkbox} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        id={checkbox}
                        type="checkbox"
                        checked={optional.has(param.name)}
                        onChange={(event) => onToggle(param.name, event.target.checked)}
                        aria-label={t('toolBuilder.queries.operation.addOptional', { name: param.name })}
                        className="size-4 accent-[var(--color-accent)]"
                      />
                      <span className="font-mono text-stone-900 dark:text-stone-100">{param.name}</span>
                    </label>
                  )}
                  <span className="font-mono text-xs text-stone-500">
                    {param.in} · {param.type}
                  </span>
                  {always ? <Badge tone="accent">{t('toolBuilder.queries.operation.alwaysSent')}</Badge> : null}
                </li>
              )
            })}
          </ul>
          {hasOptional ? <p className="mt-1.5 text-xs text-stone-500">{t('toolBuilder.queries.operation.optionalHint')}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
