// `/edit/<slug>/queries[/<queryId>]`: data sources and queries on the left,
// the selected query's editor in the middle (SQL or HTTP request, Run,
// results), its parameters and limits on the right. Every edit goes into the
// draft through `useDraft` (autosaved; Save flushes now). Run executes the
// *saved* draft query on the server, so it saves first. A query on a `builtin-app`
// source gets an operation picker that fills its HTTP request.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { AlertCircle, Play, Plus, Save, Table2, Trash2, Braces } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { api, isApiError } from '../../../api/client'
import { dataSourcesQuery, invalidateTool } from '../../../api/queries'
import type { DataSource, DataSourceKind, DataSourceStatus } from '../../../api/types'
import type { MessageId } from '../../../copy'
import { useText } from '../../../i18n'
import { HTTP_METHODS, type Document, type HttpMethod, type Query, type QueryMode } from '../../../model/document'
import { problemTarget, type Problem } from '../../../model/document.schema'
import { problemText } from '../../../model/problems'
import { paths } from '../../../routes/paths'
import { Badge, Button, cn, ConfirmDialog, EmptyState, Field, HrefLink, IconButton, Notice, SegmentedControl, Select, StatusPill, TextArea, TextInput, useDocumentTitle, type StatusTone } from '../../../ui'
import { useDraft, type Draft } from '../draft-store'
import { FiltersSection } from './filters-section'
import { installedAppName, SOURCE_ICON } from '../data-sources/source-kinds'
import { InsertPlaceholderDialog } from './insert-placeholder-dialog'
import { NewQueryDialog, type SourceChoice } from './new-query-dialog'
import { OperationPicker } from './operation-picker'
import { ParamsPanel } from './params-panel'
import { PLACEHOLDER_NAME, sampleFromLiteral, sampleInput } from './placeholders'
import { newQuery, removeQuery, setMode, updateQuery } from './query-ops'
import { ResultsPanel, type RunState } from './results-panel'
import { SchemaSheet } from './schema-sheet'
import { SqlEditor, type SqlEditorHandle } from './sql-editor'

const STATUS: Record<DataSourceStatus, { tone: StatusTone; label: MessageId }> = {
  ready: { tone: 'ok', label: 'toolBuilder.dataSources.status.ready' },
  pending: { tone: 'busy', label: 'toolBuilder.dataSources.status.pending' },
  error: { tone: 'bad', label: 'toolBuilder.dataSources.status.error' },
}

const KIND_LABEL: Record<DataSourceKind, MessageId> = {
  postgres: 'toolBuilder.dataSources.kind.postgres',
  http: 'toolBuilder.dataSources.kind.http',
  'builtin-app': 'toolBuilder.dataSources.kind.installedApp',
}

/** What the page knows about a query's source: the admin list when readable, else only the id the draft uses. */
type SourceView = { id: string; name: string; kind: DataSourceKind; source: DataSource | undefined }

function sourceView(id: string, sources: DataSource[] | undefined, fallbackKind: DataSourceKind, unknownName: string): SourceView {
  const source = sources?.find((item) => item.id === id)
  return source ? { id, name: source.name, kind: source.kind, source } : { id, name: unknownName, kind: fallbackKind, source: undefined }
}

function SourceIcon({ kind, className }: { kind: DataSourceKind; className: string }) {
  const Icon = SOURCE_ICON[kind]
  return <Icon aria-hidden className={className} />
}

/** A `builtin-app` source is `pending` while the built-in app installs, not while a connection rolls out. */
function SourceStatusPill({ source }: { source: DataSource }) {
  const { t } = useText()
  const label = source.kind === 'builtin-app' && source.status === 'pending' ? 'toolBuilder.dataSources.installedApp.installing' : STATUS[source.status].label
  return (
    <StatusPill tone={STATUS[source.status].tone} title={source.statusMessage ?? undefined}>
      {t(label)}
    </StatusPill>
  )
}

function ModeBadge({ mode }: { mode: QueryMode }) {
  const { t } = useText()
  return mode === 'read' ? <Badge>{t('toolBuilder.queries.mode.read')}</Badge> : <StatusPill tone="busy">{t('toolBuilder.queries.mode.write')}</StatusPill>
}

