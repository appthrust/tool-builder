// `/t/<slug>`: a tool as members use it — the live release through the
// component renderer — or, with `?draft=1` for editors, the draft (preview).
// A denied tool (403 `tool_forbidden`) is the request-access page naming the
// tool and the groups that edit it; the document is never revealed.
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Eye, LayoutDashboard, Lock, PencilRuler } from 'lucide-react'
import { isApiError } from '../../api/client'
import { releasesQuery, toolQuery, toolsQuery } from '../../api/queries'
import type { Release, Tool } from '../../api/types'
import { useText } from '../../i18n'
import type { Document } from '../../model/document'
import { Renderer } from '../../renderer/renderer'
import { ToolRuntimeProvider } from '../../renderer/runtime-context'
import { paths } from '../../routes/paths'
import { cn, EmptyState, HrefLink, LinkButton, Loading, LoadFailed, Notice, useDocumentTitle } from '../../ui'

export function ToolPage() {
  const params = useParams({ strict: false })
  const search = useSearch({ strict: false })
  const slug = params.slug ?? ''
  const wantsDraft = search.draft === true
  const tool = useQuery(toolQuery(slug))

  if (tool.isPending) return <Loading className="px-6" />
  if (tool.isError) {
    if (isApiError(tool.error, 'tool_forbidden')) return <DeniedPage slug={slug} details={tool.error.details} />
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <LoadFailed error={tool.error} onRetry={() => void tool.refetch()} />
      </div>
    )
  }
  return <ToolView tool={tool.data} previewRequested={wantsDraft} />
}

function ToolView({ tool, previewRequested }: { tool: Tool; previewRequested: boolean }) {
  const { t } = useText()
  useDocumentTitle(tool.name)
  const preview = previewRequested && tool.access.edit && tool.draft !== null
  const document: Document | null = preview ? tool.draft : (tool.live?.document ?? null)
  const releases = useQuery({ ...releasesQuery(tool.slug), enabled: tool.access.edit })
  const liveRelease = releases.data?.find((release) => release.live)

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] min-w-0">
      <ToolNav current={tool.slug} />
      <div className="min-w-0 flex-1 px-4 py-4 sm:px-5 sm:py-5">
        <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-[18px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">{tool.name}</h1>
              {!preview && tool.live ? <VersionPill number={tool.live.releaseNumber} /> : null}
            </div>
            {tool.description ? <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{tool.description}</p> : null}
          </div>
          {tool.access.edit ? (
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 sm:pt-0.5">
              {liveRelease && !preview ? <PublishedLine release={liveRelease} /> : null}
              <LinkButton size="sm" href={paths.edit(tool.slug)} icon={<PencilRuler />}>
                {t('toolBuilder.runtime.openEditor')}
              </LinkButton>
            </div>
          ) : null}
        </header>

        {preview ? (
          <Notice
            tone="warning"
            className="mb-4"
            title={t('toolBuilder.runtime.previewTitle')}
            actions={
              <>
                <LinkButton size="sm" href={paths.edit(tool.slug)} icon={<ArrowLeft />}>
                  {t('toolBuilder.runtime.backToEditor')}
                </LinkButton>
                {tool.live ? (
                  <LinkButton size="sm" tone="ghost" href={paths.tool(tool.slug)} icon={<Eye />}>
                    {t('toolBuilder.runtime.viewLive')}
                  </LinkButton>
                ) : null}
              </>
            }
          >
            {tool.live ? t('toolBuilder.runtime.previewBody', { number: tool.live.releaseNumber }) : t('toolBuilder.runtime.previewBodyUnpublished')}
          </Notice>
        ) : null}

        {document ? (
          // A new provider (fresh bindings) per tool and when switching between the live release and the draft.
          <ToolRuntimeProvider key={`${tool.slug}:${preview ? 'draft' : `live-${tool.live?.releaseNumber}`}`} slug={tool.slug} document={document} source={preview ? 'draft' : 'live'}>
            <Renderer />
          </ToolRuntimeProvider>
        ) : tool.access.edit ? (
          <EmptyState
            icon={<LayoutDashboard />}
            title={t('toolBuilder.runtime.unpublishedTitle')}
            body={t('toolBuilder.runtime.unpublishedBody')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {tool.draft ? (
                  <LinkButton size="sm" href={paths.preview(tool.slug)} icon={<Eye />}>
                    {t('toolBuilder.runtime.previewDraft')}
                  </LinkButton>
                ) : null}
                <LinkButton size="sm" tone="primary" href={paths.edit(tool.slug)} icon={<PencilRuler />}>
                  {t('toolBuilder.runtime.openEditor')}
                </LinkButton>
              </div>
            }
          />
        ) : (
          <EmptyState icon={<LayoutDashboard />} title={t('toolBuilder.runtime.unavailableTitle')} body={t('toolBuilder.runtime.unavailableBody')} />
        )}
      </div>
    </div>
  )
}

