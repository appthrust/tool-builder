import { describe, expect, test } from 'bun:test'
import { scanSql } from '../../../model/document.schema'
import { sqlIdentifier } from './schema-sheet'

describe('sqlIdentifier', () => {
  test('plain lower-case names stay bare', () => {
    expect(sqlIdentifier('orders')).toBe('orders')
    expect(sqlIdentifier('created_at')).toBe('created_at')
  })

  test('reserved words, mixed case, spaces and $ are quoted, with " doubled', () => {
    expect(sqlIdentifier('order')).toBe('"order"')
    expect(sqlIdentifier('user')).toBe('"user"')
    expect(sqlIdentifier('left')).toBe('"left"')
    expect(sqlIdentifier('OrderTotal')).toBe('"OrderTotal"')
    expect(sqlIdentifier('line item')).toBe('"line item"')
    expect(sqlIdentifier('a"b')).toBe('"a""b"')
    expect(sqlIdentifier('a$1')).toBe('"a$1"')
    expect(scanSql(`select ${sqlIdentifier('a$1')} from t`).positional).toBe(false)
  })
})
