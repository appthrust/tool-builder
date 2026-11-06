// `form` (fields exposing `values`, submit runs its actions), `text`,
// `button` (runs its action), `container` and `tabs` (render their children
// in their own grid; tabs expose `active`), `divider`.
import { Tabs as RTabs } from 'radix-ui'
import { z } from 'zod'
import { useText } from '../../i18n'
import type { Component } from '../../model/document'
import { BUTTON_VARIANTS, literalProp, tabSpecSchema } from '../../model/document.schema'
import { Button, cn } from '../../ui'
import { useActionRunner } from '../actions'
import { Card, StateMessage } from '../frame'
import { FormFields } from '../form-fields'
import { childrenOf, tabOf } from '../grid'
import { GridLayout } from '../renderer'
import { useExposed, usePropValue, useToolRuntime } from '../runtime-context'

export function FormRuntime({ component }: { component: Component }) {
  const { t } = useText()
  const { actionsEnabled } = useToolRuntime()
  const submitLabel = literalProp(component, 'submitLabel', z.string())
  const actions = component.actions ?? []
  const { start, running, dialog } = useActionRunner()
  const hasFields = (literalProp(component, 'fields', z.array(z.unknown())) ?? []).length > 0
  return (
    <Card label={component.id}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          const action = actions[0]
          if (action) start(action)
        }}
      >
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {hasFields ? <FormFields form={component} errors={{}} compact /> : <StateMessage title={t('toolBuilder.renderer.state.noFields')} />}
        </div>
        {actions.length > 0 ? (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-2.5 dark:border-stone-700">
            {actions.map((action, index) => (
              <Button
                key={action.id}
                size="sm"
                type={index === 0 ? 'submit' : 'button'}
                tone={index === 0 ? 'primary' : 'secondary'}
                disabled={!actionsEnabled}
                loading={running === action.id}
                title={actionsEnabled ? undefined : t('toolBuilder.renderer.action.disabledInEditor')}
                onClick={index === 0 ? undefined : () => start(action)}
              >
                {index === 0 && submitLabel ? submitLabel : action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </form>
      {dialog}
    </Card>
  )
}

export function TextRuntime({ component }: { component: Component }) {
  const { t } = useText()
  const { actionsEnabled } = useToolRuntime()
  const heading = usePropValue(component, 'heading')
  const body = usePropValue(component, 'body')
  const headingText = heading === null || heading === undefined ? '' : String(heading)
  const bodyText = body === null || body === undefined ? '' : String(body)
  if (!headingText && !bodyText) {
    // Only the editor canvas shows a hint; an empty text renders nothing for members.
    return actionsEnabled ? null : <p className="text-xs text-stone-400 italic dark:text-stone-500">{t('toolBuilder.renderer.state.textPlaceholder')}</p>
  }
  return (
    <div className="size-full min-w-0 overflow-x-hidden overflow-y-auto">
      {headingText ? <h2 className="truncate text-[18px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">{headingText}</h2> : null}
      {bodyText
        ? bodyText.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index} className="mt-0.5 text-xs whitespace-pre-line text-stone-500 dark:text-stone-400">
              {paragraph}
            </p>
          ))
        : null}
    </div>
  )
}

export function ButtonRuntime({ component }: { component: Component }) {
  const { t } = useText()
  const { actionsEnabled } = useToolRuntime()
  const variant = literalProp(component, 'variant', z.enum(BUTTON_VARIANTS)) ?? 'primary'
  const action = component.actions?.[0]
  const label = literalProp(component, 'label', z.string()) || action?.label || t('toolBuilder.renderer.button.untitled')
  const { start, running, dialog } = useActionRunner(variant === 'destructive' ? 'danger' : 'primary')
  return (
    <div className="flex size-full items-center">
      <Button
        tone={variant === 'destructive' ? 'danger' : variant}
        className="max-w-full"
        disabled={!action || !actionsEnabled}
        loading={action !== undefined && running === action.id}
        title={!action ? t('toolBuilder.renderer.button.noAction') : actionsEnabled ? undefined : t('toolBuilder.renderer.action.disabledInEditor')}
        onClick={() => {
          if (action) start(action)
        }}
      >
        <span className="truncate">{label}</span>
      </Button>
      {dialog}
    </div>
  )
}

export function ContainerRuntime({ component }: { component: Component }) {
  const { components } = useToolRuntime()
  const title = literalProp(component, 'title', z.string())
  return (
    <Card label={title || component.id}>
      {title ? <p className="shrink-0 truncate border-b border-line px-4 py-2.5 text-xs font-medium text-stone-700 dark:border-stone-700 dark:text-stone-200">{title}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <GridLayout components={childrenOf(components, component.id)} parentId={component.id} />
      </div>
    </Card>
  )
}

export function TabsRuntime({ component }: { component: Component }) {
  const { t } = useText()
  const { runtime, components } = useToolRuntime()
  const tabs = literalProp(component, 'tabs', z.array(tabSpecSchema)) ?? []
  const exposed = useExposed(component.id, 'active')
  const active = typeof exposed === 'string' && tabs.some((tab) => tab.id === exposed) ? exposed : tabs[0]?.id
  const children = childrenOf(components, component.id)
  if (tabs.length === 0) {
    return (
      <Card label={component.id}>
        <StateMessage title={t('toolBuilder.renderer.state.noTabs')} />
      </Card>
    )
  }
  return (
    <Card label={component.id}>
      <RTabs.Root value={active} onValueChange={(next) => runtime.setExposed(component.id, 'active', next)} className="flex min-h-0 flex-1 flex-col">
        <RTabs.List className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 dark:border-stone-700">
          {tabs.map((tab) => (
            <RTabs.Trigger
              key={tab.id}
              value={tab.id}
              className={cn(
                '-mb-px h-10 shrink-0 border-b-2 border-transparent px-3 text-xs font-medium whitespace-nowrap text-stone-500 transition-colors hover:text-stone-800 md:h-9 dark:text-stone-400 dark:hover:text-stone-100',
                'data-[state=active]:border-accent data-[state=active]:text-stone-900 dark:data-[state=active]:text-stone-50'
              )}
            >
              {tab.label || tab.id}
            </RTabs.Trigger>
          ))}
        </RTabs.List>
        {tabs.map((tab) => (
          <RTabs.Content key={tab.id} value={tab.id} className="min-h-0 flex-1 overflow-auto p-3 focus-visible:outline-none">
            <GridLayout components={children.filter((child) => tabOf(child, component) === tab.id)} parentId={component.id} tabId={tab.id} />
          </RTabs.Content>
        ))}
      </RTabs.Root>
    </Card>
  )
}

export function DividerRuntime({ component }: { component: Component }) {
  const label = literalProp(component, 'label', z.string())
  return (
    <div role="separator" aria-label={label || undefined} className="flex size-full items-center gap-3">
      <span className="h-px flex-1 bg-line dark:bg-stone-700" />
      {label ? <span className="text-[11px] font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">{label}</span> : null}
      {label ? <span className="h-px flex-1 bg-line dark:bg-stone-700" /> : null}
    </div>
  )
}
