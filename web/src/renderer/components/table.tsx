// `table`: rows of its read query with formatted columns, single-row
// selection (exposed as `selectedRow`), row actions, and client-side paging
// at 25 rows. Truncated results say so.
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { z } from 'zod'
import type { QueryResult } from '../../api/types'
import { useText } from '../../i18n'
import type { Component } from '../../model/document'
import { columnSpecSchema, dataQueryOf, literalProp, type ColumnSpec } from '../../model/document.schema'
import { cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton } from '../../ui'
import { useActionRunner } from '../actions'
import { CellValue, isNumericFormat } from '../format'
import { Card, QueryStateView, RefetchBar } from '../frame'
import { rowObjects, useExposed, useQueryResult, useToolRuntime } from '../runtime-context'

export const TABLE_PAGE_SIZE = 25

export function columnsFor(component: Component, result: QueryResult): ColumnSpec[] {
  const configured = literalProp(component, 'columns', z.array(columnSpecSchema))
  if (configured && configured.length > 0) return configured
  return result.columns.map((column) => ({ name: column.name }))
}

/** Same row: equal values in every column (rows have no identity of their own). */
const sameRow = (a: unknown, b: Record<string, unknown>) => a !== null && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b)

export function TableRuntime({ component }: { component: Component }) {
  const queryId = dataQueryOf(component)
  const state = useQueryResult(queryId)
  const { t } = useText()
  return (
    <Card label={component.id} className="relative">
      <RefetchBar active={state.refetching && Boolean(state.result)} />
      <QueryStateView queryId={queryId} state={state} emptyTitle={t('toolBuilder.renderer.state.empty')}>
        {(result) => <TableBody component={component} result={result} />}
      </QueryStateView>
    </Card>
  )
}

function TableBody({ component, result }: { component: Component; result: QueryResult }) {
  const { t, locale } = useText()
  const { runtime, actionsEnabled } = useToolRuntime()
  const selected = useExposed(component.id, 'selectedRow')
  const rows = useMemo(() => rowObjects(result), [result])
  const columns = columnsFor(component, result)
  const actions = component.actions ?? []
  const { start, running, dialog } = useActionRunner()
  const [requestedPage, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE))
  // New results (a search) can have fewer pages than the one shown.
  const page = Math.min(requestedPage, pages - 1)
  const from = page * TABLE_PAGE_SIZE
  const visible = rows.slice(from, from + TABLE_PAGE_SIZE)
  const subjectOf = (row: Record<string, unknown>) => String(row[columns[0]?.name ?? ''] ?? '')

  const select = (row: Record<string, unknown>) => runtime.setExposed(component.id, 'selectedRow', row)
  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, row: Record<string, unknown>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(row)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const sibling = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling
      if (sibling instanceof HTMLElement) sibling.focus()
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto">
        <table aria-label={t('toolBuilder.renderer.table.label', { name: component.id })} className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-[1]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.name}
                  scope="col"
                  className={cn(
                    'h-9 border-b border-line bg-stone-50 px-3 text-left text-[11px] font-medium whitespace-nowrap text-stone-500 first:pl-4 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400',
                    isNumericFormat(column.format) && 'text-right'
                  )}
                >
                  {column.label || column.name}
                </th>
              ))}
              {actions.length > 0 ? (
                <th scope="col" className="h-9 w-10 border-b border-line bg-stone-50 pr-2 dark:border-stone-700 dark:bg-stone-800">
                  <span className="sr-only">{t('toolBuilder.renderer.table.actionsColumn')}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const isSelected = sameRow(selected, row)
              return (
                <tr
                  key={from + index}
                  tabIndex={0}
                  aria-selected={isSelected}
                  onClick={() => select(row)}
                  onKeyDown={(event) => onRowKey(event, row)}
                  className={cn(
                    'cursor-pointer outline-none focus-visible:bg-accent-soft/60 dark:focus-visible:bg-stone-800',
                    isSelected
                      ? 'bg-sky-50 shadow-[inset_3px_0_0] shadow-sky-500 dark:bg-sky-500/10'
                      : 'hover:bg-stone-50 dark:hover:bg-stone-800/60'
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.name}
                      className={cn(
                        'h-10 max-w-64 truncate border-b border-stone-100 px-3 text-stone-700 first:pl-4 dark:border-stone-800 dark:text-stone-300',
                        isNumericFormat(column.format) && 'text-right font-medium'
                      )}
                    >
                      <CellValue value={row[column.name]} format={column.format} locale={locale} />
                    </td>
                  ))}
                  {actions.length > 0 ? (
                    <td className="h-10 border-b border-stone-100 pr-2 text-right dark:border-stone-800" onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            label={t('toolBuilder.renderer.table.rowActions', { row: subjectOf(row) })}
                            icon={<MoreHorizontal />}
                            disabled={!actionsEnabled || running !== null}
                            title={actionsEnabled ? undefined : t('toolBuilder.renderer.action.disabledInEditor')}
                            onClick={() => select(row)}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {actions.map((action) => (
                            <DropdownMenuItem
                              key={action.id}
                              onSelect={() => {
                                select(row)
                                start(action, subjectOf(row))
                              }}
                            >
                              {action.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {result.truncated ? (
        <p role="status" className="shrink-0 border-t border-line bg-busy-soft px-4 py-1.5 text-[11px] text-busy-ink dark:border-stone-700 dark:bg-amber-500/10 dark:text-amber-300">
          {t('toolBuilder.renderer.state.truncated', { count: rows.length })}
        </p>
      ) : null}
      <div className="flex h-10 shrink-0 items-center gap-3 border-t border-line px-4 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400">
        <span className="truncate">
          {t('toolBuilder.renderer.table.range', { from: rows.length === 0 ? 0 : from + 1, to: from + visible.length, total: rows.length })}
        </span>
        <span className="ml-auto hidden tabular-nums whitespace-nowrap sm:inline">{t('toolBuilder.renderer.table.timing', { count: result.rowCount, ms: result.durationMs })}</span>
        {pages > 1 ? (
          <span className="flex items-center gap-1">
            <span className="mr-1 whitespace-nowrap">{t('toolBuilder.renderer.table.page', { page: page + 1, pages })}</span>
            <IconButton label={t('toolBuilder.renderer.table.previous')} icon={<ChevronLeft />} disabled={page === 0} onClick={() => setPage(page - 1)} />
            <IconButton label={t('toolBuilder.renderer.table.next')} icon={<ChevronRight />} disabled={page >= pages - 1} onClick={() => setPage(page + 1)} />
          </span>
        ) : null}
      </div>
      {dialog}
    </>
  )
}
