// `/edit/<slug>/sharing`: which Directory groups may use or edit the tool,
// which groups may run each action, and a "Preview as" projection of those
// rules for one group. Grants are part of the tool, not the document, so a
// change is saved at once with `PUT /grants` (the whole set): the cache is
// updated optimistically, saves run one at a time in order, only the newest
// save's answer may write the cache (an older answer would overwrite edits
// made since), and a failed newest save reloads the server's set and says so.
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { Ban, Check, CheckCircle2, Eye, Lock, Plus, Search, ShieldCheck, Trash2, Users } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { api } from '../../../api/client'
import { grantsQuery, groupsQuery } from '../../../api/queries'
import type { GrantRole, Grants, GroupRef } from '../../../api/types'
import { useText } from '../../../i18n'
import { Button, cn, Dialog, errorMessageId, IconButton, Notice, SegmentedControl, Select, TextInput, useDocumentTitle } from '../../../ui'
import { useDraft } from '../draft-store'
import { documentActions, grantsReducer, viewAs, type DocumentAction, type GrantsAction } from './grants'

export function SharingPage() {
  const { t } = useText()
  const params = useParams({ strict: false })
  const slug = params.slug ?? ''
  const draft = useDraft(slug)
  useDocumentTitle(t('toolBuilder.sharing.documentTitle', { tool: draft.tool.name }))
  const queryClient = useQueryClient()
  const grantsKey = grantsQuery(slug).queryKey
  const grants = useSuspenseQuery(grantsQuery(slug)).data
  const groups = useSuspenseQuery(groupsQuery).data
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const actions = documentActions(draft.document)
  const [picking, setPicking] = useState(false)
  const [previewGroup, setPreviewGroup] = useState<string | undefined>(undefined)

  // Sequence number of the newest edit; a save may write the cache only while it is the newest.
  const latest = useRef(0)
  const save = useMutation({
    // One PUT at a time, in the order the edits were made; each carries the whole set.
    scope: { id: `tool-builder:grants:${slug}` },
    mutationFn: ({ grants: next }: { grants: Grants; seq: number }) => api.grants.put(slug, next),
    // An older answer is superseded: the queued newer PUT carries every later edit.
    onSuccess: (saved, { seq }) => {
      if (seq === latest.current) queryClient.setQueryData(grantsKey, saved)
    },
    // The optimistic set may be ahead of the server now; take the server's.
    onError: (_error, { seq }) => {
      if (seq === latest.current) void queryClient.invalidateQueries({ queryKey: grantsKey })
    },
  })

  const dispatch = (action: GrantsAction) => {
    const current = queryClient.getQueryData(grantsKey) ?? grants
    const next = grantsReducer(current, action)
    if (next === current) return
    void queryClient.cancelQueries({ queryKey: grantsKey })
    queryClient.setQueryData(grantsKey, next)
    latest.current += 1
    save.mutate({ grants: next, seq: latest.current })
  }

  const groupLabel = (id: string) => groupById.get(id)?.name ?? id
  const grantedIds = grants.groups.map((grant) => grant.groupId)
  const knownActions = new Set(actions.map((action) => action.id))
  const staleLimits = grants.actions.filter((entry) => !knownActions.has(entry.actionId))
  const failure = save.isError ? errorMessageId(save.error) : undefined

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 md:px-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          <header>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">{t('toolBuilder.editor.nav.sharing')}</h1>
              <SaveState pending={save.isPending} success={save.isSuccess} />
            </div>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{t('toolBuilder.sharing.lead')}</p>
          </header>

          {save.isError ? (
            <Notice tone="error" title={t('toolBuilder.sharing.failed')}>
              {failure ? t(failure) : null}
            </Notice>
          ) : null}

          <section aria-labelledby="tb-sharing-groups">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <h2 id="tb-sharing-groups" className="text-base font-semibold text-stone-900 dark:text-stone-100">
                {t('toolBuilder.sharing.groups')}
              </h2>
              <Button size="sm" icon={<Plus />} onClick={() => setPicking(true)}>
                {t('toolBuilder.sharing.addGroup')}
              </Button>
            </div>
            {grants.groups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500 dark:border-stone-700">{t('toolBuilder.sharing.groups.empty')}</p>
            ) : (
              <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
                {grants.groups.map((grant) => (
                  <GrantRow
                    key={grant.groupId}
                    group={groupById.get(grant.groupId)}
                    groupId={grant.groupId}
                    role={grant.role}
                    onRole={(role) => dispatch({ type: 'setRole', groupId: grant.groupId, role })}
                    onRemove={() => dispatch({ type: 'removeGroup', groupId: grant.groupId })}
                  />
                ))}
              </ul>
            )}
            <p className="mt-2 flex items-center gap-1.5 text-xs text-stone-500">
              <ShieldCheck aria-hidden className="size-3.5" />
              {t('toolBuilder.sharing.adminNote')}
            </p>
          </section>

          <section aria-labelledby="tb-sharing-actions">
            <h2 id="tb-sharing-actions" className="text-base font-semibold text-stone-900 dark:text-stone-100">
              {t('toolBuilder.sharing.actions')}
            </h2>
            <p className="mt-0.5 mb-3 text-sm text-stone-500 dark:text-stone-400">{t('toolBuilder.sharing.actions.lead')}</p>
            {actions.length === 0 ? (
              <p className="text-sm text-stone-500">{t('toolBuilder.sharing.actions.empty')}</p>
            ) : (
              <ul className="space-y-3">
                {actions.map((action) => (
                  <ActionLimit
                    key={action.id}
                    action={action}
                    queryName={draft.document.queries.find((query) => query.id === action.queryId)?.name ?? action.queryId}
                    granted={grantedIds}
                    limit={grants.actions.find((entry) => entry.actionId === action.id)?.groupIds ?? null}
                    groupLabel={groupLabel}
                    onChange={(groupIds) => dispatch({ type: 'setActionGroups', actionId: action.id, groupIds })}
                    onAllowEveryone={() => dispatch({ type: 'clearActionLimit', actionId: action.id })}
                  />
                ))}
              </ul>
            )}
            {staleLimits.length > 0 ? (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">{t('toolBuilder.sharing.actions.stale')}</h3>
                <p className="mt-0.5 text-xs text-stone-500">{t('toolBuilder.sharing.actions.staleLead')}</p>
                <ul className="mt-2 divide-y divide-stone-200 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                  {staleLimits.map((entry) => (
                    <li key={entry.actionId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="font-mono text-sm text-stone-800 dark:text-stone-200">{entry.actionId}</span>
                      <span className={cn('min-w-0 flex-1 truncate text-xs', entry.groupIds.length === 0 ? 'text-bad-ink' : 'text-stone-500')}>
                        {entry.groupIds.length === 0 ? t('toolBuilder.sharing.actions.nobody') : entry.groupIds.map(groupLabel).join(', ')}
                      </span>
                      <Button size="sm" tone="ghost" onClick={() => dispatch({ type: 'clearActionLimit', actionId: entry.actionId })}>
                        {t('toolBuilder.sharing.actions.removeLimit')}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>

        <PreviewAs
          toolName={draft.tool.name}
          published={draft.tool.live !== null}
          grants={grants}
          groups={groups}
          actions={actions}
          groupId={previewGroup}
          onGroup={setPreviewGroup}
        />
      </div>

      <GroupPicker
        open={picking}
        onOpenChange={setPicking}
        groups={groups.filter((group) => !grantedIds.includes(group.id))}
        allShared={groups.length > 0 && groups.every((group) => grantedIds.includes(group.id))}
        onPick={(group) => {
          dispatch({ type: 'addGroup', groupId: group.id })
          setPicking(false)
        }}
      />
    </div>
  )
}

function SaveState({ pending, success }: { pending: boolean; success: boolean }) {
  const { t } = useText()
  if (pending) {
    return (
      <span role="status" className="text-xs text-stone-500">
        {t('toolBuilder.sharing.saving')}
      </span>
    )
  }
  if (success) {
    return (
      <span role="status" className="flex items-center gap-1 text-xs text-stone-500">
        <CheckCircle2 aria-hidden className="size-3.5 text-ok" />
        {t('toolBuilder.sharing.saved')}
      </span>
    )
  }
  return null
}

function GrantRow({ group, groupId, role, onRole, onRemove }: { group: GroupRef | undefined; groupId: string; role: GrantRole; onRole: (role: GrantRole) => void; onRemove: () => void }) {
  const { t } = useText()
  const name = group?.name ?? groupId
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800">
        <Users className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-stone-900 dark:text-stone-100">{name}</span>
        <span className="block truncate text-xs text-stone-500">
          {group ? `${group.path} · ${t('toolBuilder.sharing.members', { count: group.memberCount })}` : t('toolBuilder.sharing.groupMissing')}
        </span>
      </span>
      <SegmentedControl
        label={t('toolBuilder.sharing.role', { group: name })}
        value={role}
        onChange={(next) => next && onRole(next)}
        options={[
          { value: 'use', label: t('toolBuilder.sharing.role.use'), title: t('toolBuilder.sharing.role.useHint') },
          { value: 'edit', label: t('toolBuilder.sharing.role.edit'), title: t('toolBuilder.sharing.role.editHint') },
        ]}
      />
      <IconButton label={t('toolBuilder.sharing.remove', { group: name })} icon={<Trash2 />} onClick={onRemove} />
    </li>
  )
}

