import { createDashboardTranslator } from '@appthrust/platform-dashboard-i18n'
import { describe, expect, test } from 'bun:test'
import { catalogs } from './copy'

const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort()

describe('tool-builder copy catalogs', () => {
  const messages = catalogs.flatMap((catalog) => Object.entries(catalog))

  test('every message is namespaced, translated to Japanese and keeps its placeholders', () => {
    for (const [id, message] of messages) {
      expect(id.startsWith('toolBuilder.'), id).toBe(true)
      const ja = message.translations.ja
      expect(ja, id).toBeTruthy()
      expect(placeholders(ja ?? ''), id).toEqual(placeholders(message.defaultMessage))
    }
  })

  test('ids and English sources are unique, so both languages build a translator', () => {
    expect(new Set(messages.map(([id]) => id)).size).toBe(messages.length)
    const english = new Map<string, string>()
    const repeated: string[] = []
    for (const [id, message] of messages) {
      const first = english.get(message.defaultMessage)
      if (first) repeated.push(`${id} = ${first} (${message.defaultMessage})`)
      else english.set(message.defaultMessage, id)
    }
    expect(repeated).toEqual([])
    const ja = createDashboardTranslator('ja', catalogs)
    const en = createDashboardTranslator('en', catalogs)
    expect(ja.t('toolBuilder.product')).toBe('社内ツールビルダー')
    expect(en.t('toolBuilder.product')).toBe('Internal Tool Builder')
  })
})
