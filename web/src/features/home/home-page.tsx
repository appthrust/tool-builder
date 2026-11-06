// `/`: the tools the caller can open, grouped "You can edit" / "You can use",
// with search. Administrators also get "New tool" (POST /tools, slug derived
// from the name until edited) and the link to data sources.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Database, LayoutDashboard, PencilRuler, Plus, Search, X } from 'lucide-react'
import { useId, useState } from 'react'
import { api, isApiError } from '../../api/client'
import { invalidateTool, meQuery, toolsQuery } from '../../api/queries'
import type { ToolSummary } from '../../api/types'
import { useText } from '../../i18n'
import { paths } from '../../routes/paths'
import {
  ActionError,
  Button,
  cn,
  Dialog,
  EmptyState,
  Field,
  HrefLink,
  IconButton,
  LinkButton,
  Loading,
  LoadFailed,
  PageHeader,
  Section,
  TextArea,
  TextInput,
  useDocumentTitle,
} from '../../ui'

const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/** `Order desk` → `order-desk`; letters outside a–z (e.g. Japanese) drop out, so the slug may need typing. */
export function deriveSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '')
}

export function HomePage() {
  const { t } = useText()
  useDocumentTitle(t('toolBuilder.nav.tools'))
  const tools = useQuery(toolsQuery)
  const me = useQuery(meQuery)
  const admin = me.data?.roles.admin === true
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const searchId = useId()

  const needle = query.trim().toLowerCase()
  const visible = (tools.data ?? []).filter(
    (tool) => !needle || tool.name.toLowerCase().includes(needle) || tool.slug.includes(needle) || tool.description.toLowerCase().includes(needle)
  )
  const editable = visible.filter((tool) => tool.access.edit)
  const usable = visible.filter((tool) => !tool.access.edit && tool.access.use)

  return (
    <>
      <PageHeader
        title={t('toolBuilder.nav.tools')}
        lead={t('toolBuilder.home.lead')}
        actions={
          admin ? (
            <>
              <LinkButton href={paths.dataSources} icon={<Database />}>
                {t('toolBuilder.nav.dataSources')}
              </LinkButton>
              <Button tone="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                {t('toolBuilder.home.newTool')}
              </Button>
            </>
          ) : null
        }
      />
      {tools.isPending ? (
        <Loading />
      ) : tools.isError ? (
        <LoadFailed error={tools.error} onRetry={() => void tools.refetch()} />
      ) : tools.data.length === 0 ? (
        admin ? (
          <EmptyState
            icon={<LayoutDashboard />}
            title={t('toolBuilder.home.emptyAdmin.title')}
            body={t('toolBuilder.home.emptyAdmin.body')}
            action={
              <Button tone="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                {t('toolBuilder.home.newTool')}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<LayoutDashboard />} title={t('toolBuilder.home.emptyUser.title')} body={t('toolBuilder.home.emptyUser.body')} />
        )
      ) : (
        <>
          <div className="relative mb-6 max-w-sm">
            <label htmlFor={searchId} className="sr-only">
              {t('toolBuilder.home.search')}
            </label>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
            <TextInput
              id={searchId}
              type="search"
              value={query}
              placeholder={t('toolBuilder.home.search')}
              onChange={(event) => setQuery(event.target.value)}
              className="pr-10 pl-9 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <IconButton label={t('toolBuilder.renderer.search.clear')} icon={<X />} className="absolute top-1/2 right-0.5 -translate-y-1/2" onClick={() => setQuery('')} />
            ) : null}
          </div>
          {visible.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title={t('toolBuilder.home.noMatches', { query: query.trim() })}
              action={<Button onClick={() => setQuery('')}>{t('toolBuilder.renderer.search.clear')}</Button>}
            />
          ) : (
            <>
              {editable.length > 0 ? <ToolGroup title={t('toolBuilder.home.canEdit')} tools={editable} /> : null}
              {usable.length > 0 ? <ToolGroup title={t('toolBuilder.home.canUse')} tools={usable} /> : null}
            </>
          )}
        </>
      )}
      {admin ? <NewToolDialog open={creating} onOpenChange={setCreating} /> : null}
    </>
  )
}

function ToolGroup({ title, tools }: { title: string; tools: ToolSummary[] }) {
  const { t } = useText()
  return (
    <Section title={title} actions={<span className="text-xs text-stone-500 dark:text-stone-400">{t('toolBuilder.home.count', { count: tools.length })}</span>}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {tools.map((tool) => (
          <li key={tool.id}>
            <ToolCard tool={tool} />
          </li>
        ))}
      </ul>
    </Section>
  )
}

