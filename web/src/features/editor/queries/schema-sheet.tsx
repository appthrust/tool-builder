// Schema browser of a postgres data source (`GET /data-sources/{id}/schema`):
// tables → columns; choosing one inserts its (quoted when needed) identifier
// at the SQL editor's cursor.
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, KeyRound, Table2 } from 'lucide-react'
import { useId, useState } from 'react'
import { sourceSchemaQuery } from '../../../api/queries'
import type { SourceSchema } from '../../../api/types'
import { useText } from '../../../i18n'
import { Badge, cn, LoadFailed, Loading, Sheet, TextInput } from '../../../ui'

/**
 * PostgreSQL key words marked reserved (including "can be function or type"): a bare column or table of
 * this name does not parse (`select order from t`), so it is quoted.
 */
const RESERVED = new Set(
  (
    'all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation column ' +
    'concurrently constraint create cross current_catalog current_date current_role current_schema current_time current_timestamp ' +
    'current_user default deferrable desc distinct do else end except false fetch for foreign freeze from full grant group having ' +
    'ilike in initially inner intersect into is isnull join lateral leading left like limit localtime localtimestamp natural not ' +
    'notnull null offset on only or order outer overlaps placing primary references returning right select session_user similar ' +
    'some symmetric system_user table tablesample then to trailing true union unique user using variadic verbose when where window with'
  ).split(' '),
)

/**
 * Postgres identifier as SQL: bare when it is a plain lower-case name that is not a reserved word, else
 * double-quoted. A `$` is quoted too: bare, `a$1` would read as a positional placeholder to the query checks.
 */
export function sqlIdentifier(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED.has(name) ? name : `"${name.replaceAll('"', '""')}"`
}

type Table = SourceSchema['tables'][number]

function tableIdentifier(table: Table): string {
  const name = sqlIdentifier(table.name)
  return table.schema === 'public' ? name : `${sqlIdentifier(table.schema)}.${name}`
}

export function SchemaSheet({
  open,
  onOpenChange,
  sourceId,
  sourceName,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceId: string
  sourceName: string
  onInsert: (text: string) => void
}) {
  const { t } = useText()
  const filterId = useId()
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const schema = useQuery({ ...sourceSchemaQuery(sourceId), enabled: open })
  const needle = filter.trim().toLowerCase()
  const tables = (schema.data?.tables ?? []).flatMap((table): { table: Table; columns: Table['columns']; matchedTable: boolean }[] => {
    if (needle === '') return [{ table, columns: table.columns, matchedTable: true }]
    const matchedTable = `${table.schema}.${table.name}`.toLowerCase().includes(needle)
    const columns = matchedTable ? table.columns : table.columns.filter((column) => column.name.toLowerCase().includes(needle))
    return matchedTable || columns.length > 0 ? [{ table, columns, matchedTable }] : []
  })
  const insert = (text: string) => {
    onInsert(text)
    onOpenChange(false)
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('toolBuilder.queries.schema.title', { source: sourceName })} description={t('toolBuilder.queries.schema.lead')}>
      {schema.isPending ? (
        <Loading />
      ) : schema.isError ? (
        <LoadFailed error={schema.error} onRetry={() => void schema.refetch()} />
      ) : (
        <div className="space-y-3">
          <label htmlFor={filterId} className="sr-only">
            {t('toolBuilder.queries.schema.filter')}
          </label>
          <TextInput id={filterId} type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={t('toolBuilder.queries.schema.filter')} />
          {tables.length === 0 ? (
            <p className="py-4 text-sm text-stone-500">{t('toolBuilder.queries.schema.empty')}</p>
          ) : (
            <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
              {tables.map(({ table, columns, matchedTable }) => {
                const key = `${table.schema}.${table.name}`
                // A filter that matched only columns opens the table so the matches show.
                const isOpen = expanded[key] ?? (needle !== '' && !matchedTable)
                return (
                  <li key={key}>
                    <div className="flex items-center gap-1 pr-2">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`${filterId}-${key}`}
                        onClick={() => setExpanded((state) => ({ ...state, [key]: !isOpen }))}
                        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left hover:bg-stone-50"
                      >
                        <ChevronRight aria-hidden className={cn('size-4 shrink-0 text-stone-400 transition-transform', isOpen ? 'rotate-90' : undefined)} />
                        <Table2 aria-hidden className="size-4 shrink-0 text-stone-500" />
                        <span className="min-w-0 flex-1 truncate font-mono text-sm text-stone-900">{tableIdentifier(table)}</span>
                        {table.kind === 'view' ? <Badge>{t('toolBuilder.queries.schema.view')}</Badge> : null}
                      </button>
                      <button
                        type="button"
                        onClick={() => insert(tableIdentifier(table))}
                        aria-label={t('toolBuilder.queries.schema.insertColumn', { name: tableIdentifier(table) })}
                        className="min-h-10 rounded px-2 text-xs font-medium text-accent-strong hover:bg-accent-soft md:min-h-7"
                      >
                        {t('toolBuilder.queries.insertPlaceholder.insert')}
                      </button>
                    </div>
                    {isOpen ? (
                      <ul id={`${filterId}-${key}`} className="pb-2 pl-9">
                        {columns.map((column) => (
                          <li key={column.name}>
                            <button
                              type="button"
                              onClick={() => insert(sqlIdentifier(column.name))}
                              aria-label={t('toolBuilder.queries.schema.insertColumn', { name: column.name })}
                              className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left hover:bg-stone-50 md:min-h-7"
                            >
                              <span className="min-w-0 flex-1 truncate font-mono text-xs text-stone-800">{column.name}</span>
                              {column.primaryKey ? <KeyRound aria-hidden className="size-3.5 text-amber-600" /> : null}
                              {column.primaryKey ? <span className="sr-only">{t('toolBuilder.queries.schema.primaryKey')}</span> : null}
                              <span className="font-mono text-[11px] text-stone-500">{column.type}</span>
                              {column.nullable ? <span className="text-[11px] text-stone-400">{t('toolBuilder.queries.schema.nullable')}</span> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  )
}
