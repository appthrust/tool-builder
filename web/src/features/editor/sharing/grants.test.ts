import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { Grants } from '../../../api/types'
import type { Document } from '../../../model/document'
import { documentActions, grantsReducer, viewAs } from './grants'

const orderDesk = JSON.parse(
  readFileSync(new URL('../../../../../cmd/server/internal/domain/testdata/documents/valid/order-desk.json', import.meta.url), 'utf8'),
) as Document

const base: Grants = {
  groups: [
    { groupId: 'cs', role: 'use' },
    { groupId: 'finance', role: 'use' },
    { groupId: 'it', role: 'edit' },
  ],
  actions: [{ actionId: 'issue_refund', groupIds: ['finance'] }],
}

describe('grantsReducer', () => {
  test('addGroup appends with use, ignores duplicates', () => {
    const next = grantsReducer(base, { type: 'addGroup', groupId: 'ops' })
    expect(next.groups.at(-1)).toEqual({ groupId: 'ops', role: 'use' })
    expect(grantsReducer(next, { type: 'addGroup', groupId: 'ops', role: 'edit' })).toBe(next)
  })

  test('setRole changes only that group', () => {
    const next = grantsReducer(base, { type: 'setRole', groupId: 'cs', role: 'edit' })
    expect(next.groups).toEqual([
      { groupId: 'cs', role: 'edit' },
      { groupId: 'finance', role: 'use' },
      { groupId: 'it', role: 'edit' },
    ])
  })

  test('removeGroup also leaves action entries and keeps an emptied entry (nobody, never everyone)', () => {
    const next = grantsReducer(base, { type: 'removeGroup', groupId: 'finance' })
    expect(next.groups.map((g) => g.groupId)).toEqual(['cs', 'it'])
    expect(next.actions).toEqual([{ actionId: 'issue_refund', groupIds: [] }])
  })

  test('setActionGroups keeps only granted groups, dedupes; empty limits to nobody', () => {
    let next = grantsReducer(base, { type: 'setActionGroups', actionId: 'issue_refund', groupIds: ['finance', 'cs', 'cs', 'stranger'] })
    expect(next.actions).toEqual([{ actionId: 'issue_refund', groupIds: ['finance', 'cs'] }])
    next = grantsReducer(next, { type: 'setActionGroups', actionId: 'resend', groupIds: ['cs'] })
    expect(next.actions.map((a) => a.actionId)).toEqual(['issue_refund', 'resend'])
    next = grantsReducer(next, { type: 'setActionGroups', actionId: 'issue_refund', groupIds: [] })
    expect(next.actions).toEqual([
      { actionId: 'issue_refund', groupIds: [] },
      { actionId: 'resend', groupIds: ['cs'] },
    ])
  })

  test('clearActionLimit is the only way back to everyone', () => {
    const next = grantsReducer(base, { type: 'clearActionLimit', actionId: 'issue_refund' })
    expect(next.actions).toEqual([])
    expect(grantsReducer(next, { type: 'clearActionLimit', actionId: 'issue_refund' })).toBe(next)
  })
})

describe('viewAs', () => {
  const actions = documentActions(orderDesk)

  test('lists document actions', () => {
    expect(actions).toEqual([{ id: 'issue_refund', label: 'Issue refund', componentId: 'orders', queryId: 'issue_refund' }])
  })

  test('limited action is hidden from use groups outside the limit', () => {
    expect(viewAs(base, 'cs', actions)).toEqual({ role: 'use', canOpen: true, canEdit: false, actions: [{ id: 'issue_refund', label: 'Issue refund', allowed: false }] })
    expect(viewAs(base, 'finance', actions).actions[0]!.allowed).toBe(true)
  })

  test('edit implies use; no grant sees nothing', () => {
    expect(viewAs(base, 'it', actions)).toMatchObject({ role: 'edit', canOpen: true, canEdit: true })
    expect(viewAs(base, 'nobody', actions)).toMatchObject({ role: null, canOpen: false, actions: [{ allowed: false }] })
  })

  test('without a limit every use group may run the action', () => {
    expect(viewAs({ ...base, actions: [] }, 'cs', actions).actions[0]!.allowed).toBe(true)
  })

  test('an empty limit lets nobody run the action', () => {
    const nobody = grantsReducer(base, { type: 'removeGroup', groupId: 'finance' })
    for (const groupId of ['cs', 'it']) expect(viewAs(nobody, groupId, actions).actions[0]!.allowed).toBe(false)
  })
})
