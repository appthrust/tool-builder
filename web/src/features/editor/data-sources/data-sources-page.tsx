// `/data-sources`: the databases, apps and built-in apps tools can query. Editors of
// any tool see the list (to know what their queries can use); only
// administrators connect and remove. Connecting a Project database creates the
// Platform connection and the data source in one request; the source is
// `pending` until the built-in app's new revision (which carries the connection) is
// running, then `ready`. A `builtin-app` source names a linked built-in app (`GET /links`)
// and mirrors its install state: `ready`, `pending` while it installs, `error`
// when it is gone. A source a query still uses cannot be deleted (409
// `data_source_in_use`, naming the tools when the server lists them).
// Design: tool-builder-builtin-app.md "UI" `/data-sources`, data-sources.md,
// builtin-app-connect tool-builder-sources.md §5.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Blocks, Database, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api, isApiError } from '../../../api/client'
import { installedAppLinksQuery, dataSourcesQuery, invalidateDataSources, meQuery, projectDatabasesQuery } from '../../../api/queries'
import type { InstalledAppLink, DataSource, ProjectDatabase } from '../../../api/types'
import { useText, type Translate } from '../../../i18n'
import type { MessageId } from '../../../copy'
import { paths } from '../../../routes/paths'
import { installedAppName, SOURCE_ICON } from './source-kinds'
import {
  ActionError,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  HrefLink,
  IconButton,
  Loading,
  LoadFailed,
  Notice,
  PageHeader,
  StatusPill,
  TextInput,
  useDocumentTitle,
  cn,
  type StatusTone,
} from '../../../ui'

/** Lower-case DNS label starting with a letter (the connection name also becomes an environment key, which cannot start with a digit). */
const DNS_LABEL = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/

/** The Project database list's engine (the platform provider id, upper-cased) as people know it; any other engine reads as a generic database type. */
const ENGINE_LABEL: Readonly<Record<string, MessageId>> = { CNPG: 'toolBuilder.dataSources.engine.postgres' }

/** Why a Project database cannot be connected (`ProjectDatabase.reason` codes); an unknown code reads generically. */
const REASON_TEXT: Readonly<Record<string, MessageId>> = { engine_unsupported: 'toolBuilder.dataSources.reason.engineUnsupported' }

/** "Orders DB (main)" → "orders-db-main": a DNS label proposal from a display name. */
export function deriveLabel(name: string): string {
  const label = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 63)
    .replace(/-+$/, '')
  return label
}

export function DataSourcesPage() {
  const { t } = useText()
  useDocumentTitle(t('toolBuilder.nav.dataSources'))
  const me = useQuery(meQuery)
  const sources = useQuery(dataSourcesQuery)
  const [connecting, setConnecting] = useState(false)
  const [addingInstalledApp, setAddingInstalledApp] = useState(false)
  const [deleting, setDeleting] = useState<DataSource | null>(null)

  if (me.isPending) return <Loading className="px-6" />
  if (me.isError) return <LoadFailed error={me.error} onRetry={() => void me.refetch()} />
  const admin = me.data.roles.admin
  if (isApiError(sources.error) && sources.error.status === 403) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Notice tone="error" title={t('toolBuilder.dataSources.noAccess.title')}>
          {t('toolBuilder.dataSources.noAccess.body')}
        </Notice>
      </div>
    )
  }
  const connectButtons = admin ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button icon={<Blocks />} onClick={() => setAddingInstalledApp(true)}>
        {t('toolBuilder.dataSources.addInstalledApp')}
      </Button>
      <Button tone="primary" icon={<Plus />} onClick={() => setConnecting(true)}>
        {t('toolBuilder.dataSources.connect')}
      </Button>
    </div>
  ) : null

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title={t('toolBuilder.nav.dataSources')}
        lead={admin ? t('toolBuilder.dataSources.lead') : t('toolBuilder.dataSources.leadEditor')}
        actions={connectButtons}
      />
      {sources.isPending ? (
        <Loading />
      ) : sources.isError ? (
        <LoadFailed error={sources.error} onRetry={() => void sources.refetch()} />
      ) : sources.data.length === 0 ? (
        <EmptyState
          icon={<Database />}
          title={t('toolBuilder.dataSources.empty.title')}
          body={t('toolBuilder.dataSources.empty.body')}
          action={connectButtons}
        />
      ) : (
        <SourceList sources={sources.data} onDelete={admin ? setDeleting : undefined} />
      )}
      {admin ? <ConnectDialog open={connecting} onOpenChange={setConnecting} existing={sources.data ?? []} /> : null}
      {admin ? <InstalledAppDialog open={addingInstalledApp} onOpenChange={setAddingInstalledApp} existing={sources.data ?? []} /> : null}
      {deleting ? <DeleteDialog source={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  )
}

