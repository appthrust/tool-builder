// `/edit/<slug>/releases[/<n>]`: the draft card (unpublished changes computed
// in the browser with the server's diff rules, "Review and publish"), the
// release history (Live / Rolled back, Restore) and a release's detail with
// its stored change list and "Compare with live". Publishing saves the draft
// first: the server publishes its stored draft. `?publish=1` (from the editor
// top bar) opens the review sheet.
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Eye, GitCompareArrows, History, RotateCcw, Send } from 'lucide-react'
import { useId, useState } from 'react'
import { api, isApiError } from '../../../api/client'
import { invalidateTool, releaseQuery, releasesQuery } from '../../../api/queries'
import type { Release, ReleaseDetail } from '../../../api/types'
import { useText } from '../../../i18n'
import type { Document } from '../../../model/document'
import type { Problem } from '../../../model/document.schema'
import { problemText } from '../../../model/problems'
import { paths } from '../../../routes/paths'
import {
  ActionError,
  Button,
  cn,
  ConfirmDialog,
  EmptyState,
  Field,
  HrefLink,
  LinkButton,
  LoadFailed,
  Loading,
  Notice,
  Sheet,
  StatusPill,
  TextArea,
  TextInput,
  useDocumentTitle,
} from '../../../ui'
import { useDraft, type Draft } from '../draft-store'
import { CHANGE_LABEL, ChangeList } from './change-list'
import { compareDocuments, documentChanges, type CompareRow } from './changes'
import { releaseBadges, type ReleaseBadge } from './history'

function useDateTime() {
  const { locale } = useText()
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  return (iso: string | number) => format.format(new Date(iso))
}

export function ReleasesPage() {
  const { t } = useText()
  const params = useParams({ strict: false })
  const search: { publish?: string } = useSearch({ strict: false })
  const navigate = useNavigate()
  const slug = params.slug ?? ''
  const selected = params.n === undefined ? undefined : Number(params.n)
  const draft = useDraft(slug)
  const releases = useSuspenseQuery(releasesQuery(slug)).data
  useDocumentTitle(t('toolBuilder.releases.documentTitle', { tool: draft.tool.name }))
  const [flash, setFlash] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<Release | null>(null)

  const badges = releaseBadges(releases)
  const live = releases.find((release) => release.live) ?? null
  const nextNumber = releases.reduce((max, release) => Math.max(max, release.number), 0) + 1
  const publishOpen = search.publish !== undefined
  const setPublishOpen = (open: boolean) =>
    void navigate({ to: '.', search: (previous: Record<string, unknown>) => ({ ...previous, publish: open ? '1' : undefined }), replace: true })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className={cn('min-w-0 space-y-6', selected !== undefined ? 'hidden lg:block' : undefined)}>
          <header>
            <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">{t('toolBuilder.editor.nav.releases')}</h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{t('toolBuilder.releases.lead')}</p>
          </header>
          {flash ? (
            <Notice tone="success" actions={<Button size="sm" tone="ghost" onClick={() => setFlash(null)}>{t('toolBuilder.common.close')}</Button>}>
              {flash}
            </Notice>
          ) : null}
          <DraftCard slug={slug} draft={draft} hasLive={live !== null} onReview={() => setPublishOpen(true)} />
          <ReleaseHistory slug={slug} releases={releases} badges={badges} selected={selected} onRestore={setRestoring} />
        </div>
        <div className={cn('min-w-0', selected === undefined ? 'hidden lg:block' : undefined)}>
          {selected !== undefined ? (
            <ReleaseDetailView slug={slug} number={selected} badge={badges.get(selected) ?? null} live={live} onRestore={setRestoring} />
          ) : (
            <div className="hidden h-48 items-center justify-center rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500 lg:flex dark:border-stone-700">
              <span className="flex flex-col items-center gap-2">
                <History aria-hidden className="size-5 text-stone-400" />
                {releases.length > 0 ? t('toolBuilder.releases.detail.pick') : t('toolBuilder.releases.history.emptyBody')}
              </span>
            </div>
          )}
        </div>
      </div>

      <PublishSheet
        open={publishOpen}
        onOpenChange={setPublishOpen}
        slug={slug}
        draft={draft}
        number={nextNumber}
        onPublished={(release) => {
          setFlash(t('toolBuilder.releases.publish.done', { number: release.number }))
          void navigate({ to: '/edit/$slug/releases/$n', params: { slug, n: String(release.number) }, search: {} })
        }}
      />
      <RestoreDialog
        slug={slug}
        release={restoring}
        next={nextNumber}
        onClose={() => setRestoring(null)}
        onRestored={(release, from) => {
          setFlash(t('toolBuilder.releases.restore.done', { number: from, next: release.number }))
          void navigate({ to: '/edit/$slug/releases/$n', params: { slug, n: String(release.number) } })
        }}
      />
    </div>
  )
}

