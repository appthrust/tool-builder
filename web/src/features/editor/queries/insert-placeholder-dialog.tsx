// "Insert placeholder": pick an existing parameter or name a new one; the
// editor inserts `{{ name }}` at the cursor and the parameter list follows.
import { useId, useState, type FormEvent } from 'react'
import { useText } from '../../../i18n'
import type { Param } from '../../../model/document'
import { Button, Dialog, Field, TextInput } from '../../../ui'
import { PLACEHOLDER_NAME } from './placeholders'

export function InsertPlaceholderDialog({
  open,
  onOpenChange,
  params,
  onInsert,
  initialName = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  params: Param[]
  onInsert: (name: string) => void
  initialName?: string
}) {
  const { t } = useText()
  const id = useId()
  const [name, setName] = useState(initialName)
  const [touched, setTouched] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(initialName)
      setTouched(false)
    }
  }
  const valid = PLACEHOLDER_NAME.test(name)
  const choose = (chosen: string) => {
    onInsert(chosen)
    onOpenChange(false)
    setName('')
    setTouched(false)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (valid) choose(name)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('toolBuilder.queries.insertPlaceholder.title')}
      description={t('toolBuilder.queries.insertPlaceholder.body')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('toolBuilder.common.cancel')}</Button>
          <Button tone="primary" type="submit" form={`${id}-form`}>
            {t('toolBuilder.queries.insertPlaceholder.insert')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {params.length > 0 ? (
          <div>
            <p className="text-sm font-medium text-stone-800 dark:text-stone-200">{t('toolBuilder.queries.insertPlaceholder.existing')}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {params.map((param) => (
                <li key={param.name}>
                  <Button size="sm" onClick={() => choose(param.name)} className="font-mono">
                    {`{{ ${param.name} }}`}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <form id={`${id}-form`} onSubmit={submit} noValidate>
          <Field id={`${id}-name`} label={t('toolBuilder.queries.insertPlaceholder.name')} error={touched && !valid ? t('toolBuilder.queries.new.nameInvalid') : undefined}>
            <TextInput id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} invalid={touched && !valid} autoComplete="off" spellCheck={false} className="font-mono" />
          </Field>
        </form>
      </div>
    </Dialog>
  )
}
