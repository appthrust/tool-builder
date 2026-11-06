// One change per row: what kind of thing changed how (added / removed /
// changed, never by colour alone) and its label.
import { Minus, PencilLine, Plus } from 'lucide-react'
import type { ReleaseChange } from '../../../api/types'
import type { MessageId } from '../../../copy'
import { useText } from '../../../i18n'
import { cn } from '../../../ui'

export const CHANGE_LABEL: Record<ReleaseChange['kind'], Record<ReleaseChange['op'], MessageId>> = {
  component: {
    added: 'toolBuilder.releases.change.component.added',
    removed: 'toolBuilder.releases.change.component.removed',
    changed: 'toolBuilder.releases.change.component.changed',
  },
  query: { added: 'toolBuilder.releases.change.query.added', removed: 'toolBuilder.releases.change.query.removed', changed: 'toolBuilder.releases.change.query.changed' },
  action: { added: 'toolBuilder.releases.change.action.added', removed: 'toolBuilder.releases.change.action.removed', changed: 'toolBuilder.releases.change.action.changed' },
  page: { added: 'toolBuilder.releases.change.page.added', removed: 'toolBuilder.releases.change.page.removed', changed: 'toolBuilder.releases.change.page.changed' },
}

const OP_STYLE: Record<ReleaseChange['op'], { icon: typeof Plus; className: string }> = {
  added: { icon: Plus, className: 'bg-ok-soft text-accent-strong dark:bg-stone-800 dark:text-teal-300' },
  removed: { icon: Minus, className: 'bg-bad-soft text-bad-ink dark:bg-stone-800 dark:text-red-300' },
  changed: { icon: PencilLine, className: 'bg-busy-soft text-busy-ink dark:bg-stone-800 dark:text-amber-300' },
}

export function ChangeList({ changes, limit }: { changes: ReleaseChange[]; limit?: number }) {
  const { t } = useText()
  const shown = limit === undefined ? changes : changes.slice(0, limit)
  return (
    <>
      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
        {shown.map((change) => {
          const style = OP_STYLE[change.op]
          const Icon = style.icon
          return (
            <li key={`${change.kind}:${change.id}`} className="flex items-start gap-3 py-2">
              <span aria-hidden className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md', style.className)}>
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-stone-900 dark:text-stone-100">{change.label}</span>
                <span className="flex min-w-0 gap-2 text-xs text-stone-500 dark:text-stone-400">
                  <span className="shrink-0">{t(CHANGE_LABEL[change.kind][change.op])}</span>
                  {change.label !== change.id ? <span className="min-w-0 truncate font-mono text-stone-400">{change.id}</span> : null}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      {limit !== undefined && changes.length > limit ? <p className="pt-1 text-xs text-stone-500">{t('toolBuilder.releases.draft.more', { count: changes.length - limit })}</p> : null}
    </>
  )
}