function VersionPill({ number }: { number: number }) {
  const { t } = useText()
  return (
    <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[11px] leading-4 font-medium text-stone-600 ring-1 ring-stone-200 ring-inset dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700">
      {t('toolBuilder.runtime.version', { number })}
    </span>
  )
}

function PublishedLine({ release }: { release: Release }) {
  const { t, locale } = useText()
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(release.publishedAt))
  const name = release.publishedBy.displayName
  return (
    <span className="text-[11px] whitespace-nowrap text-stone-500 dark:text-stone-400" title={new Date(release.publishedAt).toLocaleString(locale)}>
      {release.restoredFrom !== null
        ? t('toolBuilder.runtime.restored', { from: release.restoredFrom, date, name })
        : t('toolBuilder.runtime.published', { date, name })}
    </span>
  )
}

/** The caller's tools, the open one highlighted (desktop only; the top bar links home on phones). */
function ToolNav({ current }: { current: string }) {
  const { t } = useText()
  const tools = useQuery(toolsQuery)
  const usable = (tools.data ?? []).filter((tool) => tool.liveReleaseNumber !== null || tool.access.edit)
  return (
    <nav
      aria-label={t('toolBuilder.runtime.nav')}
      className="hidden w-56 shrink-0 flex-col gap-0.5 border-r border-line bg-white px-2 py-4 lg:flex dark:border-stone-800 dark:bg-stone-900"
    >
      <p className="px-2.5 pb-2 text-[11px] font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">{t('toolBuilder.runtime.nav')}</p>
      {usable.map((tool) => (
        <HrefLink
          key={tool.slug}
          href={paths.tool(tool.slug)}
          aria-current={tool.slug === current ? 'page' : undefined}
          className={cn(
            'flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-50',
            tool.slug === current && 'bg-accent-soft font-medium text-accent-strong hover:bg-accent-soft dark:bg-stone-800 dark:text-stone-50'
          )}
        >
          <LayoutDashboard aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{tool.name}</span>
        </HrefLink>
      ))}
      <HrefLink
        href={paths.home}
        className="mt-2 flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800"
      >
        <ArrowLeft aria-hidden className="size-4 shrink-0" />
        {t('toolBuilder.runtime.allTools')}
      </HrefLink>
    </nav>
  )
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [])

function DeniedPage({ slug, details }: { slug: string; details: Record<string, unknown> | undefined }) {
  const { t } = useText()
  const toolName = typeof details?.toolName === 'string' && details.toolName !== '' ? details.toolName : slug
  const editors = stringList(details?.editors)
  useDocumentTitle(toolName)
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-lg flex-col justify-center px-4 py-10">
      <div className="rounded-xl border border-line bg-white px-6 py-8 text-center shadow-xs dark:border-stone-700 dark:bg-stone-900">
        <span aria-hidden className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          <Lock className="size-5" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight break-words text-stone-900 dark:text-stone-50">{t('toolBuilder.runtime.denied.title', { tool: toolName })}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-stone-500 dark:text-stone-400">{t('toolBuilder.runtime.denied.body')}</p>
        {editors.length > 0 ? (
          <div className="mt-5 text-left">
            <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{t('toolBuilder.runtime.denied.editors')}</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {editors.map((name) => (
                <li key={name} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-200">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <LinkButton className="mt-6" href={paths.home} icon={<ArrowLeft />}>
          {t('toolBuilder.runtime.denied.back')}
        </LinkButton>
      </div>
    </div>
  )
}