export function QueriesPage() {
  const { t } = useText()
  const params = useParams({ strict: false })
  const slug = params.slug ?? ''
  const draft = useDraft(slug)
  useDocumentTitle(t('toolBuilder.queries.documentTitle', { tool: draft.tool.name }))
  const navigate = useNavigate()
  const sources = useQuery(dataSourcesQuery)
  // Listing sources is admin-only on the server; editors still get every source the draft uses.
  const sourcesForbidden = isApiError(sources.error) && sources.error.status === 403
  const [creating, setCreating] = useState(false)
  // Sample values survive switching between queries (keyed by query id, then param name).
  const [samples, setSamples] = useState<Record<string, Record<string, string>>>({})

  const doc = draft.document
  const selected = params.queryId === undefined ? doc.queries[0] : doc.queries.find((query) => query.id === params.queryId)
  const unknownName = (id: string) => t('toolBuilder.queries.sourceUnknown', { id })
  const choices: SourceChoice[] = sources.data
    ? sources.data.filter((source) => source.status !== 'error').map((source) => ({ id: source.id, name: source.name, kind: source.kind }))
    : [...new Set(doc.queries.map((query) => query.sourceId))].map((id) => {
        const sample = doc.queries.find((query) => query.sourceId === id)
        return { id, name: unknownName(id), kind: sample?.http ? 'http' : 'postgres' }
      })

  const problemsByQuery = new Map<string, Problem[]>()
  for (const problem of draft.problems) {
    const queryId = problemTarget(doc, problem).queryId
    if (queryId) problemsByQuery.set(queryId, [...(problemsByQuery.get(queryId) ?? []), problem])
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[15rem_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
      <aside aria-label={t('toolBuilder.queries.sidebarLabel')} className="border-b border-stone-200 bg-white p-4 lg:overflow-y-auto lg:border-r lg:border-b-0 dark:border-stone-800 dark:bg-stone-900">
        <section aria-labelledby="tb-sources-heading">
          <h2 id="tb-sources-heading" className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
            {t('toolBuilder.queries.sources')}
          </h2>
          {sources.data ? (
            sources.data.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">{t('toolBuilder.queries.sourcesEmpty')}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {sources.data.map((source) => (
                  <li key={source.id} className="flex items-start gap-2 rounded-md px-2 py-1.5">
                    <SourceIcon kind={source.kind} className="mt-0.5 size-4 shrink-0 text-stone-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-stone-900 dark:text-stone-100" title={source.name}>
                        {source.name}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
                        {source.kind === 'builtin-app' && source.definition ? installedAppName(source.definition, t) : t(KIND_LABEL[source.kind])}
                        <SourceStatusPill source={source} />
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : sourcesForbidden ? (
            <>
              <p className="mt-2 text-xs text-stone-500">{t('toolBuilder.queries.sourcesAdminOnly')}</p>
              <ul className="mt-2 space-y-1">
                {choices.map((choice) => (
                  <li key={choice.id} className="flex items-center gap-2 px-2 py-1 font-mono text-xs text-stone-700 dark:text-stone-300">
                    <SourceIcon kind={choice.kind} className="size-4 shrink-0 text-stone-500" />
                    <span className="truncate">{choice.id}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : sources.isError ? (
            <Notice tone="error" className="mt-2">
              {t('toolBuilder.common.loadFailed')}
            </Notice>
          ) : (
            <p className="mt-2 text-sm text-stone-500">{t('toolBuilder.common.loading')}</p>
          )}
        </section>

        <section aria-labelledby="tb-queries-heading" className="mt-6">
          <div className="flex items-center justify-between gap-2">
            <h2 id="tb-queries-heading" className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
              {t('toolBuilder.editor.nav.queries')}
            </h2>
            <Button size="sm" tone="ghost" icon={<Plus />} onClick={() => setCreating(true)} disabled={choices.length === 0}>
              {t('toolBuilder.queries.new')}
            </Button>
          </div>
          {doc.queries.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">{t('toolBuilder.queries.listEmpty')}</p>
          ) : (
            <ul className="mt-2 space-y-0.5">
              {doc.queries.map((query) => {
                const current = query.id === selected?.id
                const source = sourceView(query.sourceId, sources.data, query.http ? 'http' : 'postgres', query.sourceId)
                const problems = problemsByQuery.get(query.id)
                return (
                  <li key={query.id}>
                    <HrefLink
                      href={paths.editQuery(slug, query.id)}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'block rounded-md px-2 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800',
                        current ? 'bg-accent-soft ring-1 ring-accent-line ring-inset dark:bg-stone-800' : undefined,
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-sm text-stone-900 dark:text-stone-100">{query.name}</span>
                        {problems ? <AlertCircle aria-label={t('toolBuilder.queries.hasProblems')} className="size-3.5 shrink-0 text-bad" /> : null}
                        <ModeBadge mode={query.mode} />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-stone-500">{source.name}</span>
                    </HrefLink>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </aside>

      {selected ? (
        <QueryEditor
          key={selected.id}
          slug={slug}
          draft={draft}
          query={selected}
          source={sourceView(selected.sourceId, sources.data, selected.http ? 'http' : 'postgres', unknownName(selected.sourceId))}
          problems={problemsByQuery.get(selected.id) ?? []}
          samples={samples[selected.id] ?? {}}
          onSample={(name, raw) => setSamples((state) => ({ ...state, [selected.id]: { ...state[selected.id], [name]: raw } }))}
          onDeleted={() => void navigate({ to: '/edit/$slug/queries', params: { slug } })}
        />
      ) : (
        <div className="p-6 xl:col-span-2">
          {doc.queries.length === 0 ? (
            <EmptyState
              icon={<Braces />}
              title={t('toolBuilder.queries.none.title')}
              body={t('toolBuilder.queries.none.body')}
              action={
                <Button tone="primary" icon={<Plus />} onClick={() => setCreating(true)} disabled={choices.length === 0}>
                  {t('toolBuilder.queries.new')}
                </Button>
              }
            />
          ) : (
            <Notice tone="warning">{t('toolBuilder.queries.notFound')}</Notice>
          )}
        </div>
      )}

      <NewQueryDialog
        open={creating}
        onOpenChange={setCreating}
        sources={choices}
        takenNames={new Set(doc.queries.map((query) => query.name))}
        onCreate={(input) => {
          const query = newQuery(doc, input)
          draft.update((current) => ({ ...current, queries: [...current.queries, query] }))
          void navigate({ to: '/edit/$slug/queries/$queryId', params: { slug, queryId: query.id } })
        }}
      />
    </div>
  )
}

function QueryEditor({
  slug,
  draft,
  query,
  source,
  problems,
  samples,
  onSample,
  onDeleted,
}: {
  slug: string
  draft: Draft
  query: Query
  source: SourceView
  problems: Problem[]
  samples: Record<string, string>
  onSample: (name: string, raw: string) => void
  onDeleted: () => void
}) {
  const { t } = useText()
  const id = useId()
  const navigate = useNavigate()
  const { insert: insertName } = useSearch({ strict: false })
  const queryClient = useQueryClient()
  const editor = useRef<SqlEditorHandle>(null)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [columns, setColumns] = useState<string[]>([])
  const [confirmWrite, setConfirmWrite] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [inserting, setInserting] = useState(false)
  const [initialName, setInitialName] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const { update } = draft

  useEffect(() => {
    if (!insertName) return
    setInitialName(insertName)
    setInserting(true)
    void navigate({ to: '/edit/$slug/queries/$queryId', params: { slug, queryId: query.id }, search: {}, replace: true })
  }, [insertName, navigate, slug, query.id])

  const edit = useCallback(
    (fn: (query: Query) => Query, coalesce?: string) => update((doc: Document) => updateQuery(doc, query.id, fn), coalesce ? { coalesce: `query:${query.id}:${coalesce}` } : undefined),
    [update, query.id],
  )

  const execute = async (confirmed: boolean) => {
    setRun({ status: 'running' })
    try {
      // The server runs the stored draft, so local edits must reach it first.
      await draft.save()
      const inputs = Object.fromEntries(
        query.params.map((param) => [param.name, sampleInput(param.type, samples[param.name] ?? ('literal' in param.bind ? sampleFromLiteral(param.bind.literal) : ''))]),
      )
      const result = await api.tools.runDraftQuery(slug, query.id, confirmed ? { inputs, confirmWrite: true } : { inputs })
      setColumns(result.columns.map((column) => column.name))
      setRun({ status: 'done', result })
      // A write run is recorded as an action run.
      if (query.mode === 'write') void invalidateTool(queryClient, slug)
    } catch (error) {
      setRun({ status: 'failed', error })
    }
  }
  // A draft keeps unfinished queries (empty SQL, unbound placeholders), but the server runs only a query
  // without problems (400 `invalid_document`), so Run waits until the problems listed above are fixed.
  const blocked = problems.length > 0
  const startRun = () => {
    if (run.status === 'running' || blocked) return
    if (query.mode === 'write') setConfirmWrite(true)
    else void execute(false)
  }

  const saveNow = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await draft.save()
    } catch (error) {
      setSaveError(error)
    } finally {
      setSaving(false)
    }
  }

  const insert = (text: string) => {
    if (query.sql) {
      editor.current?.insert(text)
      return
    }
    if (query.http) {
      const http = query.http
      edit((current) => ({ ...current, http: { ...http, path: `${http.path}${text}` } }))
    }
  }

  return (
    <>
      <section aria-labelledby={`${id}-title`} className="flex min-h-0 min-w-0 flex-col border-b border-stone-200 lg:overflow-y-auto xl:border-b-0 dark:border-stone-800">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-200 bg-white px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
          <h1 id={`${id}-title`} className="sr-only">
            {query.name}
          </h1>
          <QueryNameInput query={query} taken={draft.document.queries} onRename={(name) => edit((current) => ({ ...current, name }))} />
          <SegmentedControl
            label={t('toolBuilder.queries.new.mode')}
            value={query.mode}
            onChange={(mode) => mode && edit((current) => setMode(current, mode))}
            options={[
              { value: 'read', label: t('toolBuilder.queries.mode.read') },
              { value: 'write', label: t('toolBuilder.queries.mode.write') },
            ]}
          />
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-stone-500">
            <SourceIcon kind={source.kind} className="size-3.5" />
            <span className="truncate">{source.name}</span>
            {source.source ? <SourceStatusPill source={source.source} /> : null}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <IconButton label={t('toolBuilder.queries.delete')} icon={<Trash2 />} onClick={() => setDeleting(true)} />
            <Button size="sm" icon={<Save />} onClick={() => void saveNow()} loading={saving || draft.saving} disabled={!draft.dirty && !saving}>
              {draft.dirty ? t('toolBuilder.common.save') : t('toolBuilder.queries.saved')}
            </Button>
            <Button size="sm" tone={query.mode === 'write' ? 'danger' : 'primary'} icon={<Play />} onClick={startRun} loading={run.status === 'running'} disabled={blocked}>
              {query.mode === 'write' ? t('toolBuilder.queries.runWrite') : t('toolBuilder.queries.run')}
            </Button>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {saveError ? <Notice tone="error">{t('toolBuilder.queries.saveFailed')}</Notice> : null}
          {problems.length > 0 ? (
            <Notice tone="warning" title={t('toolBuilder.queries.problems')}>
              <ul className="list-disc space-y-0.5 pl-4">
                {problems.map((problem, index) => (
                  <li key={`${problem.path}:${problem.code}:${index}`}>
                    {problemText(problem, t)}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" tone="ghost" icon={<Braces />} onClick={() => { setInitialName(''); setInserting(true) }}>
              {t('toolBuilder.queries.insertPlaceholder')}
            </Button>
            {source.kind === 'postgres' ? (
              <Button size="sm" tone="ghost" icon={<Table2 />} onClick={() => setBrowsing(true)}>
                {t('toolBuilder.queries.schema')}
              </Button>
            ) : null}
          </div>

          {query.sql ? (
            <SqlEditor
              ref={editor}
              label={t('toolBuilder.queries.editorLabel', { name: query.name })}
              value={query.sql.text}
              onChange={(text) => edit((current) => (current.sql?.text === text ? current : { ...current, sql: { text } }), 'sql')}
              onRun={startRun}
              className="min-h-56"
            />
          ) : query.http ? (
            <>
              {source.kind === 'builtin-app' ? (
                <OperationPicker sourceId={query.sourceId} installedApp={source.source?.definition ? installedAppName(source.source.definition, t) : source.name} query={query} onChange={edit} />
              ) : null}
              <HttpForm query={query} installedApp={source.kind === 'builtin-app'} onChange={edit} />
            </>
          ) : null}

          {query.sql && query.mode === 'read' ? <FiltersSection query={query} columns={columns} update={update} /> : null}

          <section aria-labelledby={`${id}-results`} className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
            <h2 id={`${id}-results`} className="border-b border-stone-200 px-4 py-2 text-sm font-semibold text-stone-900 dark:border-stone-800 dark:text-stone-100">
              {t('toolBuilder.queries.results')}
            </h2>
            <div className="max-h-[28rem] overflow-auto">
              <ResultsPanel state={run} mode={query.mode} rowLimit={query.rowLimit} />
            </div>
          </section>
        </div>
      </section>

      <aside aria-label={t('toolBuilder.queries.params')} className="min-w-0 bg-stone-50 p-4 lg:col-start-2 lg:overflow-y-auto xl:col-start-auto xl:border-l xl:border-stone-200 dark:bg-stone-950 xl:dark:border-stone-800">
        <ParamsPanel query={query} document={draft.document} samples={samples} onSample={onSample} onChange={(fn) => edit(fn, 'params')} />
      </aside>

      <ConfirmDialog
        open={confirmWrite}
        onOpenChange={setConfirmWrite}
        tone="danger"
        title={t('toolBuilder.queries.runWrite.title', { name: query.name })}
        body={t('toolBuilder.queries.runWrite.body', { source: source.name })}
        confirmLabel={t('toolBuilder.queries.runWrite.confirm')}
        onConfirm={() => {
          setConfirmWrite(false)
          void execute(true)
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        tone="danger"
        title={t('toolBuilder.dataSources.deleteTitle', { name: query.name })}
        body={t('toolBuilder.queries.delete.body')}
        confirmLabel={t('toolBuilder.editor.canvas.delete')}
        onConfirm={() => {
          setDeleting(false)
          update((doc) => removeQuery(doc, query.id))
          onDeleted()
        }}
      />
      <InsertPlaceholderDialog open={inserting} onOpenChange={setInserting} params={query.params} initialName={initialName} onInsert={(name) => insert(`{{ ${name} }}`)} />
      {source.kind === 'postgres' ? (
        <SchemaSheet open={browsing} onOpenChange={setBrowsing} sourceId={query.sourceId} sourceName={source.name} onInsert={insert} />
      ) : null}
    </>
  )
}

/** The query's name, committed on blur/Enter when it is a valid, unused identifier. */
function QueryNameInput({ query, taken, onRename }: { query: Query; taken: Query[]; onRename: (name: string) => void }) {
  const { t } = useText()
  const id = useId()
  const [name, setName] = useState(query.name)
  const error = !PLACEHOLDER_NAME.test(name)
    ? t('toolBuilder.queries.new.nameInvalid')
    : taken.some((other) => other.id !== query.id && other.name === name)
      ? t('toolBuilder.queries.new.nameTaken')
      : undefined
  const commit = () => {
    if (name === query.name) return
    if (error) setName(query.name)
    else onRename(name)
  }
  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="sr-only">
        {t('toolBuilder.queries.name')}
      </label>
      <TextInput
        id={id}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) commit()
          if (event.key === 'Escape') setName(query.name)
        }}
        invalid={error !== undefined}
        aria-errormessage={error ? `${id}-error` : undefined}
        spellCheck={false}
        className="w-56 font-mono font-semibold"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="absolute top-full left-0 z-10 mt-1 w-72 rounded-md bg-bad-soft px-2 py-1 text-xs text-bad-ink shadow">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** `builtin-app`: the request was filled from an operation; the fields stay editable. */
function HttpForm({ query, installedApp, onChange }: { query: Query; installedApp: boolean; onChange: (fn: (query: Query) => Query, coalesce?: string) => void }) {
  const { t } = useText()
  const id = useId()
  const http = query.http
  if (!http) return null
  const set = (patch: Partial<NonNullable<Query['http']>>, coalesce: string) => onChange((current) => (current.http ? { ...current, http: { ...current.http, ...patch } } : current), coalesce)
  return (
    <div className="grid gap-4 rounded-lg border border-stone-200 bg-white p-4 sm:grid-cols-[8rem_minmax(0,1fr)] dark:border-stone-800 dark:bg-stone-900">
      <Field id={`${id}-method`} label={t('toolBuilder.queries.http.method')} hint={query.mode === 'read' ? t('toolBuilder.queries.http.methodReadOnly') : undefined}>
        <Select
          id={`${id}-method`}
          value={http.method}
          disabled={query.mode === 'read'}
          onChange={(method) => set({ method: method as HttpMethod, ...(method === 'GET' ? { body: undefined } : {}) }, 'method')}
          options={HTTP_METHODS.map((method) => ({ value: method, label: method }))}
        />
      </Field>
      <Field id={`${id}-path`} label={t('toolBuilder.queries.http.path')} hint={installedApp ? t('toolBuilder.queries.http.pathHintInstalledApp') : t('toolBuilder.queries.http.pathHint')}>
        <TextInput id={`${id}-path`} value={http.path} onChange={(event) => set({ path: event.target.value }, 'path')} spellCheck={false} className="font-mono" />
      </Field>
      {http.method !== 'GET' ? (
        <Field id={`${id}-body`} label={t('toolBuilder.queries.http.body')} hint={t('toolBuilder.queries.http.bodyHint')} className="sm:col-span-2">
          <TextArea id={`${id}-body`} value={http.body ?? ''} onChange={(event) => set({ body: event.target.value }, 'body')} rows={6} spellCheck={false} className="font-mono text-xs" />
        </Field>
      ) : null}
      {query.mode === 'read' ? (
        <Field id={`${id}-result`} label={t('toolBuilder.queries.http.resultPath')} hint={t('toolBuilder.queries.http.resultPathHint')} className="sm:col-span-2">
          <TextInput
            id={`${id}-result`}
            value={http.resultPath ?? ''}
            onChange={(event) => set({ resultPath: event.target.value === '' ? undefined : event.target.value }, 'resultPath')}
            placeholder="data.items"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
      ) : null}
    </div>
  )
}
