// Events tab: the actions a component runs — row actions (table), submit
// (form), click (button). An action runs one write query, optionally after a
// confirmation, with params bound from a form, then re-runs read queries.
// Who may run it is narrowed in Sharing (action grants), not here.
import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import type { Action, Component, Document } from '../../../model/document'
import type { Problem } from '../../../model/document.schema'
import { useText } from '../../../i18n'
import { paths } from '../../../routes/paths'
import { Button, HrefLink, IconButton, Select, StatusPill, TextArea } from '../../../ui'
import { componentsOf, nextActionId, setActions } from '../canvas/document-ops'
import { Checkbox, CompactInput, PanelField, PanelSection, ProblemList, UNSET } from './controls'
import type { Update } from './prop-editors'

export type ActionsSlot = 'row' | 'submit' | 'click'

const SLOT_TITLE = {
  row: 'toolBuilder.editor.events.row',
  submit: 'toolBuilder.editor.events.submit',
  click: 'toolBuilder.editor.events.click',
} as const

const SLOT_ADD = {
  row: 'toolBuilder.editor.events.addRow',
  submit: 'toolBuilder.editor.events.setSubmit',
  click: 'toolBuilder.editor.events.setClick',
} as const

export function ActionsEditor({
  slug,
  doc,
  component,
  slot,
  problemsByAction,
  update,
}: {
  slug: string
  doc: Document
  component: Component
  slot: ActionsSlot
  problemsByAction: ReadonlyMap<string, Problem[]>
  update: Update
}) {
  const { t } = useText()
  const actions = component.actions ?? []
  const writes = doc.queries.filter((query) => query.mode === 'write')
  // Submit and click run one action; a table may offer several per row.
  const canAdd = slot === 'row' || actions.length === 0
  const write = (next: Action[], cell?: string) =>
    update((d) => setActions(d, component.id, next), cell ? { coalesce: `${component.id}.actions.${cell}` } : undefined)

  const add = () => {
    const first = writes[0]
    if (!first) return
    const action: Action = {
      id: nextActionId(doc),
      label: t('toolBuilder.renderer.button.untitled'),
      queryId: first.id,
      ...(component.type === 'form' ? { input: { formComponent: component.id } } : {}),
    }
    write([...actions, action])
  }

  return (
    <PanelSection
      title={t(SLOT_TITLE[slot])}
      aside={
        canAdd ? (
          <Button size="sm" tone="ghost" icon={<Plus />} disabled={writes.length === 0} onClick={add}>
            {t(SLOT_ADD[slot])}
          </Button>
        ) : null
      }
    >
      {writes.length === 0 ? (
        <p className="text-[11px] text-stone-500">
          {t('toolBuilder.editor.events.noWriteQueries')}{' '}
          <HrefLink href={paths.editQueries(slug)} className="text-accent-strong hover:underline">
            {t('toolBuilder.editor.query.create')}
          </HrefLink>
        </p>
      ) : actions.length === 0 ? (
        <p className="text-[11px] text-stone-500">{t('toolBuilder.editor.events.none')}</p>
      ) : null}
      {actions.map((action, index) => (
        <ActionCard
          key={action.id}
          slug={slug}
          doc={doc}
          action={action}
          problems={problemsByAction.get(action.id) ?? []}
          onChange={(next, cell) => write(actions.map((a, i) => (i === index ? next : a)), cell ? `${action.id}.${cell}` : undefined)}
          onRemove={() => write(actions.filter((_, i) => i !== index))}
        />
      ))}
    </PanelSection>
  )
}

