// `/edit/<slug>/runs?limit=`: recent action runs (newest first), including
// write queries run from the query editor (`actionId` empty). A table from
// `md` up; one card per run below.
import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import { useId } from 'react'
import { runsQuery } from '../../../api/queries'
import type { ActionRun, ActionRunStatus } from '../../../api/types'
import type { MessageId } from '../../../copy'
import { useText, type Translate } from '../../../i18n'
import { EmptyState, Select, StatusPill, useDocumentTitle, type StatusTone } from '../../../ui'
import { useDraft } from '../draft-store'

/** The limits offered; anything else in the URL reads the default (same rule as the route loader). */
const LIMITS = ['20', '50', '100', '200'] as const
const DEFAULT_LIMIT = 50

const STATUS: Record<ActionRunStatus, { tone: StatusTone; label: MessageId }> = {
  ok: { tone: 'ok', label: 'toolBuilder.runs.status.ok' },
  failed: { tone: 'bad', label: 'toolBuilder.runs.status.failed' },
  denied: { tone: 'busy', label: 'toolBuilder.runs.status.denied' },
}

/** Display text of one run; editor runs (`actionId` empty) execute the draft, not a release. */
function describeRun(run: ActionRun, t: Translate, timeFormat: Intl.DateTimeFormat) {
  return {
    time: timeFormat.format(new Date(run.startedAt)),
    action: run.actionId === '' ? t('toolBuilder.runs.editorRun', { query: run.queryId }) : run.actionLabel || run.actionId,
    release: run.actionId === '' ? t('toolBuilder.releases.draft.title') : t('toolBuilder.runtime.version', { number: run.releaseNumber }),
  }
}

export function RunsPage() {
  const { t, locale } = useText()
  const id = useId()
  const params = useParams({ strict: false })
  const search: { limit?: string } = useSearch({ strict: false })
  const navigate = useNavigate()
  const slug = params.slug ?? ''
  const draft = useDraft(slug)
  useDocumentTitle(t('toolBuilder.runs.documentTitle', { tool: draft.tool.name }))
  const limit = LIMITS.find((value) => value === search.limit) ?? String(DEFAULT_LIMIT)
  const runs = useSuspenseQuery(runsQuery(slug, Number(limit))).data
  const number = new Intl.NumberFormat(locale)
  const timeFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">{t('toolBuilder.editor.nav.runs')}</h1>
            <p className="mt-1 max-w-prose text-sm text-stone-500 dark:text-stone-400">{t('toolBuilder.runs.lead')}</p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor={`${id}-limit`} className="text-sm text-stone-600 dark:text-stone-300">
              {t('toolBuilder.runs.limit')}
            </label>
            <Select
              id={`${id}-limit`}
              value={limit}
              onChange={(value) => void navigate({ to: '.', search: { limit: value === String(DEFAULT_LIMIT) ? undefined : value }, replace: true })}
              options={LIMITS.map((value) => ({ value, label: t('toolBuilder.runs.limitOption', { count: value }) }))}
              className="w-36"
            />
          </div>
        </header>

        <div className="mt-6">
          {runs.length === 0 ? (
            <EmptyState icon={<Activity />} title={t('toolBuilder.runs.empty.title')} body={t('toolBuilder.runs.empty.body')} />
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-xl border border-stone-200 bg-white md:block dark:border-stone-800 dark:bg-stone-900">
                <table className="w-full text-left text-sm">
                  <thead className="bg-stone-50 text-xs text-stone-500 dark:bg-stone-950 dark:text-stone-400">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">{t('toolBuilder.runs.col.time')}</th>
                      <th scope="col" className="px-4 py-2 font-medium">{t('toolBuilder.runs.col.actor')}</th>
                      <th scope="col" className="px-4 py-2 font-medium">{t('toolBuilder.runs.col.action')}</th>
                      <th scope="col" className="px-4 py-2 font-medium">{t('toolBuilder.runs.col.release')}</th>
                      <th scope="col" className="px-4 py-2 font-medium">{t('toolBuilder.runs.col.status')}</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">{t('toolBuilder.runs.col.rows')}</th>
                      <th scope="col" className="px-4 py-2 font-medium">{t('toolBuilder.dataSources.status.error')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                    {runs.map((run) => {
                      const cells = describeRun(run, t, timeFormat)
                      return (
                        <tr key={run.id} className="align-top">
                          <td className="px-4 py-2.5 whitespace-nowrap text-stone-600 tabular-nums dark:text-stone-300">
                            <time dateTime={run.startedAt}>{cells.time}</time>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-stone-900 dark:text-stone-100">{run.actor.displayName}</td>
                          <td className="px-4 py-2.5 text-stone-900 dark:text-stone-100">{cells.action}</td>
                          <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-stone-600 dark:text-stone-300">{cells.release}</td>
                          <td className="px-4 py-2.5">
                            <StatusPill tone={STATUS[run.status].tone}>{t(STATUS[run.status].label)}</StatusPill>
                          </td>
                          <td className="px-4 py-2.5 text-right text-stone-700 tabular-nums dark:text-stone-300">{run.rowCount === null ? '—' : number.format(run.rowCount)}</td>
                          <td className="max-w-72 px-4 py-2.5 text-xs break-words text-bad-ink">{run.error ?? ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-3 md:hidden">
                {runs.map((run) => {
                  const cells = describeRun(run, t, timeFormat)
                  return (
                    <li key={run.id} className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm font-medium text-stone-900 dark:text-stone-100">{cells.action}</span>
                        <StatusPill tone={STATUS[run.status].tone}>{t(STATUS[run.status].label)}</StatusPill>
                      </div>
                      <p className="mt-1 text-xs text-stone-500">
                        {run.actor.displayName} · <time dateTime={run.startedAt}>{cells.time}</time> · <span className="font-mono">{cells.release}</span>
                        {run.rowCount === null ? null : ` · ${t('toolBuilder.runs.rows', { count: number.format(run.rowCount) })}`}
                      </p>
                      {run.error ? <p className="mt-1 text-xs break-words text-bad-ink">{run.error}</p> : null}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
