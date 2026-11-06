import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolBuilderApiError } from '../api/client'
import { I18nProvider } from '../i18n'
import { ActionError, errorMessageId, LoadFailed } from './feedback'

const render = (node: ReactElement) => renderToStaticMarkup(<I18nProvider language="ja">{node}</I18nProvider>)

describe('tool-builder error feedback', () => {
  test('a stale draft save explains the 409 instead of a generic failure', () => {
    const html = render(<ActionError error={new ToolBuilderApiError(409, { error: 'draft_changed', message: 'draft changed', details: { draftVersion: 'v2' } })} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('ほかの人がこの下書きを変更しました')
  })

  test('a failed query keeps the database message under the localized summary; unknown errors stay generic', () => {
    const failed = render(<ActionError error={new ToolBuilderApiError(400, { error: 'query_failed', message: 'column "carrier" does not exist' })} />)
    expect(failed).toContain('クエリを実行できませんでした。')
    expect(failed).toContain('column &quot;carrier&quot; does not exist')
    expect(render(<ActionError error={new Error('boom')} />)).toContain('操作を完了できませんでした')
  })

  test('every server code maps to its own copy; unknown codes fall back by status', () => {
    expect(errorMessageId(new ToolBuilderApiError(403, { error: 'action_denied', message: '' }))).toBe('toolBuilder.errors.action_denied')
    expect(errorMessageId(new ToolBuilderApiError(503, { error: 'data_source_pending', message: '' }))).toBe('toolBuilder.errors.data_source_pending')
    expect(errorMessageId(new ToolBuilderApiError(403, { error: 'something_new', message: '' }))).toBe('toolBuilder.errors.forbidden')
    expect(errorMessageId(new ToolBuilderApiError(409, { error: 'something_new', message: '' }))).toBe('toolBuilder.errors.conflict')
    expect(errorMessageId(new ToolBuilderApiError(502, undefined))).toBe('toolBuilder.errors.transient')
  })

  test('a 401 load failure offers no retry; a transient one does', () => {
    const denied = render(<LoadFailed error={new ToolBuilderApiError(401, { error: 'unauthenticated', message: '' })} onRetry={() => {}} />)
    expect(denied).toContain('このアカウントでは社内ツールビルダーを使えません')
    expect(denied).not.toContain('<button')
    const transient = render(<LoadFailed error={new ToolBuilderApiError(503, undefined)} onRetry={() => {}} />)
    expect(transient).toContain('もう一度読み込む')
    expect(transient).toContain('一時的につながりません')
  })
})
