import { Check, Copy } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useText } from '../i18n'
import { Button } from './button'
import { cn } from './cn'

/** Copies `value` to the clipboard and confirms in place (announced politely). */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useText()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <Button
      size="sm"
      icon={copied ? <Check className="text-accent" /> : <Copy />}
      onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
    >
      <span aria-live="polite">{copied ? t('toolBuilder.common.copied') : (label ?? t('toolBuilder.common.copyLink'))}</span>
    </Button>
  )
}

const AVATAR_SIZE = { sm: 'size-6 text-[11px]', md: 'size-8 text-xs', lg: 'size-20 text-3xl' } as const

/** The initial of a person's name in a neutral circle. Decorative; the name is always shown next to it. */
export function Avatar({ name, size = 'md' }: { name: string; size?: keyof typeof AVATAR_SIZE }) {
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-stone-200 dark:bg-stone-700 font-semibold text-stone-700 dark:text-stone-300', AVATAR_SIZE[size])}>
      {Array.from(name.trim())[0] ?? '?'}
    </span>
  )
}

/** Small neutral label next to a name (「招待中」, 「マネージャー」). */
export function Badge({ children, tone = 'neutral', title }: { children: string; tone?: 'neutral' | 'accent'; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset',
        tone === 'accent' ? 'bg-accent-soft text-accent-strong ring-accent-line' : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 ring-stone-200 dark:ring-stone-700'
      )}
    >
      {children}
    </span>
  )
}

export type StatusTone = 'ok' | 'busy' | 'bad' | 'neutral'

const STATUS_PILL: Record<StatusTone, { box: string; dot: string }> = {
  ok: { box: 'bg-ok-soft text-accent-strong ring-accent-line', dot: 'bg-ok' },
  busy: { box: 'bg-busy-soft text-busy-ink ring-amber-200 dark:ring-amber-900', dot: 'bg-busy' },
  bad: { box: 'bg-bad-soft text-bad-ink ring-red-200 dark:ring-red-900', dot: 'bg-bad' },
  neutral: { box: 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 ring-stone-200 dark:ring-stone-700', dot: 'bg-stone-400' },
}

/**
 * A state with a coloured dot (「準備中」, 「接続済み」, 「未公開の変更 3 件」). The only place status colours
 * appear outside <Notice>; the text always names the state, so colour is never the only signal.
 */
export function StatusPill({ tone, children, title }: { tone: StatusTone; children: ReactNode; title?: string }) {
  const style = STATUS_PILL[tone]
  return (
    <span
      title={title}
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', style.box)}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', style.dot, tone === 'busy' ? 'animate-pulse' : undefined)} />
      {children}
    </span>
  )
}
