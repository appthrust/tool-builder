// Result of a draft query Run: the rows grid with `N rows · M ms`, the
// truncation notice, or the failure with its error code and a copy button.
import { Loader2, XCircle } from 'lucide-react'
import { isApiError } from '../../../api/client'
import type { QueryResult } from '../../../api/types'
import { useText } from '../../../i18n'
import type { QueryMode } from '../../../model/document'
import { CopyButton, errorMessageId, Notice } from '../../../ui'

export type RunState = { status: 'idle' } | { status: 'running' } | { status: 'done'; result: QueryResult } | { status: 'failed'; error: unknown }

function cellText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function ResultsPanel({ state, mode, rowLimit }: { state: RunState; mode: QueryMode; rowLimit: number }) {
  const { t, locale } = useText()
  if (state.status === 'idle') return <p className="px-4 py-6 text-sm text-stone-500">{t('toolBuilder.queries.results.idle')}</p>
  if (state.status === 'running') {
    return (
      <p role="status" className="flex items-center gap-2 px-4 py-6 text-sm text-stone-500">
        <Loader2 aria-hidden className="size-4 animate-spin text-accent" />
        {t('toolBuilder.editor.status.running')}
      </p>
    )
  }
  if (state.status === 'failed') {
    const known = errorMessageId(state.error)
    const code = isApiError(state.error) ? state.error.code : 'unknown'
    const message = state.error instanceof Error ? state.error.message : String(state.error)
    return (
      <div className="p-4">
        <div role="alert" className="rounded-lg border border-red-200 bg-bad-soft px-4 py-3 text-sm text-bad-ink">
          <div className="flex flex-wrap items-start gap-3">
            <XCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{known ? t(known) : t('toolBuilder.editor.status.failed')}</p>
              <p className="mt-1 font-mono text-xs break-words whitespace-pre-wrap opacity-90">{message}</p>
              <p className="mt-2 text-xs opacity-80">{t('toolBuilder.queries.results.code', { code })}</p>
            </div>
            <CopyButton value={`${code}: ${message}`} label={t('toolBuilder.queries.results.copyError')} />
          </div>
        </div>
      </div>
    )
  }
  const { result } = state
  const number = new Intl.NumberFormat(locale)
  const summary =
    mode === 'write'
      ? t('toolBuilder.queries.results.writeSummary', { rows: number.format(result.rowCount), ms: number.format(result.durationMs) })
      : t('toolBuilder.editor.status.ran', { rows: number.format(result.rowCount), ms: number.format(result.durationMs) })
  return (
    <div className="flex min-h-0 flex-col">
      <p role="status" className="border-b border-stone-200 px-4 py-2 text-xs text-stone-500 tabular-nums">
        {summary}
      </p>
      {result.truncated ? (
        <Notice tone="warning" className="m-3">
          {t('toolBuilder.queries.results.truncated', { limit: number.format(rowLimit) })}
        </Notice>
      ) : null}
      {result.columns.length === 0 ? null : result.rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-stone-500">{t('toolBuilder.queries.results.empty')}</p>
      ) : (
        <div className="min-h-0 overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
            <thead className="sticky top-0 z-10 bg-stone-50">
              <tr>
                {result.columns.map((column) => (
                  <th key={column.name} scope="col" className="border-b border-stone-200 px-3 py-2 font-medium whitespace-nowrap text-stone-700">
                    {column.name}
                    <span className="ml-1.5 font-normal text-stone-400">{column.type}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono text-stone-800">
              {result.rows.map((row, r) => (
                // Rows have no identity of their own; the index is the row's position in this result.
                <tr key={r} className="hover:bg-stone-50">
                  {result.columns.map((column, c) => {
                    const value = row[c]
                    return (
                      <td key={column.name} className="max-w-80 truncate border-b border-stone-100 px-3 py-1.5 whitespace-nowrap" title={value === null || value === undefined ? undefined : cellText(value)}>
                        {value === null || value === undefined ? <span className="text-stone-400 italic">{t('toolBuilder.queries.results.null')}</span> : cellText(value)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
