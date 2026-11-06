// Property panel "Data" tab: what the selected component reads (its data
// query's params, ref props, a form an action takes its input from) and what
// reads it, from the document's connection facts (model/flow.ts). Ref rows
// disconnect in place; component names jump the selection.
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Database, Unplug } from 'lucide-react'
import type { ReactNode } from 'react'
import { dataSourcesQuery } from '../../../api/queries'
import type { Component, Document, Param, Ref } from '../../../model/document'
import { dataQueryOf } from '../../../model/document.schema'
import { edgeKey, edgesAround, flowHints, type FlowEdge, type FlowHint } from '../../../model/flow'
import { useText } from '../../../i18n'
import { paths } from '../../../routes/paths'
import { Badge, Button, cn, HrefLink, Notice } from '../../../ui'
import { disconnectEdge, findComponent } from '../canvas/document-ops'
import { PanelSection } from './controls'
import type { Update } from './prop-editors'

type Select = (id: string) => void

export function DataTab({
  slug,
  doc,
  component,
  update,
  onSelect,
  onShowProperties,
}: {
  slug: string
  doc: Document
  component: Component
  update: Update
  onSelect: Select
  onShowProperties: () => void
}) {
  const { t } = useText()
  const { upstream, downstream } = edgesAround(doc, component.id)
  const hints = flowHints(doc).filter((hint) => hint.componentId === component.id)
  const queryId = dataQueryOf(component)
  const disconnect = (edge: FlowEdge) => update((d) => disconnectEdge(d, edge))
  const empty = !queryId && upstream.length === 0 && downstream.length === 0 && hints.length === 0

  return (
    <div className="flex flex-col gap-6">
      {hints.map((hint) => (
        <HintNotice key={hint.kind} hint={hint} onShowProperties={onShowProperties} />
      ))}
      {queryId || upstream.length > 0 ? (
        <PanelSection title={t('toolBuilder.dataTab.reads')}>
          {queryId ? <ReadsQuery slug={slug} doc={doc} component={component} queryId={queryId} upstream={upstream} onSelect={onSelect} onDisconnect={disconnect} /> : null}
          <UpstreamRefs doc={doc} component={component} edges={upstream.filter((edge) => edge.kind !== 'param')} onSelect={onSelect} onDisconnect={disconnect} />
        </PanelSection>
      ) : null}
      {downstream.length > 0 ? (
        <PanelSection title={t('toolBuilder.dataTab.usedBy')}>
          <UsedBy doc={doc} edges={downstream} onSelect={onSelect} onDisconnect={disconnect} />
        </PanelSection>
      ) : null}
      {empty ? <p className="text-xs text-stone-500">{t('toolBuilder.dataTab.empty')}</p> : null}
    </div>
  )
}

function HintNotice({ hint, onShowProperties }: { hint: FlowHint; onShowProperties: () => void }) {
  const { t } = useText()
  if (hint.kind === 'noData') {
    return (
      <Notice
        tone="warning"
        className="px-3 py-2 text-xs"
        actions={
          <Button size="sm" onClick={onShowProperties}>
            {t('toolBuilder.dataTab.showProperties')}
          </Button>
        }
      >
        {t('toolBuilder.dataTab.noData')}
      </Notice>
    )
  }
  return (
    <Notice tone="warning" className="px-3 py-2 text-xs">
      {t('toolBuilder.dataTab.unconnected')}
    </Notice>
  )
}

