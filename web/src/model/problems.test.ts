import { createDashboardTranslator } from '@appthrust/platform-dashboard-i18n'
import { describe, expect, test } from 'bun:test'
import { catalogs } from '../copy'
import type { Translate } from '../i18n'
import { PROBLEM_CODES } from './document.schema'
import { problemText } from './problems'

const ja = createDashboardTranslator('ja', catalogs).t as Translate
const en = createDashboardTranslator('en', catalogs).t as Translate

describe('problemText', () => {
  test('every reason code has its own copy in both languages, never the API message', () => {
    for (const code of PROBLEM_CODES) {
      const problem = { code, path: 'queries.0.sql.text', message: 'API MESSAGE' }
      for (const t of [ja, en]) {
        const text = problemText(problem, t)
        expect(text, code).not.toBe('API MESSAGE')
        expect(text, code).not.toContain('toolBuilder.')
        expect(text, code).not.toMatch(/\{[A-Za-z]+\}/)
      }
    }
  })

  test('values come from the path and the rule limits', () => {
    expect(problemText({ code: 'duplicate_id', path: 'queries.1.id', message: '' }, en)).toBe('Another query already has this ID.')
    expect(problemText({ code: 'duplicate_id', path: 'queries.0.params.1.name', message: '' }, en)).toBe('Another parameter of this query has the same name.')
    expect(problemText({ code: 'duplicate_id', path: 'pages.0.components.2.actions.0.id', message: '' }, ja)).toBe('同じ ID のアクションがすでにあります。')
    expect(problemText({ code: 'timeout_out_of_range', path: 'queries.0.timeoutMs', message: '' }, en)).toBe('The timeout must be between 1 and 30000 ms.')
    expect(problemText({ code: 'schema', path: 'pages.0.components.1.props.columns.value.0.format', message: '' }, en)).toContain('pages.0.components.1.props.columns.value.0.format')
    expect(problemText({ code: 'schema', path: '', message: '' }, ja)).toBe('ツールがツールビルダーの読める形式ではありません。')
    expect(problemText({ code: 'empty_query', path: 'queries.0.sql.text', message: '' }, ja)).toBe('SQL が空です。実行や公開の前にクエリを書いてください。')
  })

  test('a code this build does not know shows the server message', () => {
    expect(problemText({ code: 'from_the_future', path: '', message: 'Something new' }, ja)).toBe('Something new')
  })
})
