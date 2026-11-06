import { X } from 'lucide-react'
import { Dialog as RDialog, DropdownMenu as RMenu } from 'radix-ui'
import type { ComponentProps, ReactNode } from 'react'
import { useText } from '../i18n'
import { Button, type ButtonTone } from './button'
import { cn } from './cn'
import { ActionError } from './feedback'
import { useReturnFocus } from './focus'

/** Modal dialog (Radix): focus trap, Escape closes, focus returns to the trigger. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  onEscapeKeyDown,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** `lg` for editors with rows of controls (the talent editor). */
  size?: 'md' | 'lg'
  /** Lets an open popup inside the dialog (a listbox) take Escape first: call `preventDefault()` to keep the dialog open. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}) {
  const { t } = useText()
  const focus = useReturnFocus(open)
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-stone-900/40 animate-fade-in" />
        <RDialog.Content
          {...focus}
          onEscapeKeyDown={onEscapeKeyDown}
          {...(!description ? { 'aria-describedby': undefined } : {})}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-xl bg-white dark:bg-stone-900 shadow-xl animate-pop-in focus:outline-none',
            'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
            size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div className="min-w-0">
              <RDialog.Title className="text-base font-semibold text-stone-900 dark:text-stone-100">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-sm text-stone-500 dark:text-stone-400">{description}</RDialog.Description> : null}
            </div>
            <RDialog.Close
              aria-label={t('toolBuilder.common.close')}
              className="-mt-1 -mr-1 flex size-10 shrink-0 items-center justify-center rounded-md text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-800 dark:hover:text-stone-200 md:size-8"
            >
              <X aria-hidden className="size-4" />
            </RDialog.Close>
          </div>
          {children ? <div className="px-5 pt-4 pb-5 text-sm text-stone-700 dark:text-stone-300">{children}</div> : <div className="pb-5" />}
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-stone-100 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-800/40 px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>
          ) : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/**
 * Side panel (Radix dialog) docked to the right edge: full height, the body scrolls under a fixed header and a
 * sticky footer. Below `sm` it is a full-width bottom sheet like `Dialog`.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  onEscapeKeyDown,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** `lg` for wide content (a change list, a schema browser). */
  size?: 'md' | 'lg'
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}) {
  const { t } = useText()
  const focus = useReturnFocus(open)
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-stone-900/40 animate-fade-in" />
        <RDialog.Content
          {...focus}
          onEscapeKeyDown={onEscapeKeyDown}
          {...(!description ? { 'aria-describedby': undefined } : {})}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-xl bg-white dark:bg-stone-900 shadow-xl animate-pop-in focus:outline-none',
            'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:rounded-none sm:border-l sm:border-line sm:animate-slide-in-right',
            size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md'
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-100 dark:border-stone-800 px-5 py-4">
            <div className="min-w-0">
              <RDialog.Title className="text-base font-semibold text-stone-900 dark:text-stone-100">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-sm text-stone-500 dark:text-stone-400">{description}</RDialog.Description> : null}
            </div>
            <RDialog.Close
              aria-label={t('toolBuilder.common.close')}
              className="-mt-1 -mr-1 flex size-10 shrink-0 items-center justify-center rounded-md text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-800 dark:hover:text-stone-200 md:size-8"
            >
              <X aria-hidden className="size-4" />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-stone-700 dark:text-stone-300">{children}</div>
          {footer ? (
            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-stone-100 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-800/40 px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>
          ) : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/** Confirmation for irreversible actions; the failure stays inside the dialog. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  pending = false,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  body: ReactNode
  confirmLabel: string
  tone?: Extract<ButtonTone, 'primary' | 'danger'>
  onConfirm: () => void
  pending?: boolean
  error?: unknown
}) {
  const { t } = useText()
  const change = (next: boolean) => {
    if (!pending) onOpenChange(next)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={change}
      title={title}
      footer={
        <>
          <Button onClick={() => change(false)} disabled={pending}>
            {t('toolBuilder.common.cancel')}
          </Button>
          <Button tone={tone} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>{body}</div>
        {error ? <ActionError error={error} /> : null}
      </div>
    </Dialog>
  )
}

/**
 * Non-modal by default: a modal menu whose item opens a Dialog leaves
 * `pointer-events: none` on <body> after the dialog closes (Radix layering).
 */
export function DropdownMenu({ modal = false, ...rest }: ComponentProps<typeof RMenu.Root>) {
  return <RMenu.Root modal={modal} {...rest} />
}
export const DropdownMenuTrigger = RMenu.Trigger

export function DropdownMenuContent({ className, align = 'end', sideOffset = 6, ...rest }: ComponentProps<typeof RMenu.Content>) {
  return (
    <RMenu.Portal>
      <RMenu.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn('z-50 min-w-48 max-w-[calc(100vw-1rem)] rounded-lg border border-line bg-white dark:bg-stone-900 p-1 shadow-lg animate-pop-in', className)}
        {...rest}
      />
    </RMenu.Portal>
  )
}

export function DropdownMenuItem({ className, ...rest }: ComponentProps<typeof RMenu.Item>) {
  return (
    <RMenu.Item
      className={cn(
        'flex min-h-10 w-full cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-stone-700 dark:text-stone-300 outline-none select-none md:min-h-0 data-disabled:text-stone-400 dark:data-disabled:text-stone-500 data-highlighted:bg-stone-100 data-highlighted:text-stone-900 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-stone-500',
        className
      )}
      {...rest}
    />
  )
}

export function DropdownMenuSeparator({ className, ...rest }: ComponentProps<typeof RMenu.Separator>) {
  return <RMenu.Separator className={cn('-mx-1 my-1 h-px bg-stone-100 dark:bg-stone-800', className)} {...rest} />
}
