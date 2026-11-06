// Right column of the query editor: parameter origins, types, bindings, Run
// samples and limits. Parameters are derived from placeholders and filters.
import { useId, useState } from 'react'
import type { MessageId } from '../../../copy'
import { useText } from '../../../i18n'
import { type Document, PARAM_TYPES, type Param, type ParamType, type Query } from '../../../model/document'
import { MAX_ROW_LIMIT, MAX_TIMEOUT_MS, queryPlaceholders } from '../../../model/document.schema'
import { Field, Select, TextInput } from '../../../ui'
import { filterAcceptsType } from './filter-ops'
import { refKey, refOptions, sampleFromLiteral, sampleInput } from './placeholders'

const TYPE_LABEL: Record<ParamType, MessageId> = {
  text: 'toolBuilder.queries.type.text',
  number: 'toolBuilder.queries.type.number',
  boolean: 'toolBuilder.queries.type.boolean',
  date: 'toolBuilder.queries.type.date',
  timestamp: 'toolBuilder.queries.type.timestamp',
  textList: 'toolBuilder.queries.type.textList',
  numberList: 'toolBuilder.queries.type.numberList',
}

const LITERAL = 'literal'
const isList = (type: ParamType) => type === 'textList' || type === 'numberList'

/** A text field that commits on blur or Enter, so typing `a, ` into a list is not reparsed on every key. */
export function CommitInput({ id, value, onCommit, inputMode, list }: { id: string; value: string; onCommit: (raw: string) => void; inputMode?: 'numeric'; list?: string }) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setText(value)
  }
  return (
    <TextInput
      id={id}
      value={text}
      inputMode={inputMode}
      list={list}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text !== value) onCommit(text)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) onCommit(text)
      }}
      className="font-mono text-xs"
    />
  )
}

function ParamCard({
  param,
  document,
  query,
  sample,
  onSample,
  onChange,
}: {
  param: Param
  document: Document
  query: Query
  sample: string
  onSample: (raw: string) => void
  onChange: (param: Param) => void
}) {
  const { t } = useText()
  const id = useId()
  const refs = refOptions(document)
  const filters = (query.filters ?? []).filter((filter) => filter.param === param.name)
  const filterOnly = filters.length > 0 && !queryPlaceholders(query).includes(param.name)
  const bound = 'ref' in param.bind ? `ref:${refKey(param.bind.ref)}` : LITERAL
  const options = [
    { value: LITERAL, label: t('toolBuilder.queries.params.bindLiteral') },
    ...refs.map((option) => ({ value: `ref:${refKey(option.ref)}`, label: <span className="font-mono text-xs">{option.label}</span> })),
  ]
  if ('ref' in param.bind && !refs.some((option) => `ref:${refKey(option.ref)}` === bound)) {
    options.push({ value: bound, label: <span className="font-mono text-xs">{t('toolBuilder.queries.params.refMissing', { ref: refKey(param.bind.ref) })}</span> })
  }
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-3">
      <p className="font-mono text-sm font-medium text-stone-900">{filterOnly ? param.name : `{{ ${param.name} }}`}</p>
      {filterOnly ? <p className="mt-1 text-xs text-stone-500">{t('toolBuilder.filters.origin', { column: filters.map((filter) => filter.column).join(', ') })}</p> : null}
      <div className="mt-3 space-y-3">
        <Field id={`${id}-type`} label={t('toolBuilder.editor.fields.typeLabel')} hint={filters.length ? t('toolBuilder.filters.typeHint') : undefined}>
          <Select
            id={`${id}-type`}
            value={param.type}
            onChange={(type) => onChange({ ...param, type: type as ParamType })}
            options={PARAM_TYPES.map((type) => ({ value: type, label: t(TYPE_LABEL[type]), disabled: filters.some((filter) => !filterAcceptsType(filter.op, type)) }))}
          />
        </Field>
        <Field id={`${id}-bind`} label={t('toolBuilder.queries.params.bind')}>
          <Select
            id={`${id}-bind`}
            value={bound}
            onChange={(value) => {
              if (value === LITERAL) {
                onChange({ ...param, bind: { literal: null } })
                return
              }
              const ref = refs.find((option) => `ref:${refKey(option.ref)}` === value)?.ref
              if (ref) onChange({ ...param, bind: { ref } })
            }}
            options={options}
          />
        </Field>
        {'literal' in param.bind ? (
          <Field id={`${id}-literal`} label={t('toolBuilder.queries.params.bindLiteral')} hint={isList(param.type) ? t('toolBuilder.queries.params.listHint') : t('toolBuilder.queries.params.literalHint')}>
            <CommitInput id={`${id}-literal`} value={sampleFromLiteral(param.bind.literal)} onCommit={(raw) => onChange({ ...param, bind: { literal: sampleInput(param.type, raw) } })} />
          </Field>
        ) : null}
        <Field id={`${id}-sample`} label={t('toolBuilder.queries.params.sample')} hint={isList(param.type) ? t('toolBuilder.queries.params.listHint') : undefined}>
          <TextInput id={`${id}-sample`} value={sample} onChange={(event) => onSample(event.target.value)} className="font-mono text-xs" />
        </Field>
      </div>
    </li>
  )
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function ParamsPanel({
  query,
  document,
  samples,
  onSample,
  onChange,
}: {
  query: Query
  document: Document
  samples: Record<string, string>
  onSample: (name: string, raw: string) => void
  onChange: (fn: (query: Query) => Query) => void
}) {
  const { t } = useText()
  const id = useId()
  return (
    <div className="space-y-6">
      <section aria-labelledby={`${id}-params`}>
        <h2 id={`${id}-params`} className="text-sm font-semibold text-stone-900">
          {t('toolBuilder.queries.params')}
        </h2>
        {query.params.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">{t('toolBuilder.queries.params.empty', { example: '{{ name }}' })}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {query.params.map((param) => (
              <ParamCard
                key={param.name}
                param={param}
                query={query}
                document={document}
                sample={samples[param.name] ?? ('literal' in param.bind ? sampleFromLiteral(param.bind.literal) : '')}
                onSample={(raw) => onSample(param.name, raw)}
                onChange={(next) => onChange((current) => ({ ...current, params: current.params.map((item) => (item.name === param.name ? next : item)) }))}
              />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby={`${id}-limits`}>
        <h2 id={`${id}-limits`} className="text-sm font-semibold text-stone-900">
          {t('toolBuilder.queries.settings')}
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field id={`${id}-timeout`} label={t('toolBuilder.queries.timeout')} hint={t('toolBuilder.queries.timeoutHint')}>
            <CommitInput
              id={`${id}-timeout`}
              inputMode="numeric"
              value={String(query.timeoutMs)}
              onCommit={(raw) => onChange((current) => ({ ...current, timeoutMs: clampInt(raw, 1, MAX_TIMEOUT_MS, current.timeoutMs) }))}
            />
          </Field>
          {query.mode === 'read' ? (
            <Field id={`${id}-rows`} label={t('toolBuilder.queries.rowLimit')} hint={t('toolBuilder.queries.rowLimitHint')}>
              <CommitInput
                id={`${id}-rows`}
                inputMode="numeric"
                value={String(query.rowLimit)}
                onCommit={(raw) => onChange((current) => ({ ...current, rowLimit: clampInt(raw, 1, MAX_ROW_LIMIT, current.rowLimit) }))}
              />
            </Field>
          ) : null}
        </div>
      </section>
    </div>
  )
}