function DraftCard({ slug, draft, hasLive, onReview }: { slug: string; draft: Draft; hasLive: boolean; onReview: () => void }) {
  const { t } = useText()
  const formatTime = useDateTime()
  const changes = documentChanges(draft.tool.live?.document ?? null, draft.document)
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-accent-line bg-white p-4 shadow-xs dark:border-stone-700 dark:bg-stone-900">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={titleId} className="text-base font-semibold text-stone-900 dark:text-stone-100">
          {t('toolBuilder.releases.draft.title')}
        </h2>
        {changes.length > 0 ? (
          <StatusPill tone="busy">{changes.length === 1 ? t('toolBuilder.releases.draft.one') : t('toolBuilder.releases.draft.many', { count: changes.length })}</StatusPill>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t('toolBuilder.releases.draft.edited', { time: formatTime(draft.savedAt ?? draft.tool.draftUpdatedAt) })}</p>
      <div className="mt-3">
        {!hasLive ? <p className="mb-2 text-sm text-stone-600 dark:text-stone-300">{t('toolBuilder.releases.draft.neverPublished')}</p> : null}
        {changes.length === 0 ? <p className="text-sm text-stone-600 dark:text-stone-300">{t('toolBuilder.releases.draft.none')}</p> : <ChangeList changes={changes} limit={5} />}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button tone="primary" icon={<Send />} onClick={onReview} disabled={changes.length === 0 && hasLive}>
          {t('toolBuilder.releases.draft.review')}
        </Button>
        <LinkButton href={paths.preview(slug)} icon={<Eye className="size-4" />}>
          {t('toolBuilder.runtime.previewDraft')}
        </LinkButton>
      </div>
    </section>
  )
}

/** Server-side `invalid_document` details carry the same problems the SPA computes. */
function serverProblems(error: unknown): Problem[] {
  if (!isApiError(error, 'invalid_document')) return []
  const problems = error.details?.problems
  return Array.isArray(problems) ? problems.filter((item): item is Problem => typeof item === 'object' && item !== null && 'message' in item && 'code' in item) : []
}

function ProblemList({ problems }: { problems: Problem[] }) {
  const { t } = useText()
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {problems.map((problem, index) => (
        <li key={`${problem.path}:${problem.code}:${index}`}>
          {problemText(problem, t)}
        </li>
      ))}
    </ul>
  )
}

