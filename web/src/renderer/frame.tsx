// The card every data component sits in, and the shared query states:
// no query chosen, waiting for input, loading, error (with retry), empty.
import { AlertTriangle, Loader2, MousePointerClick, RotateCw, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { isApiError } from '../api/client'
import type { QueryResult } from '../api/types'
import { useText } from '../i18n'
import type { QueryState } from '../model/bindings'
import type { Query } from '../model/document'
import { Button, cn, errorMessageId } from '../ui'
import { useToolRuntime } from './runtime-context'

export const CARD = 'rounded-lg border border-line bg-white shadow-xs dark:border-stone-700 dark:bg-stone-900'

/**
 * Every data/layout component's box. It scrolls vertically, so a cell shorter
 * than its content never hides rows; regions with their own scroll (table
 * body, form fields) take the space first and scroll themselves.
 */
export function Card({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label} className={cn(CARD, 'flex size-full min-h-0 flex-col overflow-x-hidden overflow-y-auto', className)}>
      {children}
    </section>
  )
}

/** A centred, quiet message filling the card body. */
export function StateMessage({ icon, title, body, action, tone = 'muted' }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden px-4 py-3 text-center"
    >
      {icon ? (
        <span aria-hidden className={cn('mb-1 [&_svg]:size-4', tone === 'error' ? 'text-bad dark:text-red-400' : 'text-stone-400 dark:text-stone-500')}>
          {icon}
        </span>
      ) : null}
      <p className={cn('text-xs font-medium', tone === 'error' ? 'text-bad-ink dark:text-red-300' : 'text-stone-600 dark:text-stone-300')}>{title}</p>
      {body ? <div className="max-w-xs text-[11px] text-stone-500 dark:text-stone-400">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/** Whether a query's missing params are fed by a table selection (the detail-of-selected-row case). */
function waitsForRow(query: Query | undefined, missing: string[], types: ReadonlyMap<string, string>): boolean {
  if (!query) return false
  return query.params.some((param) => missing.includes(param.name) && 'ref' in param.bind && types.get(param.bind.ref.component) === 'table')
}

/**
 * Renders the non-data states of a query and, once rows exist, `children`.
 * `empty` is shown for zero rows unless `allowEmpty`.
 */
export function QueryStateView({
  queryId,
  state,
  children,
  emptyTitle,
  allowEmpty = false,
}: {
  queryId: string | undefined
  state: QueryState
  children: (result: QueryResult) => ReactNode
  emptyTitle?: string
  allowEmpty?: boolean
}) {
  const { t } = useText()
  const { runtime, queryById, componentById } = useToolRuntime()
  if (!queryId) return <StateMessage icon={<SlidersHorizontal />} title={t('toolBuilder.renderer.state.noQuery')} body={t('toolBuilder.renderer.state.noQueryBody')} />
  if (state.status === 'waiting') {
    const types = new Map([...componentById].map(([id, component]) => [id, component.type]))
    const row = waitsForRow(queryById.get(queryId), state.missing, types)
    return (
      <StateMessage
        icon={<MousePointerClick />}
        title={t('toolBuilder.renderer.state.waiting')}
        body={row ? t('toolBuilder.renderer.state.waitingRow') : t('toolBuilder.renderer.state.waitingBody')}
      />
    )
  }
  if (state.status === 'error' && !state.result) {
    const known = errorMessageId(state.error)
    const detail = isApiError(state.error, 'query_failed') ? state.error.message : undefined
    return (
      <StateMessage
        tone="error"
        icon={<AlertTriangle />}
        title={t('toolBuilder.renderer.state.error')}
        body={
          <>
            {known ? t(known) : null}
            {detail ? <span className="mt-0.5 block font-mono text-[10px] break-all">{detail}</span> : null}
          </>
        }
        action={
          <Button size="sm" icon={<RotateCw />} onClick={() => runtime.refresh([queryId])}>
            {t('toolBuilder.common.retry')}
          </Button>
        }
      />
    )
  }
  if (!state.result) {
    return <StateMessage icon={<Loader2 className="animate-spin text-accent" />} title={t('toolBuilder.common.loading')} />
  }
  if (state.result.rows.length === 0 && !allowEmpty) return <StateMessage title={emptyTitle ?? t('toolBuilder.renderer.state.empty')} />
  return <>{children(state.result)}</>
}

/** Thin progress line while a query re-runs with the previous rows still shown. */
export function RefetchBar({ active }: { active: boolean }) {
  const { t } = useText()
  if (!active) return null
  return (
    <span role="status" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-accent-soft dark:bg-stone-800">
      <span className="block h-full w-1/3 animate-pulse bg-accent" />
      <span className="sr-only">{t('toolBuilder.renderer.state.refreshing')}</span>
    </span>
  )
}
