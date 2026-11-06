// `/edit/<slug>/*`: the editor frame around the canvas, query editor,
// releases, sharing and runs. Top bar: inline tool name (PATCH), draft badge
// with the unpublished-change count (the same diff a release records, draft vs
// live), undo/redo, save state, Preview and Publish. Left nav with counts.
// Design: tool-builder-builtin-app.md "UI" `/edit/<slug>`, catalog mock "builder canvas".
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useParams, useRouterState } from '@tanstack/react-router'
import { Activity, ArrowLeft, Database, Eye, History, LayoutDashboard, Pencil, Redo2, RotateCw, Undo2, Upload, Users, type LucideIcon } from 'lucide-react'
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { grantsQuery, releasesQuery, runsQuery, toolQuery, toolsQuery } from '../../api/queries'
import { useText } from '../../i18n'
import { paths } from '../../routes/paths'
import { ActionError, Button, cn, HrefLink, IconButton, LinkButton, Loading, Notice, StatusPill, TextInput, useDocumentTitle } from '../../ui'
import { useDraft, type Draft } from './draft-store'
import { documentChanges } from './releases/changes'

/** The runs count stops here (the list endpoint is limited); more shows as "50+". */
const RUNS_COUNT_LIMIT = 50

export function EditorShell() {
  const { slug } = useParams({ strict: false })
  const { t } = useText()
  const tool = useQuery(toolQuery(slug ?? ''))
  if (!slug) return null
  if (tool.isPending) return <Loading className="px-6" />
  if (tool.isError) {
    return (
      <div className="p-6">
        <ActionError error={tool.error} />
      </div>
    )
  }
  if (!tool.data.access.edit || !tool.data.draft) {
    return (
      <div className="p-6">
        <Notice tone="error" title={t('toolBuilder.editor.noEditAccess.title')}>
          {t('toolBuilder.editor.noEditAccess.body')}
        </Notice>
      </div>
    )
  }
  return <EditorFrame slug={slug} />
}

function EditorFrame({ slug }: { slug: string }) {
  const draft = useDraft(slug)
  const { t } = useText()
  useDocumentTitle(t('toolBuilder.editor.documentTitle', { name: draft.tool.name }))
  useUndoShortcuts(draft)
  useLeaveWarning(draft.dirty || draft.saving)

  return (
    // From md up the editor fills the viewport under the app bar and each screen scrolls inside it,
    // so the canvas keeps its palette, panel and status bar in view; below md the page scrolls.
    <div className="flex min-h-0 flex-1 flex-col md:h-[calc(100dvh-3.5rem)] md:flex-none">
      <TopBar slug={slug} draft={draft} />
      {draft.conflict ? (
        <Notice
          tone="warning"
          className="mx-4 mt-3 md:mx-6"
          title={t('toolBuilder.editor.conflict.title')}
          actions={
            <Button size="sm" tone="primary" icon={<RotateCw />} onClick={() => void draft.reload()}>
              {t('toolBuilder.editor.conflict.reload')}
            </Button>
          }
        >
          {t('toolBuilder.editor.conflict.body')}
        </Notice>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <EditorNav slug={slug} draft={draft} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-y-auto">
          <Suspense fallback={<Loading className="px-6" />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

function TopBar({ slug, draft }: { slug: string; draft: Draft }) {
  const { t } = useText()
  const changes = documentChanges(draft.tool.live?.document ?? null, draft.document)
  const nextRelease = (draft.tool.liveReleaseNumber ?? 0) + 1
  const publishable = changes.length > 0 || draft.tool.live === null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-200 bg-white px-4 py-2 md:px-6 dark:border-stone-800 dark:bg-stone-950">
      <HrefLink
        href={paths.home}
        className="-ml-2 flex size-10 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-stone-900 md:size-8 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
        aria-label={t('toolBuilder.editor.backToTools')}
        title={t('toolBuilder.editor.backToTools')}
      >
        <ArrowLeft aria-hidden className="size-4" />
      </HrefLink>
      <ToolName slug={slug} name={draft.tool.name} />
      <DraftBadge live={draft.tool.live !== null} count={changes.length} />
      <div className="flex items-center gap-0.5">
        <IconButton label={t('toolBuilder.editor.undo')} icon={<Undo2 />} disabled={!draft.canUndo} onClick={draft.undo} />
        <IconButton label={t('toolBuilder.editor.redo')} icon={<Redo2 />} disabled={!draft.canRedo} onClick={draft.redo} />
      </div>
      <SaveState draft={draft} />
      <div className="ml-auto flex items-center gap-2">
        <LinkButton size="sm" href={paths.preview(slug)} icon={<Eye />} target="_blank" rel="noreferrer">
          {t('toolBuilder.editor.preview')}
        </LinkButton>
        {publishable ? (
          <LinkButton size="sm" tone="primary" icon={<Upload />} href={`${paths.editReleases(slug)}?publish=1`}>
            {t('toolBuilder.editor.publish', { number: nextRelease })}
          </LinkButton>
        ) : (
          <Button size="sm" tone="primary" icon={<Upload />} disabled title={t('toolBuilder.editor.nothingToPublish')}>
            {t('toolBuilder.editor.publish', { number: nextRelease })}
          </Button>
        )}
      </div>
    </div>
  )
}

/** The tool name; click (or Enter on the button) to rename in place. Enter saves, Escape cancels. */
function ToolName({ slug, name }: { slug: string; name: string }) {
  const { t } = useText()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)
  const rename = useMutation({
    mutationFn: (next: string) => api.tools.update(slug, { name: next }),
    onSuccess: (tool) => {
      queryClient.setQueryData(toolQuery(slug).queryKey, tool)
      void queryClient.invalidateQueries({ queryKey: toolsQuery.queryKey })
      setEditing(false)
    },
  })
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(name)
          rename.reset()
          setEditing(true)
        }}
        className="group flex min-h-10 max-w-64 items-center gap-1.5 rounded-md px-1.5 text-left text-sm font-semibold text-stone-900 hover:bg-stone-100 md:min-h-8 dark:text-stone-100 dark:hover:bg-stone-800"
        title={t('toolBuilder.editor.rename')}
      >
        <span className="truncate">{name}</span>
        <Pencil aria-hidden className="size-3.5 shrink-0 text-stone-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        <span className="sr-only">{t('toolBuilder.editor.rename')}</span>
      </button>
    )
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = value.trim()
    if (!next || next === name) {
      setEditing(false)
      return
    }
    rename.mutate(next)
  }
  return (
    <form onSubmit={submit} className="relative flex items-center gap-2">
      <TextInput
        ref={inputRef}
        id="tool-name"
        aria-label={t('toolBuilder.home.create.name')}
        value={value}
        maxLength={120}
        invalid={rename.isError || value.trim() === ''}
        disabled={rename.isPending}
        onChange={(event) => setValue(event.target.value)}
        onBlur={(event) => {
          if (!rename.isPending && !rename.isError) submit(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setEditing(false)
          }
        }}
        className="w-64 font-semibold"
      />
      {rename.isError ? (
        <div className="absolute top-full left-0 z-20 mt-1 w-80">
          <ActionError error={rename.error} />
        </div>
      ) : null}
    </form>
  )
}