function PublishSheet({
  open,
  onOpenChange,
  slug,
  draft,
  number,
  onPublished,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  draft: Draft
  number: number
  onPublished: (release: Release) => void
}) {
  const { t } = useText()
  const id = useId()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const changes = documentChanges(draft.tool.live?.document ?? null, draft.document)
  const publish = useMutation({
    // The server publishes its stored draft: local edits must be on it first, and `If-Match` makes
    // sure nobody saved another draft in between (409 → the conflict banner offers a reload).
    mutationFn: () => draft.onSavedDraft((version) => api.releases.publish(slug, note.trim(), version)),
    onSuccess: async (release) => {
      await invalidateTool(queryClient, slug)
      setNote('')
      onPublished(release)
    },
  })
  const blocked = draft.problems.length > 0 || draft.conflict
  const close = (next: boolean) => {
    if (publish.isPending) return
    if (!next) publish.reset()
    onOpenChange(next)
  }
  const fromServer = serverProblems(publish.error)
  return (
    <Sheet
      open={open}
      onOpenChange={close}
      size="lg"
      title={t('toolBuilder.releases.publish.title', { number })}
      description={t('toolBuilder.releases.publish.lead')}
      footer={
        <>
          <Button onClick={() => close(false)} disabled={publish.isPending}>
            {t('toolBuilder.common.cancel')}
          </Button>
          <Button tone="primary" icon={<Send />} onClick={() => publish.mutate()} loading={publish.isPending} disabled={blocked}>
            {t('toolBuilder.editor.publish', { number })}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {draft.conflict ? <Notice tone="error">{t('toolBuilder.releases.publish.conflict')}</Notice> : null}
        {draft.problems.length > 0 ? (
          <Notice tone="error" title={t('toolBuilder.releases.publish.blocked')}>
            <ProblemList problems={draft.problems} />
          </Notice>
        ) : null}
        <Field id={`${id}-note`} label={t('toolBuilder.releases.publish.note')} hint={t('toolBuilder.releases.publish.noteHint')}>
          <TextArea id={`${id}-note`} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} />
        </Field>
        <section aria-labelledby={`${id}-changes`}>
          <h3 id={`${id}-changes`} className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {t('toolBuilder.releases.publish.changes')}
          </h3>
          <div className="mt-2">{changes.length === 0 ? <p className="text-sm text-stone-500">{t('toolBuilder.releases.publish.noChanges')}</p> : <ChangeList changes={changes} />}</div>
        </section>
        {publish.error ? (
          fromServer.length > 0 ? (
            <Notice tone="error" title={t('toolBuilder.releases.publish.blocked')}>
              <ProblemList problems={fromServer} />
            </Notice>
          ) : (
            <ActionError error={publish.error} />
          )
        ) : null}
      </div>
    </Sheet>
  )
}

function BadgeFor({ badge }: { badge: ReleaseBadge }) {
  const { t } = useText()
  if (badge === 'live') return <StatusPill tone="ok">{t('toolBuilder.releases.badge.live')}</StatusPill>
  if (badge === 'rolledBack') return <StatusPill tone="neutral">{t('toolBuilder.releases.badge.rolledBack')}</StatusPill>
  return null
}