/** `onDelete` absent (not an administrator): no remove buttons. */
function SourceList({ sources, onDelete }: { sources: DataSource[]; onDelete: ((source: DataSource) => void) | undefined }) {
  const { t, locale } = useText()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('toolBuilder.nav.dataSources')}</caption>
        <thead className="hidden border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500 md:table-header-group dark:border-stone-800 dark:bg-stone-900/60 dark:text-stone-400">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('toolBuilder.editor.fields.name')}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('toolBuilder.dataSources.col.status')}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('toolBuilder.dataSources.col.connection')}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {t('toolBuilder.dataSources.col.created')}
            </th>
            {onDelete ? (
              <th scope="col" className="w-12 px-4 py-2.5">
                <span className="sr-only">{t('toolBuilder.renderer.table.actionsColumn')}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {sources.map((source) => {
            const KindIcon = SOURCE_ICON[source.kind]
            return (
              <tr key={source.id} className="flex flex-wrap items-start gap-x-4 gap-y-1.5 px-4 py-3 md:table-row md:p-0">
                <td className="flex min-w-0 basis-full items-center gap-3 md:table-cell md:px-4 md:py-3">
                  <span className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                    >
                      <KindIcon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-stone-900 dark:text-stone-100">{source.name}</span>
                      <span className="block text-xs text-stone-500">
                        <span className="font-mono">{source.slug}</span> · {kindLabel(source, t)}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="md:table-cell md:px-4 md:py-3">
                  <SourceStatus source={source} />
                </td>
                <td className="font-mono text-xs text-stone-600 md:table-cell md:px-4 md:py-3 dark:text-stone-400">
                  {source.kind === 'builtin-app' ? (source.definition ?? '—') : (source.connectionName ?? source.baseUrl ?? '—')}
                </td>
                <td className="text-xs text-stone-500 md:table-cell md:px-4 md:py-3">
                  {date.format(new Date(source.createdAt))}
                </td>
                {onDelete ? (
                  <td className="ml-auto md:table-cell md:px-4 md:py-2 md:text-right">
                    <IconButton label={t('toolBuilder.dataSources.delete', { name: source.name })} icon={<Trash2 />} onClick={() => onDelete(source)} />
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** "Database", "App", or "Built-in app: Knowledge". */
function kindLabel(source: DataSource, t: Translate): string {
  if (source.kind === 'builtin-app') return t('toolBuilder.dataSources.kind.installedAppOf', { name: installedAppName(source.definition ?? '', t) })
  return source.kind === 'postgres' ? t('toolBuilder.dataSources.kind.postgres') : t('toolBuilder.dataSources.kind.http')
}

function SourceStatus({ source }: { source: DataSource }) {
  const { t } = useText()
  if (source.status === 'ready') return <StatusPill tone="ok">{t('toolBuilder.dataSources.status.ready')}</StatusPill>
  if (source.status === 'pending') {
    // A database waits for the rollout that carries its connection; a `builtin-app` source waits for the built-in app's installation.
    const installedApp = source.kind === 'builtin-app'
    return (
      <div className="flex flex-col items-start gap-1">
        <StatusPill tone="busy">{installedApp ? t('toolBuilder.dataSources.installedApp.installing') : t('toolBuilder.dataSources.status.pending')}</StatusPill>
        <span className="max-w-64 text-xs break-words text-stone-500">
          {installedApp ? (source.statusMessage ?? t('toolBuilder.dataSources.status.installingHint')) : t('toolBuilder.dataSources.status.pendingHint')}
        </span>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusPill tone="bad">{t('toolBuilder.dataSources.status.error')}</StatusPill>
      {source.statusMessage ? <span className="max-w-64 text-xs break-words text-bad-ink dark:text-red-300">{source.statusMessage}</span> : null}
    </div>
  )
}

function ConnectDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (open: boolean) => void; existing: DataSource[] }) {
  const { t } = useText()
  const queryClient = useQueryClient()
  const databases = useQuery({ ...projectDatabasesQuery, enabled: open })
  const [databaseId, setDatabaseId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState<string | null>(null)
  const [connection, setConnection] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  // Slug and connection name follow the name until the author edits them.
  const effectiveSlug = slug ?? deriveLabel(name)
  const effectiveConnection = connection ?? effectiveSlug
  const connected = new Set(existing.map((source) => source.destinationComponentId))
  // The values a 409 `slug_taken` described; the error applies only while they are unchanged.
  const [rejected, setRejected] = useState<{ slug: string; connection: string } | null>(null)

  // Clears the form and closes. Not guarded by `create.isPending`: the
  // mutation is still pending while `onSuccess` runs, and a guarded close
  // there left the dialog open showing the just-created slug as "taken".
  const reset = () => {
    setDatabaseId(null)
    setName('')
    setSlug(null)
    setConnection(null)
    setSubmitted(false)
    setRejected(null)
    create.reset()
    onOpenChange(false)
  }

  const create = useMutation({
    mutationFn: () =>
      api.dataSources.create({ kind: 'postgres', name: name.trim(), slug: effectiveSlug, connectionName: effectiveConnection, destinationComponentId: databaseId ?? '' }),
    onSuccess: async () => {
      await invalidateDataSources(queryClient)
      reset()
    },
    onError: (error) => {
      setRejected(isApiError(error, 'slug_taken') ? { slug: effectiveSlug, connection: effectiveConnection } : null)
    },
  })

  const close = (next: boolean) => {
    if (create.isPending) return
    if (next) onOpenChange(true)
    else reset()
  }

  const nameError = name.trim() === '' ? t('toolBuilder.dataSources.form.nameRequired') : undefined
  const serverTaken = rejected !== null && rejected.slug === effectiveSlug && rejected.connection === effectiveConnection
  const slugTaken = serverTaken || existing.some((source) => source.slug === effectiveSlug)
  const slugError = !DNS_LABEL.test(effectiveSlug) ? t('toolBuilder.dataSources.form.dnsLabel') : slugTaken ? t('toolBuilder.dataSources.form.slugTaken') : undefined
  const connectionError = !DNS_LABEL.test(effectiveConnection) ? t('toolBuilder.dataSources.form.dnsLabel') : undefined
  const databaseError = databaseId === null ? t('toolBuilder.dataSources.form.databaseRequired') : undefined
  const valid = !nameError && !slugError && !connectionError && !databaseError

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (valid) create.mutate()
  }

  const pick = (database: ProjectDatabase) => {
    setDatabaseId(database.componentId)
    if (name.trim() === '') setName(database.name)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={t('toolBuilder.dataSources.connect')}
      description={t('toolBuilder.dataSources.connectLead')}
      footer={
        <>
          <Button onClick={() => close(false)} disabled={create.isPending}>
            {t('toolBuilder.common.cancel')}
          </Button>
          <Button tone="primary" type="submit" form="connect-source" loading={create.isPending}>
            {t('toolBuilder.dataSources.connectSubmit')}
          </Button>
        </>
      }
    >
      <form id="connect-source" onSubmit={submit} noValidate className="flex flex-col gap-5">
        <fieldset aria-describedby={submitted && databaseError ? 'connect-database-error' : undefined}>
          <legend className="mb-2 text-sm font-medium text-stone-800 dark:text-stone-200">{t('toolBuilder.dataSources.kind.postgres')}</legend>
          {databases.isPending ? (
            <Loading className="py-3" />
          ) : databases.isError ? (
            <LoadFailed error={databases.error} onRetry={() => void databases.refetch()} />
          ) : databases.data.length === 0 ? (
            <p className="rounded-md border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">{t('toolBuilder.dataSources.form.noDatabases')}</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto" role="radiogroup" aria-label={t('toolBuilder.dataSources.kind.postgres')}>
              {databases.data.map((database) => {
                const already = connected.has(database.componentId)
                const disabled = !database.connectable || already
                const reason = already ? t('toolBuilder.dataSources.form.alreadyConnected') : database.reason === null ? null : t(REASON_TEXT[database.reason] ?? 'toolBuilder.dataSources.reason.other')
                const checked = databaseId === database.componentId
                return (
                  <li key={database.componentId}>
                    <label
                      className={cn(
                        'flex items-start gap-3 rounded-md border px-3 py-2.5',
                        disabled ? 'cursor-not-allowed border-stone-200 bg-stone-50 opacity-70 dark:border-stone-800 dark:bg-stone-900' : 'cursor-pointer hover:border-stone-400',
                        checked ? 'border-accent ring-1 ring-accent' : !disabled && 'border-stone-300 dark:border-stone-700'
                      )}
                    >
                      <input
                        type="radio"
                        name="database"
                        value={database.componentId}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => pick(database)}
                        className="mt-1 accent-[var(--color-accent)]"
                      />
                      <Database aria-hidden className="mt-0.5 size-4 shrink-0 text-stone-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-stone-900 dark:text-stone-100">{database.name}</span>
                        <span className="block text-xs text-stone-500">
                          {database.applicationName} · {t(ENGINE_LABEL[database.engine.toUpperCase()] ?? 'toolBuilder.dataSources.engine.other')}
                        </span>
                        {disabled && reason ? <span className="mt-0.5 block text-xs text-busy-ink dark:text-amber-300">{reason}</span> : null}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {submitted && databaseError ? (
            <p id="connect-database-error" className="mt-1.5 text-xs text-bad-ink">
              {databaseError}
            </p>
          ) : null}
        </fieldset>
        <Field id="connect-name" label={t('toolBuilder.editor.fields.name')} hint={t('toolBuilder.dataSources.form.nameHint')} error={submitted ? nameError : undefined} required>
          <TextInput id="connect-name" value={name} maxLength={120} invalid={submitted && !!nameError} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="connect-slug" label={t('toolBuilder.dataSources.form.slug')} hint={t('toolBuilder.dataSources.form.slugHint')} error={(submitted || slug !== null) ? slugError : undefined} required>
            <TextInput
              id="connect-slug"
              value={effectiveSlug}
              maxLength={63}
              spellCheck={false}
              invalid={(submitted || slug !== null) && !!slugError}
              onChange={(event) => setSlug(event.target.value)}
              className="font-mono"
            />
          </Field>
          <Field
            id="connect-connection"
            label={t('toolBuilder.dataSources.form.connection')}
            hint={t('toolBuilder.dataSources.form.connectionHint')}
            error={(submitted || connection !== null) ? connectionError : undefined}
            required
          >
            <TextInput
              id="connect-connection"
              value={effectiveConnection}
              maxLength={63}
              spellCheck={false}
              invalid={(submitted || connection !== null) && !!connectionError}
              onChange={(event) => setConnection(event.target.value)}
              className="font-mono"
            />
          </Field>
        </div>
        <Notice tone="info">{t('toolBuilder.dataSources.form.rolloutNote')}</Notice>
        {create.isError && !isApiError(create.error, 'slug_taken') ? <ActionError error={create.error} /> : null}
      </form>
    </Dialog>
  )
}

/** How the dialog shows a link: selectable (`Ready`, `Installing`) or a hint to install it first (`Absent`). */
const LINK_STATE: Record<Exclude<InstalledAppLink['state'], 'Unsupported'>, { tone: StatusTone; label: MessageId }> = {
  Ready: { tone: 'ok', label: 'toolBuilder.dataSources.status.ready' },
  Installing: { tone: 'busy', label: 'toolBuilder.dataSources.installedApp.installing' },
  Absent: { tone: 'neutral', label: 'toolBuilder.dataSources.installedApp.absent' },
}

/**
 * "Add a built-in app": the built-in apps this one declares links to (`GET /links`). `Unsupported` links are not
 * shown; an `Absent` one only says where to install it. An `Installing` one can be added now and turns
 * `ready` when the installation finishes.
 */
function InstalledAppDialog({ open, onOpenChange, existing }: { open: boolean; onOpenChange: (open: boolean) => void; existing: DataSource[] }) {
  const { t } = useText()
  const queryClient = useQueryClient()
  const links = useQuery({ ...installedAppLinksQuery, enabled: open })
  const [definition, setDefinition] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  // The slug a 409 `slug_taken` described; the error applies only while it is unchanged.
  const [rejected, setRejected] = useState<string | null>(null)
  const effectiveSlug = slug ?? deriveLabel(name)
  const added = new Set(existing.flatMap((source) => (source.kind === 'builtin-app' && source.definition ? [source.definition] : [])))
  const visible = (links.data ?? []).filter((link): link is InstalledAppLink & { state: keyof typeof LINK_STATE } => link.state !== 'Unsupported')

  // Not guarded by `create.isPending`, as in ConnectDialog: `onSuccess` closes while the mutation is still pending.
  const reset = () => {
    setDefinition(null)
    setName('')
    setSlug(null)
    setSubmitted(false)
    setRejected(null)
    create.reset()
    onOpenChange(false)
  }

  const create = useMutation({
    mutationFn: () => api.dataSources.create({ kind: 'builtin-app', definition: definition ?? '', name: name.trim(), slug: effectiveSlug }),
    onSuccess: async () => {
      await invalidateDataSources(queryClient)
      reset()
    },
    onError: (error) => setRejected(isApiError(error, 'slug_taken') ? effectiveSlug : null),
  })

  const close = (next: boolean) => {
    if (create.isPending) return
    if (next) onOpenChange(true)
    else reset()
  }

  const nameError = name.trim() === '' ? t('toolBuilder.dataSources.form.nameRequired') : undefined
  const slugTaken = rejected === effectiveSlug || existing.some((source) => source.slug === effectiveSlug)
  const slugError = !DNS_LABEL.test(effectiveSlug) ? t('toolBuilder.dataSources.form.dnsLabel') : slugTaken ? t('toolBuilder.dataSources.form.slugTaken') : undefined
  const installedAppError = definition === null ? t('toolBuilder.dataSources.form.installedAppRequired') : undefined
  const valid = !nameError && !slugError && !installedAppError

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (valid) create.mutate()
  }

  const pick = (link: InstalledAppLink) => {
    setDefinition(link.definition)
    if (name.trim() === '') setName(installedAppName(link.definition, t))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={t('toolBuilder.dataSources.addInstalledApp')}
      description={t('toolBuilder.dataSources.addInstalledAppLead')}
      footer={
        <>
          <Button onClick={() => close(false)} disabled={create.isPending}>
            {t('toolBuilder.common.cancel')}
          </Button>
          <Button tone="primary" type="submit" form="add-installed-app-source" loading={create.isPending}>
            {t('toolBuilder.dataSources.addInstalledAppSubmit')}
          </Button>
        </>
      }
    >
      <form id="add-installed-app-source" onSubmit={submit} noValidate className="flex flex-col gap-5">
        <fieldset aria-describedby={submitted && installedAppError ? 'add-installed-app-error' : undefined}>
          <legend className="mb-2 text-sm font-medium text-stone-800 dark:text-stone-200">{t('toolBuilder.dataSources.kind.installedApp')}</legend>
          {links.isPending ? (
            <Loading className="py-3" />
          ) : links.isError ? (
            <LoadFailed error={links.error} onRetry={() => void links.refetch()} />
          ) : visible.length === 0 ? (
            <p className="rounded-md border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500 dark:border-stone-700">{t('toolBuilder.dataSources.installedApp.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label={t('toolBuilder.dataSources.kind.installedApp')}>
              {visible.map((link) => {
                const label = installedAppName(link.definition, t)
                const already = added.has(link.definition)
                const disabled = link.state === 'Absent' || already
                const checked = definition === link.definition
                const state = LINK_STATE[link.state]
                const hint = already
                  ? t('toolBuilder.dataSources.installedApp.alreadyAdded')
                  : link.state === 'Absent'
                    ? t('toolBuilder.dataSources.installedApp.absentHint', { name: label })
                    : link.state === 'Installing'
                      ? t('toolBuilder.dataSources.installedApp.installingHint')
                      : null
                return (
                  <li key={link.definition}>
                    <label
                      className={cn(
                        'flex items-start gap-3 rounded-md border px-3 py-2.5',
                        disabled ? 'cursor-not-allowed border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900' : 'cursor-pointer hover:border-stone-400',
                        checked ? 'border-accent ring-1 ring-accent' : !disabled && 'border-stone-300 dark:border-stone-700'
                      )}
                    >
                      <input
                        type="radio"
                        name="installed-app"
                        value={link.definition}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => pick(link)}
                        aria-describedby={hint ? `add-installed-app-${link.definition}-hint` : undefined}
                        className="mt-1 accent-[var(--color-accent)]"
                      />
                      <Blocks aria-hidden className={cn('mt-0.5 size-4 shrink-0', disabled ? 'text-stone-400' : 'text-stone-500')} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className={cn('font-medium', disabled ? 'text-stone-500 dark:text-stone-400' : 'text-stone-900 dark:text-stone-100')}>{label}</span>
                          <StatusPill tone={state.tone}>{t(state.label)}</StatusPill>
                        </span>
                        <span className="block font-mono text-xs text-stone-500">{link.definition}</span>
                        {hint ? (
                          <span
                            id={`add-installed-app-${link.definition}-hint`}
                            className={cn('mt-0.5 block text-xs', link.state === 'Installing' && !already ? 'text-busy-ink dark:text-amber-300' : 'text-stone-600 dark:text-stone-400')}
                          >
                            {hint}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {submitted && installedAppError ? (
            <p id="add-installed-app-error" className="mt-1.5 text-xs text-bad-ink">
              {installedAppError}
            </p>
          ) : null}
        </fieldset>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="add-installed-app-name" label={t('toolBuilder.editor.fields.name')} hint={t('toolBuilder.dataSources.form.nameHint')} error={submitted ? nameError : undefined} required>
            <TextInput id="add-installed-app-name" value={name} maxLength={120} invalid={submitted && !!nameError} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field id="add-installed-app-slug" label={t('toolBuilder.dataSources.form.slug')} hint={t('toolBuilder.dataSources.form.slugHint')} error={(submitted || slug !== null) ? slugError : undefined} required>
            <TextInput
              id="add-installed-app-slug"
              value={effectiveSlug}
              maxLength={63}
              spellCheck={false}
              invalid={(submitted || slug !== null) && !!slugError}
              onChange={(event) => setSlug(event.target.value)}
              className="font-mono"
            />
          </Field>
        </div>
        {create.isError && !isApiError(create.error, 'slug_taken') ? <ActionError error={create.error} /> : null}
      </form>
    </Dialog>
  )
}

type BlockingTool = { name: string; slug: string | null }

/** Tools named by a 409 `data_source_in_use` (`details.tools`: objects with name/slug, or plain names). */
export function blockingTools(error: unknown): BlockingTool[] {
  if (!isApiError(error, 'data_source_in_use')) return []
  const tools = error.details?.tools
  if (!Array.isArray(tools)) return []
  return tools.flatMap((tool): BlockingTool[] => {
    if (typeof tool === 'string') return [{ name: tool, slug: null }]
    if (tool && typeof tool === 'object') {
      const name = 'name' in tool && typeof tool.name === 'string' ? tool.name : undefined
      const slug = 'slug' in tool && typeof tool.slug === 'string' ? tool.slug : null
      return name || slug ? [{ name: name ?? slug ?? '', slug }] : []
    }
    return []
  })
}

function DeleteDialog({ source, onClose }: { source: DataSource; onClose: () => void }) {
  const { t } = useText()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api.dataSources.remove(source.id),
    onSuccess: async () => {
      await invalidateDataSources(queryClient)
      onClose()
    },
  })
  const inUse = isApiError(remove.error, 'data_source_in_use')
  const tools = blockingTools(remove.error)
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      tone="danger"
      title={t('toolBuilder.dataSources.deleteTitle', { name: source.name })}
      confirmLabel={t('toolBuilder.editor.canvas.delete')}
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
      error={remove.isError && !inUse ? remove.error : undefined}
      body={
        <div className="flex flex-col gap-3">
          <p>{source.kind === 'builtin-app' ? t('toolBuilder.dataSources.deleteBodyInstalledApp') : t('toolBuilder.dataSources.deleteBody')}</p>
          {inUse ? (
            <Notice tone="error" title={t('toolBuilder.dataSources.inUse.title')}>
              {tools.length > 0 ? (
                <>
                  <p>{t('toolBuilder.dataSources.inUse.tools')}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {tools.map((tool) => (
                      <li key={tool.slug ?? tool.name}>
                        {tool.slug ? (
                          <HrefLink href={paths.editQueries(tool.slug)} className="font-medium underline">
                            {tool.name}
                          </HrefLink>
                        ) : (
                          tool.name
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>{t('toolBuilder.dataSources.inUse.generic')}</p>
              )}
            </Notice>
          ) : null}
        </div>
      }
    />
  )
}
