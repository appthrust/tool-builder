// Read-only data components: `detail` (label/value grid of the first row),
// `stat` (one value with an optional note), `chart` (bar/line/area over rows).
import { AlertTriangle } from 'lucide-react'
import { useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { z } from 'zod'
import type { QueryResult } from '../../api/types'
import { useText, type Translate } from '../../i18n'
import type { Component } from '../../model/document'
import { CHART_KINDS, columnSpecSchema, dataQueryOf, literalProp, STAT_FORMATS } from '../../model/document.schema'
import { errorMessageId, Skeleton } from '../../ui'
import { CellValue, formatValue, Pill } from '../format'
import { Card, QueryStateView, RefetchBar, StateMessage } from '../frame'
import { rowObjects, usePropValue, useQueryResult } from '../runtime-context'

export function DetailRuntime({ component }: { component: Component }) {
  const queryId = dataQueryOf(component)
  const state = useQueryResult(queryId)
  const { t, locale } = useText()
  return (
    <Card label={component.id} className="relative">
      <RefetchBar active={state.refetching && Boolean(state.result)} />
      <QueryStateView queryId={queryId} state={state} emptyTitle={t('toolBuilder.renderer.state.emptyRecord')}>
        {(result) => {
          const row = rowObjects(result)[0] ?? {}
          const configured = literalProp(component, 'columns', z.array(columnSpecSchema))
          const columns = configured && configured.length > 0 ? configured : result.columns.map((column) => ({ name: column.name, label: undefined, format: undefined }))
          return (
            <dl className="grid flex-none auto-rows-min grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 px-4 py-3 text-xs">
              {columns.map((column) => (
                <div key={column.name} className="col-span-2 grid grid-cols-subgrid border-b border-stone-100 py-1.5 last:border-b-0 dark:border-stone-800">
                  <dt className="truncate text-stone-500 dark:text-stone-400">{column.label || column.name}</dt>
                  <dd className="min-w-0 break-words text-stone-800 dark:text-stone-200">
                    <CellValue value={row[column.name]} format={column.format} locale={locale} />
                  </dd>
                </div>
              ))}
            </dl>
          )
        }}
      </QueryStateView>
    </Card>
  )
}

export function StatRuntime({ component }: { component: Component }) {
  const queryId = dataQueryOf(component)
  const state = useQueryResult(queryId)
  const { t, locale } = useText()
  const label = usePropValue(component, 'label')
  const delta = usePropValue(component, 'delta')
  const column = literalProp(component, 'column', z.string())
  const format = literalProp(component, 'format', z.enum(STAT_FORMATS))
  const value = (result: QueryResult) => {
    const index = column ? result.columns.findIndex((candidate) => candidate.name === column) : 0
    return index < 0 ? undefined : result.rows[0]?.[index]
  }
  return (
    <Card label={typeof label === 'string' ? label : component.id} className="relative justify-center px-3.5 py-2.5">
      <p className="truncate text-[11px] text-stone-500 dark:text-stone-400">{typeof label === 'string' ? label : ''}</p>
      <div className="mt-1 flex min-w-0 items-baseline justify-between gap-2">
        {queryId && state.result ? (
          <span className="truncate text-[22px] leading-none font-semibold text-stone-900 tabular-nums dark:text-stone-50">
            {formatValue(value(state.result), format ?? 'number', locale)}
          </span>
        ) : queryId && (state.status === 'loading' || state.status === 'idle') ? (
          <Skeleton className="h-[22px] w-16" />
        ) : queryId && state.status === 'error' ? (
          <span role="alert" className="flex min-w-0 items-center gap-1.5 text-xs text-bad-ink dark:text-red-300" title={errorTitle(state.error, t)}>
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{t('toolBuilder.renderer.state.error')}</span>
          </span>
        ) : (
          <span className="text-[22px] leading-none font-semibold text-stone-300 dark:text-stone-600">—</span>
        )}
        {typeof delta === 'string' && delta !== '' ? <Pill>{delta}</Pill> : null}
      </div>
    </Card>
  )
}

/** The localized reason of a failed run, for a tooltip. */
function errorTitle(error: unknown, t: Translate): string | undefined {
  const id = errorMessageId(error)
  return id ? t(id) : undefined
}

export function ChartRuntime({ component }: { component: Component }) {
  const queryId = dataQueryOf(component)
  const state = useQueryResult(queryId)
  const { t, locale } = useText()
  const title = literalProp(component, 'title', z.string())
  const kind = literalProp(component, 'kind', z.enum(CHART_KINDS)) ?? 'bar'
  const x = literalProp(component, 'x', z.string())
  const y = literalProp(component, 'y', z.string())
  const data = useMemo(
    () => (state.result && x && y ? rowObjects(state.result).map((row) => ({ x: formatAxis(row[x], locale), y: Number(row[y]) })) : []),
    [locale, state.result, x, y]
  )
  return (
    <Card label={title || component.id} className="relative">
      <RefetchBar active={state.refetching && Boolean(state.result)} />
      {title ? <p className="shrink-0 truncate px-4 pt-3 text-xs font-medium text-stone-700 dark:text-stone-200">{title}</p> : null}
      {!x || !y ? (
        <StateMessage title={t('toolBuilder.renderer.state.chartColumns')} />
      ) : (
        <QueryStateView queryId={queryId} state={state}>
          {() => (
            <div className="min-h-0 flex-1 px-2 pb-2">
              <ResponsiveContainer width="100%" height="100%">
                {kind === 'line' ? (
                  <LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                    <ChartAxes />
                    <Line type="monotone" dataKey="y" name={y} stroke="var(--color-accent)" strokeWidth={2} dot={false} />
                  </LineChart>
                ) : kind === 'area' ? (
                  <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                    <ChartAxes />
                    <Area type="monotone" dataKey="y" name={y} stroke="var(--color-accent)" fill="var(--color-accent)" fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                ) : (
                  <BarChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                    <ChartAxes />
                    <Bar dataKey="y" name={y} fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </QueryStateView>
      )}
    </Card>
  )
}

/** Shared grid, axes and tooltip; stone tones read in light and dark. */
function ChartAxes() {
  return (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-stone-200 dark:text-stone-700" vertical={false} />
      <XAxis dataKey="x" tick={{ fontSize: 11, fill: 'currentColor' }} className="text-stone-500" tickLine={false} axisLine={false} />
      <YAxis tick={{ fontSize: 11, fill: 'currentColor' }} className="text-stone-500" tickLine={false} axisLine={false} width={40} />
      <Tooltip
        cursor={{ fillOpacity: 0.08 }}
        contentStyle={{ fontSize: 12, borderRadius: 6, background: 'var(--tooltip-bg, white)', border: '1px solid var(--color-line)' }}
      />
    </>
  )
}

/** Dates on the x axis are shortened; anything else is shown as text. */
function formatAxis(value: unknown, locale: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
  }
  return value === null || value === undefined ? '' : String(value)
}
