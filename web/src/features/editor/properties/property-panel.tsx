// Right-hand panel of the canvas: the selected component's Properties (from
// the registry's `fields`), Data (what it reads and what reads it), Style
// (cell, size, parent) and Events (actions). With nothing selected it edits
// the page and lists the page's data-flow hints. Validation problems show
// under the prop / action they are about; the rest at the top of the panel.
import { Tabs } from 'radix-ui'
import { ArrowRight, MousePointerClick } from 'lucide-react'
import { useState } from 'react'
import type { Component, Document } from '../../../model/document'
import { problemTarget, type Problem } from '../../../model/document.schema'
import { edgesAround, flowHints } from '../../../model/flow'
import { definitionFor, UNKNOWN_COMPONENT_ICON } from '../../../renderer/registry'
import { useText } from '../../../i18n'
import { cn } from '../../../ui'
import { componentIdProblem, componentsOf, renameComponent, setPageTitle } from '../canvas/document-ops'
import type { Draft } from '../draft-store'
import { ActionsEditor } from './actions-editor'
import { CompactInput, PanelField, PanelSection, ProblemList } from './controls'
import { DataTab } from './data-tab'
import { PropEditor } from './prop-editors'
import { StyleTab } from './style-tab'

type PanelTab = 'properties' | 'data' | 'style' | 'events'

export function PropertyPanel({ slug, draft, selected, onSelect }: { slug: string; draft: Draft; selected: Component | undefined; onSelect: (id: string | null) => void }) {
  const { t } = useText()
  return (
    <aside aria-label={t('toolBuilder.editor.panel.label')} className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
      {selected ? (
        <ComponentPanel key={selected.id} slug={slug} draft={draft} component={selected} onSelect={onSelect} />
      ) : (
        <PagePanel draft={draft} onSelect={onSelect} />
      )}
    </aside>
  )
}

function PagePanel({ draft, onSelect }: { draft: Draft; onSelect: (id: string | null) => void }) {
  const { t } = useText()
  const page = draft.document.pages[0]
  const unplaced = draft.problems.filter((problem) => !problemTarget(draft.document, problem).componentId)
  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-4">
      <PanelSection title={t('toolBuilder.editor.panel.page')}>
        <PanelField id="page-title" label={t('toolBuilder.editor.panel.pageTitle')} hint={t('toolBuilder.editor.panel.pageTitleHint')}>
          <CompactInput id="page-title" value={page?.title ?? ''} onChange={(event) => draft.update((doc) => setPageTitle(doc, event.target.value), { coalesce: 'page.title' })} />
        </PanelField>
        <p className="text-[11px] text-stone-500">{t('toolBuilder.editor.panel.componentCount', { count: componentsOf(draft.document).length })}</p>
      </PanelSection>
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-stone-200 px-4 py-6 text-center text-xs text-stone-500 dark:border-stone-700">
        <MousePointerClick aria-hidden className="size-5 text-stone-400" />
        {t('toolBuilder.editor.panel.selectHint')}
      </div>
      {unplaced.length > 0 ? (
        <PanelSection title={t('toolBuilder.editor.problems.title')}>
          <ProblemList problems={unplaced} />
        </PanelSection>
      ) : null}
      <PageHints doc={draft.document} onSelect={onSelect} />
    </div>
  )
}

