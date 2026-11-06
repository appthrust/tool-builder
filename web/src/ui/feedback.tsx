import { AlertTriangle, CheckCircle2, Info, Loader2, RotateCw, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { isApiError } from '../api/client'
import type { ErrorCode } from '../api/types'
import type { MessageId } from '../copy'
import { useText } from '../i18n'
import { Button } from './button'
import { cn } from './cn'

export type NoticeTone = 'info' | 'success' | 'warning' | 'error'

const NOTICE: Record<NoticeTone, { box: string; icon: ReactNode }> = {
  info: { box: 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300', icon: <Info className="text-accent" /> },
  success: { box: 'border-accent-line bg-accent-soft text-accent-strong', icon: <CheckCircle2 /> },
  warning: { box: 'border-amber-200 dark:border-amber-900 bg-busy-soft text-busy-ink', icon: <AlertTriangle /> },
  error: { box: 'border-red-200 dark:border-red-900 bg-bad-soft text-bad-ink', icon: <XCircle /> },
}

export function Notice({
  tone = 'info',
  title,
  children,
  actions,
  className,
}: {
  tone?: NoticeTone
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const style = NOTICE[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0', style.box, className)}
    >
      {style.icon}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title ? 'mt-0.5 opacity-90' : undefined)}>{children}</div> : null}
        {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

export function EmptyState({ icon, title, body, action, heading = 'p' }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode; heading?: 'p' | 'h1' }) {
  const Heading = heading
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-6 py-12 text-center">
      {icon ? (
        <span aria-hidden className="mb-3 flex size-10 items-center justify-center rounded-full bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <Heading className={cn('font-medium text-stone-800 dark:text-stone-200', heading === 'h1' ? 'text-xl' : 'text-sm')}>{title}</Heading>
      {body ? <div className="mt-1 max-w-sm text-sm text-stone-500 dark:text-stone-400">{body}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function Loading({ className }: { className?: string }) {
  const { t } = useText()
  return (
    <p role="status" className={cn('flex items-center gap-2 py-6 text-sm text-stone-500 dark:text-stone-400', className)}>
      <Loader2 aria-hidden className="size-4 animate-spin text-accent" />
      {t('toolBuilder.common.loading')}
    </p>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block animate-pulse rounded-md bg-stone-200/70 dark:bg-stone-700/70', className)} />
}

/** A 401 cannot be fixed by retrying, so it gets the access-denied text and no retry button. */
export function LoadFailed({ error, onRetry }: { error?: unknown; onRetry: () => void }) {
  const { t } = useText()
  if (isApiError(error) && error.status === 401) return <Notice tone="error">{t('toolBuilder.common.accessDenied')}</Notice>
  return (
    <Notice
      tone="error"
      title={t('toolBuilder.common.loadFailed')}
      actions={
        <Button size="sm" icon={<RotateCw />} onClick={onRetry}>
          {t('toolBuilder.common.retry')}
        </Button>
      }
    >
      {isApiError(error) && error.transient ? t('toolBuilder.errors.transient') : null}
    </Notice>
  )
}

const ERROR_COPY: Record<ErrorCode, MessageId> = {
  not_found: 'toolBuilder.errors.not_found',
  forbidden: 'toolBuilder.errors.forbidden',
  tool_forbidden: 'toolBuilder.errors.tool_forbidden',
  invalid_document: 'toolBuilder.errors.invalid_document',
  draft_changed: 'toolBuilder.errors.draft_changed',
  slug_taken: 'toolBuilder.errors.slug_taken',
  data_source_in_use: 'toolBuilder.errors.data_source_in_use',
  data_source_pending: 'toolBuilder.errors.data_source_pending',
  data_source_busy: 'toolBuilder.errors.data_source_busy',
  data_source_unavailable: 'toolBuilder.errors.data_source_unavailable',
  internal_service_required: 'toolBuilder.errors.internal_service_required',
  link_not_declared: 'toolBuilder.errors.link_not_declared',
  query_not_read_only: 'toolBuilder.errors.query_not_read_only',
  query_timeout: 'toolBuilder.errors.query_timeout',
  query_failed: 'toolBuilder.errors.query_failed',
  write_not_confirmed: 'toolBuilder.errors.write_not_confirmed',
  action_denied: 'toolBuilder.errors.action_denied',
  identity_unavailable: 'toolBuilder.errors.identity_unavailable',
  tool_builder_store_unavailable: 'toolBuilder.errors.tool_builder_store_unavailable',
}

/** The localized explanation for a known tool-builder error, else undefined. */
export function errorMessageId(error: unknown): MessageId | undefined {
  if (!isApiError(error)) return undefined
  if (error.transient) return 'toolBuilder.errors.transient'
  if (error.status === 401) return 'toolBuilder.common.accessDenied'
  if (Object.hasOwn(ERROR_COPY, error.code)) return ERROR_COPY[error.code as ErrorCode]
  if (error.status === 403) return 'toolBuilder.errors.forbidden'
  if (error.status === 409) return 'toolBuilder.errors.conflict'
  if (error.status === 400) return 'toolBuilder.errors.invalid'
  return undefined
}

/**
 * Failed mutation: the localized explanation first; the server's message (not
 * localized) as a secondary hint for 400s and failed queries (the database's own
 * error), whose cause the summary cannot name.
 */
export function ActionError({ error }: { error: unknown }) {
  const { t } = useText()
  const known = errorMessageId(error)
  const detail = isApiError(error) && (error.status === 400 || error.code === 'query_failed') ? error.message : undefined
  return (
    <Notice tone="error" title={known ? undefined : t('toolBuilder.common.actionFailed')}>
      {known ? t(known) : null}
      {detail ? <span className="mt-0.5 block text-xs opacity-80">{detail}</span> : null}
    </Notice>
  )
}
