// "+ New query": name, data source and read/write. The query is added to the
// draft (no server call of its own); the page then opens it.
import { useId, useState, type FormEvent } from 'react'
import type { DataSourceKind } from '../../../api/types'
import { useText } from '../../../i18n'
import type { QueryMode } from '../../../model/document'
import { Button, Dialog, Field, RadioCards, Select, TextInput } from '../../../ui'
import { PLACEHOLDER_NAME } from './placeholders'

export type SourceChoice = { id: string; name: string; kind: DataSourceKind }

export function NewQueryDialog({
  open,
  onOpenChange,
  sources,
  takenNames,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sources: SourceChoice[]
  takenNames: ReadonlySet<string>
  onCreate: (input: { name: string; sourceId: string; kind: DataSourceKind; mode: QueryMode }) => void
}) {
  const { t } = useText()
  const id = useId()
  const [name, setName] = useState('')
  const [sourceId, setSourceId] = useState<string | undefined>(sources.length === 1 ? sources[0]?.id : undefined)
  const [mode, setMode] = useState<QueryMode>('read')
  const [touched, setTouched] = useState(false)
  const nameError = !PLACEHOLDER_NAME.test(name) ? t('toolBuilder.queries.new.nameInvalid') : takenNames.has(name) ? t('toolBuilder.queries.new.nameTaken') : undefined
  const source = sources.find((item) => item.id === sourceId)
  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setName('')
      setMode('read')
      setTouched(false)
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (nameError || !source) return
    onCreate({ name, sourceId: source.id, kind: source.kind, mode })
    close(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('toolBuilder.queries.new')}
      footer={
        <>
          <Button onClick={() => close(false)}>{t('toolBuilder.common.cancel')}</Button>
          <Button tone="primary" type="submit" form={`${id}-form`}>
            {t('toolBuilder.queries.new.create')}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate className="space-y-4">
        <Field id={`${id}-name`} label={t('toolBuilder.editor.fields.name')} hint={t('toolBuilder.queries.new.nameHint')} error={touched ? nameError : undefined} required>
          <TextInput
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            invalid={touched && nameError !== undefined}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field id={`${id}-source`} label={t('toolBuilder.queries.new.source')} error={touched && !source ? t('toolBuilder.queries.new.sourcePlaceholder') : undefined} required>
          <Select
            id={`${id}-source`}
            value={sourceId}
            onChange={setSourceId}
            invalid={touched && !source}
            placeholder={t('toolBuilder.queries.new.sourcePlaceholder')}
            options={sources.map((item) => ({ value: item.id, label: item.name }))}
          />
        </Field>
        <RadioCards
          name={`${id}-mode`}
          legend={t('toolBuilder.queries.new.mode')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'read', title: t('toolBuilder.queries.mode.read'), description: t('toolBuilder.queries.new.readBody') },
            { value: 'write', title: t('toolBuilder.queries.mode.write'), description: t('toolBuilder.queries.new.writeBody') },
          ]}
        />
      </form>
    </Dialog>
  )
}
