// The sharing screen edits the tool's whole grant set locally and saves it
// with `PUT /grants` (whole set, design "API"). This reducer is the only place
// the set changes, so its invariants hold for every save:
//
// - one entry per group in `groups`; `edit` implies `use`;
// - an action entry lists only groups that hold a tool grant (a group that
//   cannot open the tool cannot run its actions);
// - an action entry is never dropped implicitly: absent means "everyone with
//   use", present and empty means "nobody" (migration 001 `action_grants`), so
//   removing the last group of a limit leaves the action runnable by nobody.
//   Only `clearActionLimit` widens an action back to everyone;
// - limits for actions that are not in the draft are kept: the live release
//   may still have that action, and the sharing screen lists them so an
//   editor removes them deliberately.
import type { GrantRole, Grants } from '../../../api/types'
import type { Document } from '../../../model/document'

export type GrantsAction =
  | { type: 'addGroup'; groupId: string; role?: GrantRole }
  | { type: 'setRole'; groupId: string; role: GrantRole }
  | { type: 'removeGroup'; groupId: string }
  | { type: 'setActionGroups'; actionId: string; groupIds: string[] }
  | { type: 'clearActionLimit'; actionId: string }

export function grantsReducer(state: Grants, action: GrantsAction): Grants {
  switch (action.type) {
    case 'addGroup': {
      if (state.groups.some((grant) => grant.groupId === action.groupId)) return state
      return { ...state, groups: [...state.groups, { groupId: action.groupId, role: action.role ?? 'use' }] }
    }
    case 'setRole':
      return { ...state, groups: state.groups.map((grant) => (grant.groupId === action.groupId ? { ...grant, role: action.role } : grant)) }
    case 'removeGroup':
      return {
        groups: state.groups.filter((grant) => grant.groupId !== action.groupId),
        actions: state.actions.map((entry) => ({ ...entry, groupIds: entry.groupIds.filter((id) => id !== action.groupId) })),
      }
    case 'setActionGroups': {
      const granted = new Set(state.groups.map((grant) => grant.groupId))
      const next = { actionId: action.actionId, groupIds: [...new Set(action.groupIds)].filter((id) => granted.has(id)) }
      const index = state.actions.findIndex((entry) => entry.actionId === action.actionId)
      if (index < 0) return { ...state, actions: [...state.actions, next] }
      return { ...state, actions: state.actions.map((entry, i) => (i === index ? next : entry)) }
    }
    case 'clearActionLimit': {
      if (!state.actions.some((entry) => entry.actionId === action.actionId)) return state
      return { ...state, actions: state.actions.filter((entry) => entry.actionId !== action.actionId) }
    }
  }
}

export type DocumentAction = { id: string; label: string; componentId: string; queryId: string }

/** Every action of the document in walk order (page, component, action). */
export function documentActions(document: Document): DocumentAction[] {
  return document.pages.flatMap((page) =>
    page.components.flatMap((component) =>
      (component.actions ?? []).map((action) => ({ id: action.id, label: action.label || action.id, componentId: component.id, queryId: action.queryId })),
    ),
  )
}

export type GroupView = {
  role: GrantRole | null
  canOpen: boolean
  canEdit: boolean
  actions: { id: string; label: string; allowed: boolean }[]
}

/**
 * What members of `groupId` get from `grants`: a projection of the access
 * rules (design "Access") with the group set substituted, no impersonation
 * and no queries run. Team admins bypass grants and are not modelled here.
 */
export function viewAs(grants: Grants, groupId: string, actions: readonly DocumentAction[]): GroupView {
  const role = grants.groups.find((grant) => grant.groupId === groupId)?.role ?? null
  const canOpen = role !== null
  return {
    role,
    canOpen,
    canEdit: role === 'edit',
    actions: actions.map((action) => {
      const limited = grants.actions.find((entry) => entry.actionId === action.id)
      return { id: action.id, label: action.label, allowed: canOpen && (!limited || limited.groupIds.includes(groupId)) }
    }),
  }
}