function DraftBadge({ live, count }: { live: boolean; count: number }) {
  const { t } = useText()
  if (!live) return <StatusPill tone="busy">{t('toolBuilder.editor.badge.unpublished')}</StatusPill>
  if (count === 0) return <StatusPill tone="ok">{t('toolBuilder.editor.badge.upToDate')}</StatusPill>
  return <StatusPill tone="busy">{count === 1 ? t('toolBuilder.editor.badge.oneChange') : t('toolBuilder.editor.badge.changes', { count })}</StatusPill>
}

function SaveState({ draft }: { draft: Draft }) {
  const { t, locale } = useText()
  if (draft.conflict) return null
  if (draft.saving) return <span className="text-xs text-stone-500" role="status">{t('toolBuilder.editor.save.saving')}</span>
  if (draft.saveError) {
    return (
      <span className="flex items-center gap-2 text-xs text-bad-ink dark:text-red-300" role="alert">
        {t('toolBuilder.editor.save.failed')}
        <Button size="sm" tone="ghost" icon={<RotateCw />} onClick={() => void draft.save()}>
          {t('toolBuilder.common.retry')}
        </Button>
      </span>
    )
  }
  if (draft.dirty) return <span className="text-xs text-stone-500">{t('toolBuilder.editor.save.pending')}</span>
  if (draft.savedAt === null) return null
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(draft.savedAt)
  return <span className="text-xs text-stone-500">{t('toolBuilder.editor.save.saved', { time })}</span>
}

type NavItem = { href: string; label: string; icon: LucideIcon; count: string | null; exact: boolean }

function EditorNav({ slug, draft }: { slug: string; draft: Draft }) {
  const { t } = useText()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const releases = useQuery(releasesQuery(slug))
  const grants = useQuery(grantsQuery(slug))
  const runs = useQuery(runsQuery(slug, RUNS_COUNT_LIMIT))
  const page = draft.document.pages[0]
  const runCount = runs.data ? (runs.data.length >= RUNS_COUNT_LIMIT ? `${RUNS_COUNT_LIMIT}+` : String(runs.data.length)) : null
  const items: NavItem[] = [
    { href: paths.edit(slug), label: t('toolBuilder.editor.nav.editor'), icon: LayoutDashboard, count: String(page?.components.length ?? 0), exact: true },
    { href: paths.editQueries(slug), label: t('toolBuilder.editor.nav.queries'), icon: Database, count: String(draft.document.queries.length), exact: false },
    { href: paths.editReleases(slug), label: t('toolBuilder.editor.nav.releases'), icon: History, count: releases.data ? String(releases.data.length) : null, exact: false },
    { href: paths.editSharing(slug), label: t('toolBuilder.editor.nav.sharing'), icon: Users, count: grants.data ? String(grants.data.groups.length) : null, exact: false },
    { href: paths.editRuns(slug), label: t('toolBuilder.editor.nav.runs'), icon: Activity, count: runCount, exact: false },
  ]
  return (
    <nav
      aria-label={t('toolBuilder.editor.nav.label')}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-stone-200 bg-white px-2 py-1.5 md:w-48 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:px-2 md:py-3 dark:border-stone-800 dark:bg-stone-950"
    >
      {items.map((item) => {
        const current = item.exact ? pathname === item.href || pathname === `${item.href}/` : pathname.startsWith(item.href)
        return (
          <HrefLink
            key={item.href}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex min-h-10 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm whitespace-nowrap md:min-h-9',
              current
                ? 'bg-accent-soft font-medium text-accent-strong dark:bg-accent/20 dark:text-accent-line'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100'
            )}
          >
            <item.icon aria-hidden className="size-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.count !== null ? <span className={cn('text-xs tabular-nums', current ? 'text-accent-strong dark:text-accent-line' : 'text-stone-400')}>{item.count}</span> : null}
          </HrefLink>
        )
      })}
    </nav>
  )
}

/** Inside text fields (and the SQL editor) the browser's own undo stays in charge. */
function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

function useUndoShortcuts(draft: Draft) {
  const { undo, redo } = draft
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || isTextTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])
}

/** Unsaved or in-flight edits: the browser asks before the tab closes. */
function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])
}
