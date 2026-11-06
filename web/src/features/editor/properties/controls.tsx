// Compact controls for the 320px property panel, on the kit's control look
// (`controlClasses`), plus the inline validation message every editor shows
// under the prop a problem is about.
import { AlertCircle } from 'lucide-react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { useText } from '../../../i18n'
import type { Problem } from '../../../model/document.schema'
import { problemText } from '../../../model/problems'
import { cn, controlClasses } from '../../../ui'

export const compactInput = cn(controlClasses, 'h-8 w-full px-2 text-xs')

/** A labelled row: label above, control, then problems (red) or a hint. */
export function PanelField({
  id,
  label,
  hint,
  problems = [],
  aside,
  children,
}: {
  id?: string
  label: ReactNode
  hint?: ReactNode
  problems?: readonly Problem[]
  /** Right of the label (a mode switch, an "Add" link). */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex min-h-5 items-center gap-2">
        {id ? (
          <label htmlFor={id} className="text-xs font-medium text-stone-700 dark:text-stone-300">
            {label}
          </label>
        ) : (
          <span className="text-xs font-medium text-stone-700 dark:text-stone-300">{label}</span>
        )}
        {aside ? <span className="ml-auto flex items-center gap-1">{aside}</span> : null}
      </div>
      {children}
      <ProblemList id={id ? `${id}-error` : undefined} problems={problems} />
      {problems.length === 0 && hint ? (
        <p id={id ? `${id}-hint` : undefined} className="mt-1 text-[11px] text-stone-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function ProblemList({ id, problems }: { id?: string; problems: readonly Problem[] }) {
  const { t } = useText()
  if (problems.length === 0) return null
  return (
    <ul id={id} className="mt-1 space-y-0.5">
      {problems.map((problem, index) => (
        <li key={`${problem.code}:${index}`} className="flex items-start gap-1 text-[11px] text-bad-ink dark:text-red-300">
          <AlertCircle aria-hidden className="mt-px size-3 shrink-0" />
          {problemText(problem, t)}
        </li>
      ))}
    </ul>
  )
}

/** Section heading inside a panel tab (`DATA`, `COLUMNS 6`). */
export function PanelSection({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">{title}</h3>
        {aside ? <span className="ml-auto flex items-center gap-1">{aside}</span> : null}
      </div>
      {children}
    </section>
  )
}

export function CompactInput({ invalid, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      aria-describedby={rest.id ? `${rest.id}-${invalid ? 'error' : 'hint'}` : undefined}
      className={cn(compactInput, className)}
      {...rest}
    />
  )
}

export function Checkbox({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (checked: boolean) => void; label: ReactNode }) {
  return (
    <label htmlFor={id} className="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-stone-700 dark:text-stone-300">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-4 rounded border-stone-300 accent-[var(--color-accent)]" />
      {label}
    </label>
  )
}

/** The value the Radix select uses for "nothing chosen" (option values must be non-empty). */
export const UNSET = '__unset__'
