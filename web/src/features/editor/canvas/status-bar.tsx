// Bottom bar of the canvas: the selected component's query with its last
// draft run, the data-flow layer toggle with the count of components that are
// not wired (each click selects the next one), and the document's validation
// problems (each one jumps to the component, or to the query editor for a
// query problem).
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, CheckCircle2, ChevronUp, CircleDot, Database, Unplug, Workflow } from 'lucide-react'
import { Popover } from 'radix-ui'
import { dataSourcesQuery } from '../../../api/queries'
import type { Component, Document } from '../../../model/document'
import { dataQueryOf, problemTarget, type Problem } from '../../../model/document.schema'
import type { FlowHint } from '../../../model/flow'
import { problemText } from '../../../model/problems'
import { useQueryState } from '../../../renderer/runtime-context'
import { useText } from '../../../i18n'
import { paths } from '../../../routes/paths'
import { cn, HrefLink } from '../../../ui'

export function StatusBar({
  slug,
  doc,
  problems,
  selected,
  onSelect,
  hints,
  onRevealHint,
  flowVisible,
  onToggleFlow,
}: {
  slug: string
  doc: Document
  problems: Problem[]
  selected: Component | undefined
  onSelect: (id: string) => void
  hints: FlowHint[]
  onRevealHint: (id: string) => void
  flowVisible: boolean
  onToggleFlow: () => void
}) {
  const { t } = useText()
  const queryId = selected ? dataQueryOf(selected) : undefined
  const query = queryId ? doc.queries.find((q) => q.id === queryId) : undefined
  // Editors may list data sources; the name is a hint, so a failed list just leaves it out.
  const sources = useQuery(dataSourcesQuery)
  const source = query ? sources.data?.find((s) => s.id === query.sourceId) : undefined
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-t border-stone-200 bg-white px-4 text-[11px] text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400">
      {query ? (
        <>
          <Database aria-hidden className="size-3 text-stone-400" />
          <HrefLink href={paths.editQuery(slug, query.id)} className="font-mono font-medium text-stone-800 hover:underline dark:text-stone-200">
            {query.name}
          </HrefLink>
          <span className="text-stone-500">
            {query.sql ? 'SQL' : 'HTTP'}
            {source ? ` · ${source.slug}` : ''}
          </span>
          <LastRun queryId={query.id} />
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <HintsButton hints={hints} selectedId={selected?.id} onReveal={onRevealHint} />
        <button
          type="button"
          aria-pressed={flowVisible}
          title={t('toolBuilder.flow.toggleTitle')}
          onClick={onToggleFlow}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent',
            flowVisible ? 'bg-accent-soft text-accent-strong' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'
          )}
        >
          <Workflow aria-hidden className="size-3.5" />
          {t('toolBuilder.flow.toggle')}
        </button>
      </div>
      <span aria-hidden className="h-4 w-px bg-stone-200 dark:bg-stone-800" />
      <ProblemsButton slug={slug} doc={doc} problems={problems} onSelect={onSelect} />
    </div>
  )
}

function LastRun({ queryId }: { queryId: string }) {
  const { t, locale } = useText()
  const run = useQueryState(queryId)
  if (run.status === 'success' && run.result) {
    const ranAt = run.ranAt ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(run.ranAt) : null
    return (
      <span className="ml-3 flex items-center gap-1.5 text-stone-500">
        <CircleDot aria-hidden className="size-3 text-ok" />
        {t('toolBuilder.editor.status.ran', { rows: run.result.rowCount, ms: run.result.durationMs })}
        {ranAt ? <span className="ml-2">{t('toolBuilder.editor.status.ranAt', { time: ranAt })}</span> : null}
      </span>
    )
  }
  const text =
    run.status === 'loading'
      ? t('toolBuilder.editor.status.running')
      : run.status === 'waiting'
        ? t('toolBuilder.renderer.state.waiting')
        : run.status === 'error'
          ? t('toolBuilder.editor.status.failed')
          : t('toolBuilder.editor.status.notRun')
  return (
    <span className={cn('ml-3 flex items-center gap-1.5', run.status === 'error' ? 'text-bad-ink' : 'text-stone-500')}>
      <CircleDot aria-hidden className={cn('size-3', run.status === 'error' ? 'text-bad' : 'text-stone-300')} />
      {text}
    </span>
  )
}

/** Components the data-flow layer flags (not wired, no data); each click selects the next one. Nothing when all are wired. */
function HintsButton({ hints, selectedId, onReveal }: { hints: FlowHint[]; selectedId: string | undefined; onReveal: (id: string) => void }) {
  const { t } = useText()
  const ids = [...new Set(hints.map((hint) => hint.componentId))]
  if (ids.length === 0) return null
  const next = ids[(ids.indexOf(selectedId ?? '') + 1) % ids.length] ?? ids[0]
  return (
    <button
      type="button"
      title={t('toolBuilder.flow.hints.next')}
      onClick={() => next && onReveal(next)}
      className="flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-busy-ink outline-none hover:bg-busy-soft focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Unplug aria-hidden className="size-3.5" />
      {ids.length === 1 ? t('toolBuilder.flow.hints.one') : t('toolBuilder.flow.hints.many', { count: ids.length })}
    </button>
  )
}

function ProblemsButton({ slug, doc, problems, onSelect }: { slug: string; doc: Document; problems: Problem[]; onSelect: (id: string) => void }) {
  const { t } = useText()
  if (problems.length === 0) {
    return (
      <span className="flex items-center gap-1.5 text-stone-500">
        <CheckCircle2 aria-hidden className="size-3.5 text-ok" />
        {t('toolBuilder.editor.problems.none')}
      </span>
    )
  }
  return (
    <Popover.Root>
      <Popover.Trigger className="flex h-7 items-center gap-1.5 rounded-md px-2 font-medium text-bad-ink hover:bg-bad-soft dark:text-red-300 dark:hover:bg-red-950/40">
        <AlertCircle aria-hidden className="size-3.5" />
        {problems.length === 1 ? t('toolBuilder.editor.problems.one') : t('toolBuilder.editor.problems.many', { count: problems.length })}
        <ChevronUp aria-hidden className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={6}
          className="z-50 max-h-80 w-96 overflow-y-auto rounded-lg border border-stone-200 bg-white p-1 shadow-lg animate-pop-in dark:border-stone-700 dark:bg-stone-900"
        >
          <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">{t('toolBuilder.editor.problems.title')}</p>
          <ul>
            {problems.map((problem, index) => {
              const { componentId, queryId } = problemTarget(doc, problem)
              const query = queryId ? doc.queries.find((q) => q.id === queryId) : undefined
              const where = componentId ?? query?.name ?? (problem.path || t('toolBuilder.editor.problems.document'))
              const body = (
                <>
                  <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-bad" />
                  <span className="min-w-0">
                    <span className="block font-mono text-[11px] text-stone-500">{where}</span>
                    <span className="block text-xs text-stone-800 dark:text-stone-200">{problemText(problem, t)}</span>
                  </span>
                </>
              )
              const rowClass = 'flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left hover:bg-stone-50 dark:hover:bg-stone-800'
              return (
                <li key={`${problem.path}:${problem.code}:${index}`}>
                  {componentId ? (
                    <Popover.Close className={rowClass} onClick={() => onSelect(componentId)}>
                      {body}
                    </Popover.Close>
                  ) : queryId ? (
                    <HrefLink href={paths.editQuery(slug, queryId)} className={rowClass}>
                      {body}
                    </HrefLink>
                  ) : (
                    <div className={rowClass}>{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
