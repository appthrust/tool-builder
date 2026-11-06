// Cell formatting for tables, details and stats. Query results arrive as JSON
// (numeric as strings, timestamps as RFC 3339); formats are display-only.
import type { ReactNode } from 'react'
import type { ColumnFormat } from '../model/document.schema'
import { cn } from '../ui'

/** Decision: `money` has no currency in the document, so it renders as a 2-decimal grouped amount without a symbol. */
export function formatValue(value: unknown, format: ColumnFormat | undefined, locale: string): string {
  if (value === null || value === undefined || value === '') return '—'
  switch (format) {
    case 'money': {
      const number = Number(value)
      return Number.isFinite(number) ? new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number) : String(value)
    }
    case 'number': {
      const number = Number(value)
      return Number.isFinite(number) ? new Intl.NumberFormat(locale).format(number) : String(value)
    }
    case 'date':
    case 'datetime': {
      const date = new Date(String(value))
      if (Number.isNaN(date.getTime())) return String(value)
      return new Intl.DateTimeFormat(locale, format === 'date' ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}

export type BadgeTone = 'neutral' | 'green' | 'amber' | 'sky' | 'rose' | 'violet'

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-stone-100 text-stone-600 ring-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30',
}

// Common status words get a meaningful tone; anything else a stable tone from its text.
const KEYWORD_TONES: [RegExp, BadgeTone][] = [
  [/(deliver|complet|done|paid|active|success|ok|approved|ready|完了|配達|済)/i, 'green'],
  [/(refund|pending|await|wait|hold|review|返金|待ち|保留)/i, 'amber'],
  [/(ship|transit|progress|processing|出荷|処理中)/i, 'violet'],
  [/(delay|fail|error|cancel|reject|overdue|blocked|遅延|失敗|取消|キャンセル)/i, 'rose'],
  [/(open|new|draft|未処理|新規)/i, 'sky'],
]
const HASH_TONES: BadgeTone[] = ['neutral', 'sky', 'violet', 'amber', 'green']

export function badgeTone(text: string): BadgeTone {
  for (const [pattern, tone] of KEYWORD_TONES) if (pattern.test(text)) return tone
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return HASH_TONES[Math.abs(hash) % HASH_TONES.length]!
}

export function Pill({ children, tone = 'neutral', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap ring-1 ring-inset',
        TONE_CLASS[tone],
        className
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

/** One formatted cell; badges become pills, numbers align with tabular figures. */
export function CellValue({ value, format, locale }: { value: unknown; format: ColumnFormat | undefined; locale: string }) {
  const text = formatValue(value, format, locale)
  if (format === 'badge' && text !== '—') return <Pill tone={badgeTone(text)}>{text}</Pill>
  return <span className={cn(format === 'money' || format === 'number' ? 'tabular-nums' : undefined, text === '—' && 'text-stone-400 dark:text-stone-500')}>{text}</span>
}

/** Numeric formats are right-aligned. */
export const isNumericFormat = (format: ColumnFormat | undefined) => format === 'money' || format === 'number'