/** `limit`: null = no entry (everyone who can use the tool); [] = nobody; else only those groups. */
function ActionLimit({
  action,
  queryName,
  granted,
  limit,
  groupLabel,
  onChange,
  onAllowEveryone,
}: {
  action: DocumentAction
  queryName: string
  granted: string[]
  limit: string[] | null
  groupLabel: (id: string) => string
  onChange: (groupIds: string[]) => void
  onAllowEveryone: () => void
}) {
  const { t } = useText()
  const id = useId()
  const selected = limit ?? []
  const nobody = limit !== null && limit.length === 0
  return (
    <li className={cn('rounded-xl border bg-white p-4 dark:bg-stone-900', nobody ? 'border-bad/60' : 'border-stone-200 dark:border-stone-800')}>
      <div className="flex flex-wrap items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-stone-900 dark:text-stone-100">{action.label}</span>
          <span className="block font-mono text-xs text-stone-500">{t('toolBuilder.sharing.actions.on', { component: action.componentId, query: queryName })}</span>
        </span>
        <span className={cn('flex items-center gap-1 text-xs', nobody ? 'font-medium text-bad-ink' : limit !== null ? 'text-busy-ink' : 'text-stone-500')}>
          {nobody ? <Ban aria-hidden className="size-3.5" /> : limit !== null ? <Lock aria-hidden className="size-3.5" /> : null}
          {nobody ? t('toolBuilder.sharing.actions.nobody') : limit !== null ? t('toolBuilder.sharing.actions.onlyGroups') : t('toolBuilder.sharing.actions.everyone')}
        </span>
      </div>
      {nobody ? <p className="mt-2 text-xs text-bad-ink">{t('toolBuilder.sharing.actions.nobodyHint')}</p> : null}
      {granted.length === 0 ? (
        <p className="mt-3 text-xs text-stone-500">{t('toolBuilder.sharing.actions.noGroups')}</p>
      ) : (
        <div role="group" aria-labelledby={`${id}-label`} className="mt-3">
          <span id={`${id}-label`} className="sr-only">
            {t('toolBuilder.sharing.actions.groupsFor', { action: action.label })}
          </span>
          <ul className="flex flex-wrap gap-2">
            {granted.map((groupId) => {
              const on = selected.includes(groupId)
              return (
                <li key={groupId}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange(on ? selected.filter((item) => item !== groupId) : [...selected, groupId])}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors md:min-h-8',
                      on
                        ? 'border-accent bg-accent-soft text-accent-strong dark:bg-stone-800 dark:text-teal-200'
                        : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300',
                    )}
                  >
                    {on ? <Check aria-hidden className="size-3.5" /> : null}
                    {groupLabel(groupId)}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {limit !== null ? (
        <div className="mt-3">
          <Button size="sm" tone="ghost" onClick={onAllowEveryone}>
            {t('toolBuilder.sharing.actions.allowEveryone')}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

function PreviewAs({
  toolName,
  published,
  grants,
  groups,
  actions,
  groupId,
  onGroup,
}: {
  toolName: string
  published: boolean
  grants: Grants
  groups: GroupRef[]
  actions: DocumentAction[]
  groupId: string | undefined
  onGroup: (groupId: string) => void
}) {
  const { t } = useText()
  const id = useId()
  const view = groupId === undefined ? null : viewAs(grants, groupId, actions)
  return (
    <aside aria-labelledby={`${id}-title`} className="h-fit rounded-xl border border-stone-200 bg-stone-50 p-4 xl:sticky xl:top-6 dark:border-stone-800 dark:bg-stone-950">
      <h2 id={`${id}-title`} className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
        <Eye aria-hidden className="size-4 text-stone-500" />
        {t('toolBuilder.sharing.preview')}
      </h2>
      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t('toolBuilder.sharing.preview.lead')}</p>
      <div className="mt-3">
        <Select
          aria-label={t('toolBuilder.sharing.preview')}
          value={groupId}
          onChange={onGroup}
          placeholder={t('toolBuilder.sharing.preview.pick')}
          options={groups.map((group) => ({ value: group.id, label: `${group.name} · ${group.path}` }))}
        />
      </div>
      {view ? (
        <div className="mt-4 space-y-3" aria-live="polite">
          <p className={cn('flex items-start gap-2 text-sm font-medium', view.canOpen ? 'text-stone-900 dark:text-stone-100' : 'text-bad-ink')}>
            {view.canOpen ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" /> : <Ban aria-hidden className="mt-0.5 size-4 shrink-0" />}
            {!view.canOpen
              ? t('toolBuilder.sharing.preview.noAccess', { tool: toolName })
              : view.canEdit
                ? t('toolBuilder.sharing.preview.edit', { tool: toolName })
                : t('toolBuilder.sharing.preview.use', { tool: toolName })}
          </p>
          {view.canOpen && !view.canEdit && !published ? <p className="text-xs text-busy-ink">{t('toolBuilder.sharing.preview.notPublished')}</p> : null}
          {view.actions.length > 0 ? (
            <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
              {view.actions.map((action) => (
                <li key={action.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className={cn('min-w-0 flex-1 truncate', action.allowed ? 'text-stone-900 dark:text-stone-100' : 'text-stone-400 line-through')}>{action.label}</span>
                  {action.allowed ? (
                    <span className="flex items-center gap-1 text-xs text-accent-strong dark:text-teal-300">
                      <Check aria-hidden className="size-3.5" />
                      {t('toolBuilder.sharing.preview.allowed')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-stone-500">
                      <Lock aria-hidden className="size-3.5" />
                      {t('toolBuilder.sharing.preview.hidden')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}

/** Searchable group list (combobox + listbox): arrows move, Enter adds, Escape closes. */
function GroupPicker({
  open,
  onOpenChange,
  groups,
  allShared,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: GroupRef[]
  allShared: boolean
  onPick: (group: GroupRef) => void
}) {
  const { t } = useText()
  const id = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const needle = query.trim().toLowerCase()
  const matches = needle === '' ? groups : groups.filter((group) => `${group.path} ${group.name}`.toLowerCase().includes(needle))
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0))
  const change = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setQuery('')
      setActive(0)
    }
  }
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((activeIndex + 1) % Math.max(matches.length, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((activeIndex - 1 + matches.length) % Math.max(matches.length, 1))
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      const group = matches[activeIndex]
      if (group) {
        onPick(group)
        setQuery('')
        setActive(0)
      }
    }
  }
  return (
    <Dialog open={open} onOpenChange={change} title={t('toolBuilder.sharing.picker.title')} description={t('toolBuilder.sharing.picker.lead')}>
      {allShared ? (
        <p className="text-sm text-stone-500">{t('toolBuilder.sharing.picker.allShared')}</p>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
            <TextInput
              role="combobox"
              aria-label={t('toolBuilder.sharing.picker.search')}
              aria-expanded
              aria-controls={`${id}-list`}
              aria-autocomplete="list"
              aria-activedescendant={matches[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
              placeholder={t('toolBuilder.sharing.picker.search')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={keyDown}
              autoComplete="off"
              className="pl-9"
            />
          </div>
          <p className="sr-only" aria-live="polite">
            {t('toolBuilder.sharing.picker.results', { count: matches.length })}
          </p>
          {matches.length === 0 ? (
            <p className="py-4 text-center text-sm text-stone-500">{t('toolBuilder.sharing.picker.empty')}</p>
          ) : (
            <ul id={`${id}-list`} role="listbox" aria-label={t('toolBuilder.sharing.picker.title')} className="max-h-80 overflow-y-auto rounded-lg border border-stone-200 p-1 dark:border-stone-800">
              {matches.map((group, index) => (
                <li
                  key={group.id}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onPick(group)}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-2',
                    index === activeIndex ? 'bg-accent-soft text-accent-strong dark:bg-stone-800 dark:text-teal-200' : 'text-stone-800 dark:text-stone-200',
                  )}
                >
                  <Users aria-hidden className="size-4 shrink-0 text-stone-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{group.name}</span>
                    <span className="block truncate font-mono text-xs text-stone-500">{group.path}</span>
                  </span>
                  <span className="shrink-0 text-xs text-stone-500">{t('toolBuilder.sharing.members', { count: group.memberCount })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  )
}