function ToolCard({ tool }: { tool: ToolSummary }) {
  const { t, locale } = useText()
  const published = tool.liveReleaseNumber !== null
  // A tool without a live release opens in the editor (members cannot open it yet).
  const primaryHref = published ? paths.tool(tool.slug) : paths.edit(tool.slug)
  return (
    <article className="group relative flex h-full flex-col rounded-lg border border-line bg-white p-4 shadow-xs transition-colors hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
          <LayoutDashboard className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-stone-900 dark:text-stone-50">
            <HrefLink href={primaryHref} className="after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none">
              {tool.name}
            </HrefLink>
          </h3>
          <p className="truncate font-mono text-[11px] text-stone-500 dark:text-stone-400">/t/{tool.slug}</p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap ring-1 ring-inset',
            published
              ? 'bg-accent-soft text-accent-strong ring-accent-line dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-500/30'
              : 'bg-stone-100 text-stone-600 ring-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700'
          )}
        >
          {published ? t('toolBuilder.home.live', { number: tool.liveReleaseNumber ?? 0 }) : t('toolBuilder.home.unpublished')}
        </span>
      </div>
      <p className={cn('mt-3 line-clamp-2 flex-1 text-xs', tool.description ? 'text-stone-600 dark:text-stone-300' : 'text-stone-400 dark:text-stone-500')}>
        {tool.description || t('toolBuilder.home.noDescription')}
      </p>
      <div className="mt-3 flex items-center gap-2">
        {tool.access.edit ? (
          <span className="truncate text-[11px] text-stone-500 dark:text-stone-400">
            {t('toolBuilder.home.draftUpdated', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(tool.draftUpdatedAt)) })}
          </span>
        ) : null}
        {tool.access.edit && published ? (
          // Above the card-wide link so both stay clickable.
          <LinkButton
            size="sm"
            tone="ghost"
            href={paths.edit(tool.slug)}
            icon={<PencilRuler />}
            aria-label={t('toolBuilder.home.editNamed', { tool: tool.name })}
            className="relative z-[1] ml-auto"
          >
            {t('toolBuilder.runtime.openEditor')}
          </LinkButton>
        ) : null}
      </div>
    </article>
  )
}

function NewToolDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useText()
  const client = useQueryClient()
  const navigate = useNavigate()
  const nameId = useId()
  const slugId = useId()
  const descriptionId = useId()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const create = useMutation({
    mutationFn: () => api.tools.create({ name: name.trim(), slug, description: description.trim() || undefined }),
    onSuccess: async (tool) => {
      await invalidateTool(client, tool.slug)
      onOpenChange(false)
      void navigate({ href: paths.edit(tool.slug) })
    },
  })

  const reset = () => {
    setName('')
    setSlug('')
    setSlugEdited(false)
    setDescription('')
    setSubmitted(false)
    create.reset()
  }

  const nameError = submitted && name.trim() === '' ? t('toolBuilder.home.create.nameRequired') : undefined
  const slugTaken = isApiError(create.error, 'slug_taken')
  const slugError =
    submitted && !SLUG.test(slug) ? t('toolBuilder.home.create.slugInvalid') : slugTaken ? t('toolBuilder.errors.slug_taken') : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return
        if (!next) reset()
        onOpenChange(next)
      }}
      title={t('toolBuilder.home.newTool')}
      description={t('toolBuilder.home.create.description')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={create.isPending}>
            {t('toolBuilder.common.cancel')}
          </Button>
          <Button tone="primary" type="submit" form={`${nameId}-form`} loading={create.isPending}>
            {t('toolBuilder.home.create.submit')}
          </Button>
        </>
      }
    >
      <form
        id={`${nameId}-form`}
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          setSubmitted(true)
          if (name.trim() === '' || !SLUG.test(slug)) return
          create.mutate()
        }}
      >
        <Field id={nameId} label={t('toolBuilder.home.create.name')} required error={nameError}>
          <TextInput
            id={nameId}
            value={name}
            autoFocus
            invalid={Boolean(nameError)}
            onChange={(event) => {
              setName(event.target.value)
              if (!slugEdited) setSlug(deriveSlug(event.target.value))
            }}
          />
        </Field>
        <Field id={slugId} label={t('toolBuilder.home.create.slug')} required error={slugError} hint={t('toolBuilder.home.create.slugHint', { slug: slug || 'order-desk' })}>
          <TextInput
            id={slugId}
            value={slug}
            invalid={Boolean(slugError)}
            spellCheck={false}
            autoCapitalize="off"
            className="font-mono"
            onChange={(event) => {
              setSlugEdited(true)
              setSlug(event.target.value.toLowerCase())
              if (slugTaken) create.reset()
            }}
          />
        </Field>
        <Field id={descriptionId} label={<>{t('toolBuilder.home.create.descriptionLabel')} <span className="font-normal text-stone-500">({t('toolBuilder.home.create.optional')})</span></>}>
          <TextArea id={descriptionId} value={description} className="min-h-20" onChange={(event) => setDescription(event.target.value)} />
        </Field>
        {create.isError && !slugTaken ? <ActionError error={create.error} /> : null}
      </form>
    </Dialog>
  )
}
