// One-of-N segmented picker (radiogroup), e.g. the Use / Edit role of a grant.
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './cn'

export type SegmentOption<V> = { value: V; label: ReactNode; title?: string }

/**
 * One-of-N segments (radiogroup): arrow keys move and select, Home/End jump, Tab leaves. With `clearable`, choosing
 * the selected segment again clears it (value null).
 */
export function SegmentedControl<V extends string | number>({
  options,
  value,
  onChange,
  label,
  clearable = false,
  invalid,
  describedBy,
  className,
}: {
  options: readonly SegmentOption<V>[]
  value: V | null
  onChange: (value: V | null) => void
  label: string
  clearable?: boolean
  invalid?: boolean
  describedBy?: string
  className?: string
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.findIndex((option) => option.value === value)
  const focusable = selected === -1 ? 0 : selected
  const move = (event: KeyboardEvent, index: number) => {
    const last = options.length - 1
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (index + 1) % options.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index + last) % options.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined
    if (next === undefined) return
    event.preventDefault()
    onChange(options[next]!.value)
    buttons.current[next]?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(
        'inline-flex shrink-0 rounded-md border bg-white dark:bg-stone-900 p-0.5 shadow-xs',
        invalid ? 'border-bad ring-1 ring-bad' : 'border-stone-300 dark:border-stone-600',
        className
      )}
    >
      {options.map((option, index) => {
        const checked = index === selected
        return (
          <button
            key={String(option.value)}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            title={option.title}
            tabIndex={index === focusable ? 0 : -1}
            onClick={() => onChange(checked && clearable ? null : option.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'inline-flex h-9 min-w-10 items-center justify-center gap-1 rounded px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-offset-0 md:h-7 md:min-w-9',
              checked ? 'bg-accent text-white' : 'text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-900 dark:hover:text-stone-100'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
