// Style tab: where the component sits — grid cell and size (the same values
// drag and resize write), its parent container and tab — plus duplicate and
// delete for keyboard and screen-reader users.
import { Copy, Trash2 } from 'lucide-react'
import type { Component, Document } from '../../../model/document'
import { GRID_COLUMNS, type TabSpec } from '../../../model/document.schema'
import { definitionFor } from '../../../renderer/registry'
import { tabOf } from '../../../renderer/grid'
import { useText } from '../../../i18n'
import { Button, Select } from '../../../ui'
import { componentsOf, duplicateComponent, findComponent, moveComponent, removeComponent, setLayout, slotOf, slotRows, subtreeIds, type Slot } from '../canvas/document-ops'
import { CompactInput, PanelField, PanelSection } from './controls'
import type { Update } from './prop-editors'

const PAGE = '__page__'

export function StyleTab({ doc, component, update, onSelect }: { doc: Document; component: Component; update: Update; onSelect: (id: string | null) => void }) {
  const { t } = useText()
  const base = `style-${component.id}`
  const { x, y, w, h } = component.layout
  const setNumber = (key: 'x' | 'y' | 'w' | 'h', raw: string, offset: number) => {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed)) return
    update((d) => setLayout(d, component.id, { ...component.layout, [key]: parsed - offset }), { coalesce: `${component.id}.layout.${key}` })
  }
  const inside = subtreeIds(doc, component.id)
  const parents = componentsOf(doc).filter((c) => (c.type === 'container' || c.type === 'tabs') && !inside.has(c.id))
  const parent = component.parentId ? findComponent(doc, component.parentId) : undefined
  const tabs = parent?.type === 'tabs' && parent.props.tabs?.kind === 'value' && Array.isArray(parent.props.tabs.value) ? (parent.props.tabs.value as TabSpec[]) : []
  const moveTo = (slot: Slot) => update((d) => moveComponent(d, component.id, slot, { x: component.layout.x, y: slotRows(d, slot) }))

  return (
    <div className="flex flex-col gap-6">
      <PanelSection title={t('toolBuilder.editor.style.layout')}>
        <div className="grid grid-cols-2 gap-3">
          <PanelField id={`${base}-x`} label={t('toolBuilder.editor.style.column')}>
            <CompactInput id={`${base}-x`} type="number" min={1} max={GRID_COLUMNS - w + 1} value={x + 1} onChange={(event) => setNumber('x', event.target.value, 1)} />
          </PanelField>
          <PanelField id={`${base}-y`} label={t('toolBuilder.editor.style.row')}>
            <CompactInput id={`${base}-y`} type="number" min={1} value={y + 1} onChange={(event) => setNumber('y', event.target.value, 1)} />
          </PanelField>
          <PanelField id={`${base}-w`} label={t('toolBuilder.editor.style.width')}>
            <CompactInput id={`${base}-w`} type="number" min={1} max={GRID_COLUMNS} value={w} onChange={(event) => setNumber('w', event.target.value, 0)} />
          </PanelField>
          <PanelField id={`${base}-h`} label={t('toolBuilder.editor.style.height')}>
            <CompactInput id={`${base}-h`} type="number" min={1} value={h} onChange={(event) => setNumber('h', event.target.value, 0)} />
          </PanelField>
        </div>
        <p className="text-[11px] text-stone-500">{t('toolBuilder.editor.style.gridHint')}</p>
      </PanelSection>
      <PanelSection title={t('toolBuilder.editor.style.placement')}>
        <PanelField id={`${base}-parent`} label={t('toolBuilder.editor.style.parent')}>
          <Select
            id={`${base}-parent`}
            value={component.parentId ?? PAGE}
            options={[
              { value: PAGE, label: t('toolBuilder.editor.panel.page') },
              ...parents.map((p) => ({ value: p.id, label: `${p.id} · ${t(definitionFor(p.type)?.label ?? 'toolBuilder.editor.unknownComponent')}` })),
            ]}
            onChange={(parentId) => {
              const next = parentId === PAGE ? undefined : findComponent(doc, parentId)
              moveTo({ parentId: next?.id, tab: next?.type === 'tabs' ? tabOf(component, next) : undefined })
            }}
          />
        </PanelField>
        {parent?.type === 'tabs' && tabs.length > 0 ? (
          <PanelField id={`${base}-tab`} label={t('toolBuilder.editor.style.tab')}>
            <Select
              id={`${base}-tab`}
              value={slotOf(doc, component).tab}
              options={tabs.map((tab) => ({ value: tab.id, label: tab.label || tab.id }))}
              onChange={(tab) => moveTo({ parentId: parent.id, tab })}
            />
          </PanelField>
        ) : null}
      </PanelSection>
      <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
        <Button
          size="sm"
          icon={<Copy />}
          onClick={() => {
            let copyId: string | undefined
            update((d) => {
              const result = duplicateComponent(d, component.id)
              copyId = result.id
              return result.doc
            })
            if (copyId) onSelect(copyId)
          }}
        >
          {t('toolBuilder.editor.canvas.duplicate')}
        </Button>
        <Button
          size="sm"
          tone="danger"
          icon={<Trash2 />}
          onClick={() => {
            update((d) => removeComponent(d, component.id))
            onSelect(null)
          }}
        >
          {t('toolBuilder.editor.canvas.delete')}
        </Button>
      </div>
    </div>
  )
}