function ActionCard({
  slug,
  doc,
  action,
  problems,
  onChange,
  onRemove,
}: {
  slug: string
  doc: Document
  action: Action
  problems: readonly Problem[]
  onChange: (next: Action, cell?: string) => void
  onRemove: () => void
}) {
  const { t } = useText()
  const base = `action-${action.id}`
  const query = doc.queries.find((q) => q.id === action.queryId)
  const writeOptions = doc.queries.filter((q) => q.mode === 'write').map((q) => ({ value: q.id, label: q.name }))
  if (!query || query.mode !== 'write') {
    writeOptions.push({ value: action.queryId, label: query ? t('toolBuilder.editor.query.notWrite', { name: query.name }) : t('toolBuilder.editor.ref.missing', { id: action.queryId }) })
  }
  const forms = componentsOf(doc).filter((component) => component.type === 'form')
  const formOptions = [{ value: UNSET, label: t('toolBuilder.editor.events.noForm') }, ...forms.map((form) => ({ value: form.id, label: form.id }))]
  if (action.input && !forms.some((form) => form.id === action.input?.formComponent)) {
    formOptions.push({ value: action.input.formComponent, label: t('toolBuilder.editor.ref.missing', { id: action.input.formComponent }) })
  }
  const reads = doc.queries.filter((q) => q.mode === 'read')
  const refresh = action.onSuccess?.refresh ?? []

  const without = <K extends 'confirm' | 'input' | 'onSuccess'>(key: K): Action => {
    const copy = { ...action }
    delete copy[key]
    return copy
  }

  return (
    <article aria-label={action.label || action.id} className="flex flex-col gap-3 rounded-md border border-stone-200 bg-stone-50/60 p-2.5 dark:border-stone-700 dark:bg-stone-900/40">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-stone-500">{action.id}</span>
        <IconButton label={t('toolBuilder.editor.events.remove', { name: action.label || action.id })} icon={<Trash2 />} onClick={onRemove} className="ml-auto size-7 md:size-7 md:w-7" />
      </div>
      <ProblemList problems={problems} />
      <PanelField id={`${base}-label`} label={t('toolBuilder.renderer.field.label')}>
        <CompactInput id={`${base}-label`} value={action.label} invalid={action.label.trim() === ''} onChange={(event) => onChange({ ...action, label: event.target.value }, 'label')} />
      </PanelField>
      <PanelField
        id={`${base}-query`}
        label={t('toolBuilder.editor.events.runs')}
        aside={query?.mode === 'write' ? <StatusPill tone="busy">{t('toolBuilder.editor.query.write')}</StatusPill> : null}
        hint={
          query ? (
            <HrefLink href={paths.editQuery(slug, query.id)} className="text-accent-strong hover:underline">
              {t('toolBuilder.editor.query.edit')}
            </HrefLink>
          ) : undefined
        }
      >
        <Select id={`${base}-query`} value={action.queryId} options={writeOptions} invalid={!query || query.mode !== 'write'} onChange={(queryId) => onChange({ ...action, queryId })} />
      </PanelField>
      <div className="flex flex-col gap-2">
        <Checkbox
          id={`${base}-confirm`}
          checked={action.confirm !== undefined}
          onChange={(checked) =>
            onChange(checked ? { ...action, confirm: { title: t('toolBuilder.editor.events.confirmDefault', { label: action.label }), body: '' } } : without('confirm'))
          }
          label={t('toolBuilder.editor.events.confirm')}
        />
        {action.confirm ? (
          <div className="flex flex-col gap-2 border-l-2 border-stone-200 pl-2.5 dark:border-stone-700">
            <PanelField id={`${base}-confirm-title`} label={t('toolBuilder.editor.events.confirmTitle')}>
              <CompactInput
                id={`${base}-confirm-title`}
                value={action.confirm.title}
                onChange={(event) => onChange({ ...action, confirm: { title: event.target.value, body: action.confirm?.body ?? '' } }, 'confirm.title')}
              />
            </PanelField>
            <PanelField id={`${base}-confirm-body`} label={t('toolBuilder.editor.events.confirmBody')}>
              <TextArea
                id={`${base}-confirm-body`}
                value={action.confirm.body}
                onChange={(event) => onChange({ ...action, confirm: { title: action.confirm?.title ?? '', body: event.target.value } }, 'confirm.body')}
                className="min-h-16 px-2 text-xs"
              />
            </PanelField>
          </div>
        ) : null}
      </div>
      <PanelField id={`${base}-form`} label={t('toolBuilder.editor.events.input')} hint={t('toolBuilder.editor.events.inputHint')}>
        <Select
          id={`${base}-form`}
          value={action.input?.formComponent ?? UNSET}
          options={formOptions}
          onChange={(form) => onChange(form === UNSET ? without('input') : { ...action, input: { formComponent: form } })}
        />
      </PanelField>
      <fieldset className="flex flex-col">
        <legend className="mb-1 text-xs font-medium text-stone-700 dark:text-stone-300">{t('toolBuilder.editor.events.refresh')}</legend>
        {reads.length === 0 ? <p className="text-[11px] text-stone-500">{t('toolBuilder.editor.events.noReads')}</p> : null}
        {reads.map((read) => (
          <Checkbox
            key={read.id}
            id={`${base}-refresh-${read.id}`}
            checked={refresh.includes(read.id)}
            onChange={(checked) => {
              const next = checked ? [...refresh, read.id] : refresh.filter((id) => id !== read.id)
              onChange(next.length ? { ...action, onSuccess: { refresh: next } } : without('onSuccess'))
            }}
            label={<span className="font-mono">{read.name}</span>}
          />
        ))}
      </fieldset>
      <HrefLink href={paths.editSharing(slug)} className="flex items-center gap-1.5 text-[11px] text-accent-strong hover:underline">
        <ShieldCheck aria-hidden className="size-3.5" />
        {t('toolBuilder.editor.events.groups')}
      </HrefLink>
    </article>
  )
}