/** The component's data query: name, source, and where each `{{ param }}` gets its value. */
function ReadsQuery({
  slug,
  doc,
  component,
  queryId,
  upstream,
  onSelect,
  onDisconnect,
}: {
  slug: string
  doc: Document
  component: Component
  queryId: string
  upstream: FlowEdge[]
  onSelect: Select
  onDisconnect: (edge: FlowEdge) => void
}) {
  const { t } = useText()
  // Editors may list data sources; the name is a hint, so a failed list just leaves it out (as the status bar does).
  const sources = useQuery(dataSourcesQuery)
  const query = doc.queries.find((candidate) => candidate.id === queryId)
  if (!query) return <p className="text-[11px] text-bad-ink dark:text-red-300">{t('toolBuilder.dataTab.queryMissing', { id: queryId })}</p>
  const source = sources.data?.find((candidate) => candidate.id === query.sourceId)
  return (
    <div className="rounded-md border border-stone-200 dark:border-stone-800">
      <div className="flex min-w-0 items-center gap-1.5 border-b border-stone-200 px-2.5 py-2 dark:border-stone-800">
        <Database aria-hidden className="size-3.5 shrink-0 text-stone-400" />
        <HrefLink href={paths.editQuery(slug, query.id)} className="min-w-0 truncate font-mono text-xs font-medium text-stone-900 hover:underline dark:text-stone-100">
          {query.name}
        </HrefLink>
        <span className="ml-auto shrink-0">
          <Badge>{`${query.sql ? 'SQL' : 'HTTP'}${source ? ` · ${source.slug}` : ''}`}</Badge>
        </span>
      </div>
      {query.params.length === 0 ? (
        <p className="px-2.5 py-2 text-[11px] text-stone-500">{t('toolBuilder.dataTab.noParams')}</p>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-stone-800/60">
          {query.params.map((param) => (
            <ParamRow
              key={param.name}
              doc={doc}
              param={param}
              edge={paramEdge(upstream, component.id, query.id, param)}
              onSelect={onSelect}
              onDisconnect={onDisconnect}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** The param edge the flow model reports for this bind; built from the bind itself if the model left it out (e.g. a source that no longer exists). */
function paramEdge(upstream: FlowEdge[], to: string, queryId: string, param: Param): FlowEdge | undefined {
  if (!('ref' in param.bind)) return undefined
  return (
    upstream.find((edge) => edge.kind === 'param' && edge.queryId === queryId && edge.param === param.name) ?? {
      kind: 'param',
      from: param.bind.ref,
      to,
      queryId,
      param: param.name,
    }
  )
}

function ParamRow({ doc, param, edge, onSelect, onDisconnect }: { doc: Document; param: Param; edge: FlowEdge | undefined; onSelect: Select; onDisconnect: (edge: FlowEdge) => void }) {
  const { t } = useText()
  const placeholder = `{{ ${param.name} }}`
  return (
    <FlowRow
      left={<span className="font-mono text-stone-800 dark:text-stone-200">{placeholder}</span>}
      arrow="left"
      right={
        edge ? (
          <RefLabel doc={doc} refValue={edge.from} onSelect={onSelect} />
        ) : 'literal' in param.bind && param.bind.literal !== null && param.bind.literal !== undefined ? (
          <span className="truncate text-stone-600 dark:text-stone-400">{t('toolBuilder.dataTab.literal', { value: JSON.stringify(param.bind.literal) })}</span>
        ) : (
          <span className="text-stone-400 italic">{t('toolBuilder.dataTab.notBound')}</span>
        )
      }
      action={edge ? <DisconnectButton label={t('toolBuilder.dataTab.disconnect', { from: refText(edge.from), to: placeholder })} onClick={() => onDisconnect(edge)} /> : null}
    />
  )
}

/** Ref props of this component (`heading ← orders.selectedRow.name`) and forms its actions read. */
function UpstreamRefs({ doc, component, edges, onSelect, onDisconnect }: { doc: Document; component: Component; edges: FlowEdge[]; onSelect: Select; onDisconnect: (edge: FlowEdge) => void }) {
  const { t } = useText()
  if (edges.length === 0) return null
  return (
    <ul className="divide-y divide-stone-100 rounded-md border border-stone-200 dark:divide-stone-800/60 dark:border-stone-800">
      {edges.map((edge) => {
        const target = edge.kind === 'prop' ? edge.prop : edge.kind === 'form' ? actionLabel(component, edge.actionId) : ''
        return (
          <FlowRow
            key={edgeKey(edge)}
            left={
              edge.kind === 'prop' ? (
                <span className="font-mono text-stone-800 dark:text-stone-200">{edge.prop}</span>
              ) : (
                <span className="truncate text-stone-800 dark:text-stone-200">{t('toolBuilder.dataTab.action', { label: target })}</span>
              )
            }
            arrow="left"
            right={<RefLabel doc={doc} refValue={edge.from} onSelect={onSelect} />}
            action={edge.kind === 'prop' ? <DisconnectButton label={t('toolBuilder.dataTab.disconnect', { from: refText(edge.from), to: target })} onClick={() => onDisconnect(edge)} /> : null}
          />
        )
      })}
    </ul>
  )
}

/** Downstream edges grouped by the component they reach. */
function UsedBy({ doc, edges, onSelect, onDisconnect }: { doc: Document; edges: FlowEdge[]; onSelect: Select; onDisconnect: (edge: FlowEdge) => void }) {
  const { t } = useText()
  const groups = new Map<string, FlowEdge[]>()
  for (const edge of edges) groups.set(edge.to, [...(groups.get(edge.to) ?? []), edge])
  return (
    <ul className="flex flex-col gap-2">
      {[...groups.entries()].map(([to, group]) => {
        const target = findComponent(doc, to)
        return (
          <li key={to} className="rounded-md border border-stone-200 dark:border-stone-800">
            <div className="flex items-center gap-1.5 border-b border-stone-200 px-2.5 py-1.5 dark:border-stone-800">
              <ArrowRight aria-hidden className="size-3 shrink-0 text-stone-400" />
              <ComponentButton id={to} exists={target !== undefined} onSelect={onSelect} className="text-xs font-medium" />
            </div>
            <ul className="divide-y divide-stone-100 dark:divide-stone-800/60">
              {group.map((edge) => (
                <FlowRow
                  key={edgeKey(edge)}
                  left={<span className="font-mono text-stone-800 dark:text-stone-200">{edge.from.prop}</span>}
                  arrow="right"
                  right={<EdgeTarget doc={doc} target={target} edge={edge} />}
                  action={
                    edge.kind === 'form' ? null : (
                      <DisconnectButton
                        label={t('toolBuilder.dataTab.disconnect', { from: refText(edge.from), to: edge.kind === 'param' ? `${to} · ${edge.param}` : `${to}.${edge.prop}` })}
                        onClick={() => onDisconnect(edge)}
                      />
                    )
                  }
                />
              ))}
            </ul>
          </li>
        )
      })}
    </ul>
  )
}

/** What a downstream edge feeds: `search_orders · param search`, `prop heading`, `action Issue refund`. */
function EdgeTarget({ doc, target, edge }: { doc: Document; target: Component | undefined; edge: FlowEdge }) {
  const { t } = useText()
  if (edge.kind === 'param') {
    const name = doc.queries.find((query) => query.id === edge.queryId)?.name ?? edge.queryId
    return (
      <span className="flex min-w-0 items-center gap-1">
        <Database aria-hidden className="size-3 shrink-0 text-stone-400" />
        <span className="truncate font-mono text-stone-800 dark:text-stone-200">{name}</span>
        <span className="shrink-0 text-stone-500">{t('toolBuilder.dataTab.param', { name: edge.param })}</span>
      </span>
    )
  }
  if (edge.kind === 'prop') return <span className="truncate text-stone-500">{t('toolBuilder.dataTab.prop', { name: edge.prop })}</span>
  return <span className="truncate text-stone-500">{t('toolBuilder.dataTab.action', { label: target ? actionLabel(target, edge.actionId) : edge.actionId })}</span>
}

function actionLabel(component: Component, actionId: string): string {
  const action = component.actions?.find((candidate) => candidate.id === actionId)
  return action?.label || actionId
}

function refText(ref: Ref): string {
  return `${ref.component}.${ref.prop}`
}

function FlowRow({ left, arrow, right, action }: { left: ReactNode; arrow: 'left' | 'right'; right: ReactNode; action: ReactNode }) {
  const Arrow = arrow === 'left' ? ArrowLeft : ArrowRight
  return (
    <li className="flex min-h-8 items-center gap-1 px-2.5 py-1 text-[11px]">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="flex max-w-full min-w-0 items-center gap-1.5">
          {left}
          <Arrow aria-hidden className="size-3 shrink-0 text-stone-400" />
        </span>
        <span className="flex max-w-full min-w-0 items-center">{right}</span>
      </div>
      {action ? <span className="-mr-1.5 shrink-0">{action}</span> : null}
    </li>
  )
}

/** `orders.selectedRow.number`, the component part selecting it on the canvas. */
function RefLabel({ doc, refValue, onSelect }: { doc: Document; refValue: Ref; onSelect: Select }) {
  return (
    <span className="flex min-w-0 items-baseline font-mono">
      <ComponentButton id={refValue.component} exists={findComponent(doc, refValue.component) !== undefined} onSelect={onSelect} />
      <span className="truncate text-stone-500">.{refValue.prop}</span>
    </span>
  )
}

function ComponentButton({ id, exists, onSelect, className }: { id: string; exists: boolean; onSelect: Select; className?: string }) {
  const { t } = useText()
  if (!exists) return <span className={cn('shrink-0 font-mono text-bad-ink line-through dark:text-red-300', className)}>{id}</span>
  return (
    <button
      type="button"
      title={t('toolBuilder.dataTab.select', { id })}
      onClick={() => onSelect(id)}
      className={cn('shrink-0 rounded-sm font-mono text-accent-strong hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none', className)}
    >
      {id}
    </button>
  )
}

function DisconnectButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-bad-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none dark:hover:bg-stone-800 dark:hover:text-red-300"
    >
      <Unplug aria-hidden className="size-3.5" />
    </button>
  )
}
