// Running an action: optional confirm dialog (with the input form's fields when
// the action takes its input from a form), then the write query through the
// runtime (live: `/actions/{id}/run`; preview: the draft endpoint), then the
// `onSuccess.refresh` queries re-run and a notice is shown.
import { useState, type ReactNode } from 'react'
import { useText } from '../i18n'
import type { Action, Component } from '../model/document'
import { ConfirmDialog } from '../ui'
import { emptyFormValues, FormFields, formFieldsOf, validateFormValues } from './form-fields'
import { useToolRuntime } from './runtime-context'

type Pending = { action: Action; subject?: string }

/**
 * `start(action, subject?)` runs `action` — straight away when it has neither
 * a confirmation nor a form input, else after the dialog. `subject` names the
 * row the action is for (shown in the dialog). `dialog` must be rendered.
 */
export function useActionRunner(tone: 'primary' | 'danger' = 'primary'): { start: (action: Action, subject?: string) => void; running: string | null; dialog: ReactNode } {
  const { t } = useText()
  const { runtime, componentById, runAction, notify, source, actionsEnabled } = useToolRuntime()
  const [pending, setPending] = useState<Pending | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const formOf = (action: Action): Component | undefined => {
    const form = action.input ? componentById.get(action.input.formComponent) : undefined
    return form?.type === 'form' ? form : undefined
  }

  const execute = async (action: Action): Promise<boolean> => {
    const form = formOf(action)
    if (form) {
      const fields = formFieldsOf(form)
      const values = runtime.bindings.state[form.id]?.values
      const errors = validateFormValues(fields, values && typeof values === 'object' ? (values as Record<string, unknown>) : {}, t)
      setFieldErrors(errors)
      if (Object.keys(errors).length > 0) return false
    }
    const { inputs, ready, missing } = runtime.inputsOf(action.queryId)
    if (!ready) {
      setError(null)
      notify('error', t('toolBuilder.renderer.action.missingInputs', { names: missing.join(', ') }))
      return false
    }
    setRunning(action.id)
    setError(null)
    try {
      const outcome = await runAction(action, inputs)
      if (form) runtime.setExposed(form.id, 'values', emptyFormValues(formFieldsOf(form)))
      notify('success', t('toolBuilder.renderer.action.done', { label: action.label, count: outcome.rowCount }))
      return true
    } catch (caught) {
      setError(caught)
      return false
    } finally {
      setRunning(null)
    }
  }

  const start = (action: Action, subject?: string) => {
    if (!actionsEnabled || running) return
    setError(null)
    setFieldErrors({})
    if (!action.confirm && !formOf(action) && source === 'live') {
      void execute(action).then((ok) => {
        if (!ok && !formOf(action)) setPending({ action, subject })
      })
      return
    }
    setPending({ action, subject })
  }

  const form = pending ? formOf(pending.action) : undefined
  const dialog = pending ? (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) setPending(null)
      }}
      title={pending.action.confirm?.title || pending.action.label}
      tone={tone}
      confirmLabel={pending.action.label}
      pending={running === pending.action.id}
      error={error}
      onConfirm={() => {
        void execute(pending.action).then((ok) => {
          if (ok) setPending(null)
        })
      }}
      body={
        <div className="space-y-4">
          {pending.subject ? <p className="font-mono text-xs text-stone-500 dark:text-stone-400">{t('toolBuilder.renderer.action.forRow', { row: pending.subject })}</p> : null}
          <p>{pending.action.confirm?.body || t('toolBuilder.renderer.action.confirmBody', { label: pending.action.label })}</p>
          {form ? <FormFields form={form} errors={fieldErrors} /> : null}
          {source === 'draft' ? (
            <p className="rounded-md bg-busy-soft px-3 py-2 text-xs text-busy-ink dark:bg-amber-500/10 dark:text-amber-300">{t('toolBuilder.renderer.action.previewNote')}</p>
          ) : null}
        </div>
      }
    />
  ) : null

  return { start, running, dialog }
}