/** Every data-flow hint of the page (SPA-only guidance, never a Problem), each jumping to its component. */
function PageHints({ doc, onSelect }: { doc: Document; onSelect: (id: string) => void }) {
  const { t } = useText()
  const hints = flowHints(doc)
  return (
    <PanelSection title={t('toolBuilder.dataTab.page.title')}>
      {hints.length === 0 ? (
        <p className="text-[11px] text-stone-500">{t('toolBuilder.dataTab.page.none')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {hints.map((hint) => (
            <li key={`${hint.componentId}:${hint.kind}`}>
              <button
                type="button"
                onClick={() => onSelect(hint.componentId)}
                title={t('toolBuilder.dataTab.select', { id: hint.componentId })}
                className="group flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none dark:hover:bg-stone-800"
              >
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="shrink-0 font-mono font-medium text-stone-800 dark:text-stone-200">{hint.componentId}</span>
                <span className="min-w-0 flex-1 truncate text-stone-500">
                  {t(hint.kind === 'noData' ? 'toolBuilder.renderer.state.noQuery' : 'toolBuilder.dataTab.page.unconnectedInput')}
                </span>
                <ArrowRight aria-hidden className="size-3 shrink-0 text-stone-400 group-hover:text-stone-700" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelSection>
  )
}

/** Problems of one component, split by the prop or action they name; the rest are general. */
function splitProblems(doc: Document, problems: readonly Problem[], componentId: string) {
  const byProp = new Map<string, Problem[]>()
  const byAction = new Map<string, Problem[]>()
  const general: Problem[] = []
  for (const problem of problems) {
    const target = problemTarget(doc, problem)
    if (target.componentId !== componentId) continue
    if (target.actionId) byAction.set(target.actionId, [...(byAction.get(target.actionId) ?? []), problem])
    else if (target.prop) {
      const head = target.prop.split('.')[0] ?? target.prop
      byProp.set(head, [...(byProp.get(head) ?? []), problem])
    } else general.push(problem)
  }
  return { byProp, byAction, general }
}

function ComponentPanel({ slug, draft, component, onSelect }: { slug: string; draft: Draft; component: Component; onSelect: (id: string | null) => void }) {
  const { t } = useText()
  const [tab, setTab] = useState<PanelTab>('properties')
  const doc = draft.document
  // A type this build does not know (a draft may hold one) has no fields or events; Style still moves and deletes it.
  const definition = definitionFor(component.type)
  const typeLabel = definition ? t(definition.label) : t('toolBuilder.editor.unknownComponentType', { type: component.type })
  const Icon = definition?.icon ?? UNKNOWN_COMPONENT_ICON
  const fields = definition?.fields ?? []
  const { byProp, byAction, general } = splitProblems(doc, draft.problems, component.id)
  // Props the registry does not list as fields (e.g. `tab`, edited in Style) still show their problems here.
  const fieldNames = new Set(fields.map((field) => field.name))
  const stray = [...byProp.entries()].filter(([name]) => !fieldNames.has(name)).flatMap(([, problems]) => problems)
  const actionProblems = [...byAction.values()].flat().length
  const { upstream, downstream } = edgesAround(doc, component.id)
  const connections = upstream.length + downstream.length
  const hinted = flowHints(doc).some((hint) => hint.componentId === component.id)
  const tabClass =
    'relative py-2.5 text-xs text-stone-500 hover:text-stone-800 data-[state=active]:font-medium data-[state=active]:text-stone-900 data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-stone-900 dark:data-[state=active]:text-stone-100 dark:data-[state=active]:after:bg-stone-100'

  return (
    <>
      <div className="flex items-center gap-2 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-strong">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-stone-900 dark:text-stone-100">{typeLabel}</p>
          <ComponentIdEditor key={component.id} doc={doc} id={component.id} onRename={(next) => {
            draft.update((d) => renameComponent(d, component.id, next))
            onSelect(next)
          }} />
        </div>
      </div>
      <Tabs.Root value={tab} onValueChange={(value) => setTab(value as PanelTab)} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List aria-label={t('toolBuilder.editor.panel.tabs')} className="flex gap-4 border-b border-stone-200 px-4 dark:border-stone-800">
          <Tabs.Trigger value="properties" className={tabClass}>
            {t('toolBuilder.editor.panel.properties')}
            {byProp.size > 0 ? <span className="ml-1 text-bad-ink">●</span> : null}
          </Tabs.Trigger>
          <Tabs.Trigger value="data" className={tabClass} title={t('toolBuilder.dataTab.lead')}>
            {t('toolBuilder.renderer.palette.data')}
            {connections > 0 ? (
              <span className="ml-1 text-stone-400 tabular-nums" aria-label={t('toolBuilder.dataTab.count', { count: connections })}>
                {connections}
              </span>
            ) : null}
            {hinted ? <span role="img" aria-label={t('toolBuilder.dataTab.hintDot')} className="ml-1.5 inline-block size-1.5 rounded-full bg-amber-500 align-middle" /> : null}
          </Tabs.Trigger>
          <Tabs.Trigger value="style" className={tabClass}>
            {t('toolBuilder.renderer.field.variant')}
          </Tabs.Trigger>
          <Tabs.Trigger value="events" className={tabClass}>
            {t('toolBuilder.editor.panel.events')}
            {component.actions?.length ? <span className="ml-1 text-stone-400 tabular-nums">{component.actions.length}</span> : null}
            {actionProblems > 0 ? <span className="ml-1 text-bad-ink">●</span> : null}
          </Tabs.Trigger>
        </Tabs.List>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {general.length + stray.length > 0 ? (
            <div className="mb-4 rounded-md border border-red-200 bg-bad-soft px-3 py-2 dark:border-red-900 dark:bg-red-950/40">
              <ProblemList problems={[...general, ...stray]} />
            </div>
          ) : null}
          <Tabs.Content value="properties" className="flex flex-col gap-4 focus:outline-none">
            {!definition ? (
              <p className="text-xs text-bad-ink dark:text-red-300">{t('toolBuilder.editor.panel.unknownComponent')}</p>
            ) : fields.length === 0 ? (
              <p className="text-xs text-stone-500">{t('toolBuilder.editor.panel.noProps')}</p>
            ) : null}
            {fields.map((field) => (
              <PropEditor
                key={field.name}
                slug={slug}
                doc={doc}
                component={component}
                field={field}
                problems={byProp.get(field.name) ?? []}
                update={draft.update}
              />
            ))}
          </Tabs.Content>
          <Tabs.Content value="data" className="focus:outline-none">
            <DataTab slug={slug} doc={doc} component={component} update={draft.update} onSelect={onSelect} onShowProperties={() => setTab('properties')} />
          </Tabs.Content>
          <Tabs.Content value="style" className="focus:outline-none">
            <StyleTab doc={doc} component={component} update={draft.update} onSelect={onSelect} />
          </Tabs.Content>
          <Tabs.Content value="events" className="focus:outline-none">
            {definition?.actionsSlot ? (
              <ActionsEditor slug={slug} doc={doc} component={component} slot={definition.actionsSlot} problemsByAction={byAction} update={draft.update} />
            ) : (
              <p className="text-xs text-stone-500">{t('toolBuilder.editor.events.unsupported', { type: typeLabel })}</p>
            )}
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </>
  )
}

/** The component id, renamable in place; references to it follow (renameComponent). */
function ComponentIdEditor({ doc, id, onRename }: { doc: Document; id: string; onRename: (next: string) => void }) {
  const { t } = useText()
  const [value, setValue] = useState(id)
  const problem = componentIdProblem(doc, id, value)
  const commit = () => {
    if (problem || value === id) {
      setValue(id)
      return
    }
    onRename(value)
  }
  return (
    <div className="relative">
      <input
        aria-label={t('toolBuilder.editor.panel.componentId')}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? 'component-id-error' : undefined}
        value={value}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setValue(id)
          }
        }}
        className={cn(
          '-ml-1 w-full rounded px-1 font-mono text-[11px] text-stone-500 hover:bg-stone-100 focus:bg-white focus:text-stone-900 focus:outline-2 focus:outline-accent dark:hover:bg-stone-800 dark:focus:bg-stone-900 dark:focus:text-stone-100',
          problem && 'text-bad-ink outline-2 outline-bad'
        )}
      />
      {problem ? (
        <p id="component-id-error" className="mt-0.5 text-[11px] text-bad-ink">
          {t(`toolBuilder.editor.panel.idProblem.${problem}`)}
        </p>
      ) : null}
    </div>
  )
}