function ReleaseHistory({
  slug,
  releases,
  badges,
  selected,
  onRestore,
}: {
  slug: string
  releases: Release[]
  badges: Map<number, ReleaseBadge>
  selected: number | undefined
  onRestore: (release: Release) => void
}) {
  const { t } = useText()
  const formatTime = useDateTime()
  const titleId = useId()
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="mb-3 text-base font-semibold text-stone-900 dark:text-stone-100">
        {t('toolBuilder.releases.history')}
      </h2>
      {releases.length === 0 ? (
        <EmptyState icon={<History />} title={t('toolBuilder.releases.history.empty')} body={t('toolBuilder.releases.history.emptyBody')} />
      ) : (
        <ol className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {releases.map((release) => {
            const badge = badges.get(release.number) ?? null
            const current = release.number === selected
            return (
              <li key={release.id} className={cn('flex items-start gap-2 px-3 py-3', current ? 'bg-accent-soft dark:bg-stone-800' : undefined)}>
                <HrefLink href={paths.editRelease(slug, release.number)} aria-current={current ? 'page' : undefined} className="-m-1 min-w-0 flex-1 rounded-md p-1 hover:bg-stone-50 dark:hover:bg-stone-800">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-stone-900 dark:text-stone-100">{t('toolBuilder.runtime.version', { number: release.number })}</span>
                    <BadgeFor badge={badge} />
                    {release.restoredFrom !== null ? <span className="text-xs text-stone-500">{t('toolBuilder.releases.restoredFrom', { number: release.restoredFrom })}</span> : null}
                  </span>
                  <span className={cn('mt-0.5 block truncate text-sm', release.note ? 'text-stone-700 dark:text-stone-300' : 'text-stone-400 italic')}>
                    {release.note || t('toolBuilder.releases.noNote')}
                  </span>
                  <span className="mt-0.5 block text-xs text-stone-500">{t('toolBuilder.releases.byline', { name: release.publishedBy.displayName, time: formatTime(release.publishedAt) })}</span>
                </HrefLink>
                {!release.live ? (
                  <Button size="sm" tone="ghost" icon={<RotateCcw />} onClick={() => onRestore(release)} aria-label={t('toolBuilder.releases.restore.confirm', { number: release.number })}>
                    {t('toolBuilder.releases.restore')}
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function ReleaseDetailView({
  slug,
  number,
  badge,
  live,
  onRestore,
}: {
  slug: string
  number: number
  badge: ReleaseBadge
  live: Release | null
  onRestore: (release: Release) => void
}) {
  const { t } = useText()
  const formatTime = useDateTime()
  const valid = Number.isInteger(number) && number > 0
  const detail = useQuery({ ...releaseQuery(slug, number), enabled: valid })
  const liveDetail = useQuery({ ...releaseQuery(slug, live?.number ?? 0), enabled: live !== null && live.number !== number })
  const [comparing, setComparing] = useState(false)
  const back = (
    <HrefLink href={paths.editReleases(slug)} className="inline-flex min-h-10 items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900 lg:hidden dark:text-stone-300">
      <ArrowLeft aria-hidden className="size-4" />
      {t('toolBuilder.releases.detail.back')}
    </HrefLink>
  )
  if (!valid || (detail.isError && isApiError(detail.error, 'not_found'))) {
    return (
      <div className="space-y-3">
        {back}
        <Notice tone="warning">{t('toolBuilder.releases.detail.notFound')}</Notice>
      </div>
    )
  }
  if (detail.isPending) return <Loading />
  if (detail.isError) return <LoadFailed error={detail.error} onRetry={() => void detail.refetch()} />
  const release: ReleaseDetail = detail.data
  return (
    <article aria-labelledby="tb-release-title" className="space-y-5">
      {back}
      <header className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="tb-release-title" className="font-mono text-xl font-semibold text-stone-900 dark:text-stone-100">
            {t('toolBuilder.runtime.version', { number: release.number })}
          </h2>
          <BadgeFor badge={badge} />
          {release.restoredFrom !== null ? <span className="text-sm text-stone-500">{t('toolBuilder.releases.restoredFrom', { number: release.restoredFrom })}</span> : null}
          {!release.live ? (
            <Button size="sm" icon={<RotateCcw />} onClick={() => onRestore(release)} className="ml-auto">
              {t('toolBuilder.releases.restore.confirm', { number: release.number })}
            </Button>
          ) : null}
        </div>
        <p className={cn('mt-2 text-sm whitespace-pre-wrap', release.note ? 'text-stone-800 dark:text-stone-200' : 'text-stone-400 italic')}>{release.note || t('toolBuilder.releases.noNote')}</p>
        <p className="mt-1 text-xs text-stone-500">{t('toolBuilder.releases.byline', { name: release.publishedBy.displayName, time: formatTime(release.publishedAt) })}</p>
      </header>

      <section aria-labelledby="tb-release-changes" className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <h3 id="tb-release-changes" className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          {t('toolBuilder.releases.detail.changes')}
        </h3>
        <div className="mt-2">{release.changes.length === 0 ? <p className="text-sm text-stone-500">{t('toolBuilder.releases.detail.noChanges')}</p> : <ChangeList changes={release.changes} />}</div>
      </section>

      <section aria-labelledby="tb-release-compare" className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="tb-release-compare" className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {t('toolBuilder.releases.detail.compare')}
          </h3>
          {live && !release.live ? (
            <Button size="sm" icon={<GitCompareArrows />} aria-expanded={comparing} onClick={() => setComparing((value) => !value)}>
              {comparing ? t('toolBuilder.releases.detail.hideCompare') : t('toolBuilder.releases.detail.compare')}
            </Button>
          ) : null}
        </div>
        {release.live ? (
          <p className="mt-2 text-sm text-stone-500">{t('toolBuilder.releases.detail.isLive')}</p>
        ) : !live ? (
          <p className="mt-2 text-sm text-stone-500">{t('toolBuilder.releases.detail.noLive')}</p>
        ) : comparing ? (
          liveDetail.isPending ? (
            <Loading />
          ) : liveDetail.isError ? (
            <LoadFailed error={liveDetail.error} onRetry={() => void liveDetail.refetch()} />
          ) : (
            <CompareView document={release.document} number={release.number} live={liveDetail.data.document} liveNumber={live.number} />
          )
        ) : null}
      </section>
    </article>
  )
}

function CompareView({ document, number, live, liveNumber }: { document: Document; number: number; live: Document; liveNumber: number }) {
  const { t } = useText()
  const rows = compareDocuments(document, live)
  return (
    <div className="mt-3">
      <p className="text-xs text-stone-500">{t('toolBuilder.releases.detail.compareTitle', { number, live: liveNumber })}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{t('toolBuilder.releases.detail.same')}</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {rows.map((row) => (
            <CompareRowView key={`${row.kind}:${row.id}`} row={row} number={number} liveNumber={liveNumber} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CompareRowView({ row, number, liveNumber }: { row: CompareRow; number: number; liveNumber: number }) {
  const { t } = useText()
  const leftLines = row.left === undefined ? [] : JSON.stringify(row.left, null, 2).split('\n')
  const rightLines = row.right === undefined ? [] : JSON.stringify(row.right, null, 2).split('\n')
  // A line (with its indentation) absent from the other side is marked: a cheap, readable line diff.
  const side = (lines: string[], other: string[], present: boolean, heading: string) => {
    const otherSet = new Set(other)
    return (
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-semibold tracking-wide text-stone-500 uppercase">{heading}</p>
        {!present ? (
          <p className="rounded-md border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-400 italic dark:border-stone-700">{t('toolBuilder.releases.detail.only')}</p>
        ) : (
          <pre className="max-h-64 overflow-auto rounded-md bg-stone-50 py-2 font-mono text-[11px] leading-relaxed text-stone-800 dark:bg-stone-950 dark:text-stone-200">
            {lines.map((line, index) => {
              const differs = other.length > 0 && !otherSet.has(line)
              return (
                // Lines are positional; the index is their identity.
                <span key={index} className={cn('block px-2', differs ? 'bg-busy-soft text-busy-ink dark:bg-amber-950 dark:text-amber-200' : undefined)}>
                  <span aria-hidden className="mr-1.5 inline-block w-2 select-none">
                    {differs ? '~' : ' '}
                  </span>
                  {line}
                </span>
              )
            })}
          </pre>
        )}
      </div>
    )
  }
  // `op` reads from live's side: added = only in this release.
  return (
    <li className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs text-stone-500">{t(CHANGE_LABEL[row.kind][row.op])}</span>
        <span className="text-sm font-medium text-stone-900 dark:text-stone-100">{row.label}</span>
        {row.label !== row.id ? <span className="font-mono text-xs text-stone-400">{row.id}</span> : null}
      </p>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        {side(leftLines, rightLines, row.left !== undefined, t('toolBuilder.runtime.version', { number }))}
        {side(rightLines, leftLines, row.right !== undefined, t('toolBuilder.home.live', { number: liveNumber }))}
      </div>
    </li>
  )
}

function RestoreDialog({
  slug,
  release,
  next,
  onClose,
  onRestored,
}: {
  slug: string
  release: Release | null
  next: number
  onClose: () => void
  onRestored: (release: Release, from: number) => void
}) {
  const { t } = useText()
  const id = useId()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const restore = useMutation({
    mutationFn: (target: Release) => api.releases.restore(slug, target.number, note.trim() === '' ? undefined : note.trim()),
    onSuccess: async (created, target) => {
      await invalidateTool(queryClient, slug)
      setNote('')
      onClose()
      onRestored(created, target.number)
    },
  })
  return (
    <ConfirmDialog
      open={release !== null}
      onOpenChange={(open) => {
        if (open) return
        restore.reset()
        setNote('')
        onClose()
      }}
      title={release ? t('toolBuilder.releases.restore.title', { number: release.number }) : ''}
      body={
        release ? (
          <div className="space-y-4">
            <p>{t('toolBuilder.releases.restore.body', { number: release.number, next })}</p>
            <Field id={`${id}-note`} label={t('toolBuilder.releases.restore.note')}>
              <TextInput id={`${id}-note`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
            </Field>
          </div>
        ) : null
      }
      confirmLabel={release ? t('toolBuilder.releases.restore.confirm', { number: release.number }) : ''}
      onConfirm={() => release && restore.mutate(release)}
      pending={restore.isPending}
      error={restore.error}
    />
  )
}
