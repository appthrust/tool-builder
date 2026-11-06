// Component palette: Data · Inputs · Layout & actions (renderer PALETTE).
// Drag a tile onto the canvas, or activate it (click / Enter) to add the
// component below the last one — into the selected container or tabs when
// one is selected.
import { useDraggable } from '@dnd-kit/core'
import { Search } from 'lucide-react'
import { useState } from 'react'
import type { ComponentType } from '../../../model/document'
import { definitionOf, PALETTE } from '../../../renderer/registry'
import { useText } from '../../../i18n'
import { cn } from '../../../ui'
import type { DragData } from './component-frame'

export function Palette({ onAdd }: { onAdd: (type: ComponentType) => void }) {
  const { t } = useText()
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const groups = PALETTE.map((group) => ({
    ...group,
    types: group.types.filter((type) => needle === '' || t(definitionOf(type).label).toLowerCase().includes(needle) || type.toLowerCase().includes(needle)),
  })).filter((group) => group.types.length > 0)
  return (
    <aside
      aria-label={t('toolBuilder.editor.palette.label')}
      className="flex w-52 shrink-0 flex-col gap-3 overflow-y-auto border-r border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-950"
    >
      <label className="relative block">
        <span className="sr-only">{t('toolBuilder.editor.palette.search')}</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-stone-400" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('toolBuilder.editor.palette.search')}
          className="h-8 w-full rounded-md border border-stone-300 bg-white pr-2 pl-8 text-xs placeholder:text-stone-400 focus:border-accent focus:outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
        />
      </label>
      {groups.map((group) => (
        <section key={group.group} aria-labelledby={`palette-${group.group}`}>
          <h3 id={`palette-${group.group}`} className="mb-1.5 text-[10px] font-semibold tracking-wide text-stone-500 uppercase">
            {t(group.label)}
          </h3>
          <ul className="grid grid-cols-2 gap-1.5">
            {group.types.map((type) => (
              <li key={type}>
                <PaletteTile type={type} onAdd={onAdd} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {groups.length === 0 ? <p className="text-xs text-stone-500">{t('toolBuilder.editor.palette.noMatch')}</p> : null}
      <p className="mt-auto text-[11px] leading-relaxed text-stone-400">{t('toolBuilder.editor.palette.hint')}</p>
    </aside>
  )
}

function PaletteTile({ type, onAdd }: { type: ComponentType; onAdd: (type: ComponentType) => void }) {
  const { t } = useText()
  const definition = definitionOf(type)
  const drag = useDraggable({ id: `palette:${type}`, data: { kind: 'palette', type } satisfies DragData })
  const label = t(definition.label)
  return (
    <button
      type="button"
      ref={drag.setNodeRef}
      {...drag.listeners}
      {...drag.attributes}
      aria-describedby={undefined}
      title={t('toolBuilder.editor.palette.add', { name: label })}
      onClick={() => onAdd(type)}
      className={cn(
        'flex h-14 w-full cursor-grab flex-col items-center justify-center gap-1 rounded-md border text-[11px] text-stone-700 transition-colors active:cursor-grabbing dark:text-stone-300',
        drag.isDragging
          ? 'border-dashed border-accent bg-accent-soft/60 text-accent-strong/70 dark:bg-accent/10'
          : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-600 dark:hover:bg-stone-800'
      )}
    >
      <definition.icon aria-hidden className={cn('size-4', drag.isDragging ? '' : 'text-stone-500')} />
      {label}
    </button>
  )
}

/** The chip under the pointer while a palette tile is dragged. */
export function PaletteDragChip({ type }: { type: ComponentType }) {
  const { t } = useText()
  const definition = definitionOf(type)
  return (
    <span className="flex w-max items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-800 shadow-lg">
      <definition.icon aria-hidden className="size-4 text-accent" />
      {t(definition.label)}
    </span>
  )
}
