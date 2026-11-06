// The editor's working copy of a tool's draft document. Every editor screen
// (canvas, queries, releases) reads and edits the draft through `useDraft(slug)`,
// which shares one store per tool across routes: edits apply locally at once,
// are validated with the document schema, kept in an undo history and saved
// as the whole document 1 s after the last edit (`PUT /tools/{slug}/draft`,
// `If-Match: draftVersion`). A 409 `draft_changed` means someone else saved
// first; autosave stops and the editor offers a reload (design: "Draft and
// release").
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Store, useSelector } from '@tanstack/react-store'
import { useEffect, useMemo } from 'react'
import { api, isApiError } from '../../api/client'
import { toolQuery } from '../../api/queries'
import type { Tool } from '../../api/types'
import { validateDocument, type Problem } from '../../model/document.schema'
import type { Document } from '../../model/document'

/** Delay between the last edit and the autosave. */
export const AUTOSAVE_DELAY_MS = 1000
/** Undo steps kept per tool. */
export const HISTORY_LIMIT = 50

export type DraftClient = {
  saveDraft(slug: string, document: Document, draftVersion: string): Promise<Tool>
  getTool(slug: string): Promise<Tool>
}

/** Schedules `callback` after `ms`; returns its cancel function (a seam for tests). */
export type Timers = { set(callback: () => void, ms: number): () => void }

export type DraftState = {
  tool: Tool
  document: Document
  /** `If-Match` token of the server copy `savedDocument` corresponds to. */
  version: string
  /** The document as last saved (or loaded); `dirty` is `document !== savedDocument`. */
  savedDocument: Document
  saving: boolean
  /** Epoch ms of the last successful save in this session. */
  savedAt: number | null
  /** The server copy changed under us (409 `draft_changed`); autosave is off until `reload()`. */
  conflict: boolean
  /** The last save failure other than a conflict; cleared by the next successful save. */
  saveError: unknown
  past: Document[]
  future: Document[]
  /** Consecutive edits with the same key collapse into one undo step (typing into one field). */
  coalesceKey: string | null
}

export type UpdateOptions = { coalesce?: string }

export type DraftStore = {
  store: Store<DraftState>
  update(fn: (doc: Document) => Document, options?: UpdateOptions): void
  undo(): void
  redo(): void
  /**
   * Saves now (cancels the pending autosave) and resolves once the document as of
   * the call is on the server. Rejects with the failure (the `draft_changed` error
   * while in conflict), so callers that need the server copy current (Run,
   * Publish) stop instead of acting on a stale draft.
   */
  save(): Promise<void>
  /**
   * Saves, then runs `request` with the version of the stored draft (its `If-Match`), for requests that act
   * on the stored draft (Publish). A 409 `draft_changed` from `request` puts the store in conflict like a
   * failed save, so the editor offers a reload; the error is rethrown.
   */
  onSavedDraft<T>(request: (version: string) => Promise<T>): Promise<T>
  /** Drops local changes and loads the server copy (after a conflict). */
  reload(): Promise<void>
  /**
   * A `Tool` from the query cache: metadata always; the document only when nothing local is pending and
   * the server copy is newer than the one this store last saved (`draftUpdatedAt`), so a stale refetch
   * never reverts the editor.
   */
  sync(tool: Tool): void
  dispose(): void
}

const browserTimers: Timers = {
  set: (callback, ms) => {
    const handle = setTimeout(callback, ms)
    return () => clearTimeout(handle)
  },
}

export function isDirty(state: DraftState): boolean {
  return state.document !== state.savedDocument
}

function loadedState(tool: Tool, previous?: DraftState): DraftState {
  if (!tool.draft || tool.draftVersion === null) throw new Error(`tool ${tool.slug} has no draft for this caller`)
  return {
    tool,
    document: tool.draft,
    version: tool.draftVersion,
    savedDocument: tool.draft,
    saving: false,
    savedAt: previous?.savedAt ?? null,
    conflict: false,
    saveError: null,
    past: [],
    future: [],
    coalesceKey: null,
  }
}

export function createDraftStore({
  slug,
  tool,
  client,
  isDraftChanged,
  onSaved,
  timers = browserTimers,
  delayMs = AUTOSAVE_DELAY_MS,
  now = Date.now,
}: {
  slug: string
  tool: Tool
  client: DraftClient
  /** True for the 409 `draft_changed` error of the client. */
  isDraftChanged: (error: unknown) => boolean
  /** Called with the server's answer after every save or reload (the hook writes it to the query cache). */
  onSaved?: (tool: Tool) => void
  timers?: Timers
  delayMs?: number
  now?: () => number
}): DraftStore {
  const store = new Store<DraftState>(loadedState(tool))
  let cancelPending: (() => void) | null = null
  let inflight: Promise<void> | null = null
  /** The 409 that put the store in conflict; `save()` rejects with it until `reload()`. */
  let conflictError: unknown = null
  let disposed = false

  const cancelTimer = () => {
    cancelPending?.()
    cancelPending = null
  }

  const schedule = () => {
    cancelTimer()
    if (disposed || store.state.conflict) return
    cancelPending = timers.set(() => {
      cancelPending = null
      // Autosave: a failure is already in the state (banner / save error), nobody awaits it.
      save().catch(() => undefined)
    }, delayMs)
  }

  const save = (): Promise<void> => {
    cancelTimer()
    if (disposed) return Promise.resolve()
    if (store.state.conflict) return Promise.reject(conflictError)
    // One request at a time: wait for the running save, then save what is newer.
    if (inflight) return inflight.then(() => save())
    if (!isDirty(store.state)) {
      // Undo back to the saved document: nothing is pending, so an earlier failure no longer applies.
      if (store.state.saveError !== null) store.setState((state) => ({ ...state, saveError: null }))
      return Promise.resolve()
    }
    const { document, version } = store.state
    store.setState((state) => ({ ...state, saving: true }))
    const run = client.saveDraft(slug, document, version).then(
      (saved) => {
        store.setState((state) => ({
          ...state,
          tool: saved,
          version: saved.draftVersion ?? state.version,
          savedDocument: document,
          saving: false,
          savedAt: now(),
          saveError: null,
        }))
        onSaved?.(saved)
      },
      (error: unknown) => {
        const conflict = isDraftChanged(error)
        if (conflict) conflictError = error
        store.setState((state) => ({ ...state, saving: false, conflict: state.conflict || conflict, saveError: conflict ? null : error }))
        throw error
      }
    )
    inflight = run
    // Registered before any waiter's `then`, so waiters see `inflight` cleared.
    run.then(
      () => (inflight = null),
      () => (inflight = null)
    )
    return run
  }

  const update = (fn: (doc: Document) => Document, options?: UpdateOptions) => {
    if (disposed) return
    const current = store.state.document
    const next = fn(current)
    if (next === current) return
    const coalesce = options?.coalesce ?? null
    store.setState((state) => {
      const collapse = coalesce !== null && coalesce === state.coalesceKey && state.past.length > 0
      const past = collapse ? state.past : [...state.past, state.document].slice(-HISTORY_LIMIT)
      return { ...state, document: next, past, future: [], coalesceKey: coalesce }
    })
    schedule()
  }

  const undo = () => {
    const { past, document, future } = store.state
    const previous = past.at(-1)
    if (!previous || disposed) return
    store.setState((state) => ({ ...state, document: previous, past: past.slice(0, -1), future: [document, ...future].slice(0, HISTORY_LIMIT), coalesceKey: null }))
    schedule()
  }

  const redo = () => {
    const { past, document, future } = store.state
    const next = future[0]
    if (!next || disposed) return
    store.setState((state) => ({ ...state, document: next, past: [...past, document].slice(-HISTORY_LIMIT), future: future.slice(1), coalesceKey: null }))
    schedule()
  }

  const onSavedDraft = async <T,>(request: (version: string) => Promise<T>): Promise<T> => {
    await save()
    try {
      return await request(store.state.version)
    } catch (error) {
      if (isDraftChanged(error) && !disposed) {
        cancelTimer()
        conflictError = error
        store.setState((state) => ({ ...state, conflict: true }))
      }
      throw error
    }
  }

  const reload = async () => {
    cancelTimer()
    const fresh = await client.getTool(slug)
    conflictError = null
    store.setState((state) => loadedState(fresh, state))
    onSaved?.(fresh)
  }

  const sync = (next: Tool) => {
    const state = store.state
    if (next === state.tool) return
    // A refetch that started before our last save answers with the copy that save replaced: a different
    // version, but not newer. Only a server copy written after ours (or any, before we ever saved) is adopted.
    const newer = state.savedAt === null || Date.parse(next.draftUpdatedAt) > Date.parse(state.tool.draftUpdatedAt)
    const adoptDocument = next.draftVersion !== state.version && next.draft !== null && newer && !isDirty(state) && !state.saving && !state.conflict
    if (adoptDocument) {
      store.setState((current) => loadedState(next, current))
      return
    }
    // Same or older server copy, or local work pending: keep our document, version and its time; take name/live/releases.
    store.setState((current) => ({
      ...current,
      tool: { ...next, draft: current.tool.draft, draftVersion: current.tool.draftVersion, draftUpdatedAt: current.tool.draftUpdatedAt },
    }))
  }

  const dispose = () => {
    disposed = true
    cancelTimer()
  }

  return { store, update, undo, redo, save, onSavedDraft, reload, sync, dispose }
}

const stores = new Map<string, DraftStore>()

const apiClient: DraftClient = {
  saveDraft: (slug, document, draftVersion) => api.tools.saveDraft(slug, document, draftVersion),
  getTool: (slug) => api.tools.get(slug),
}

const problemCache = new WeakMap<Document, Problem[]>()

/** Validation is pure in the document, so one result per document value serves every consumer. */
export function problemsOf(document: Document): Problem[] {
  let problems = problemCache.get(document)
  if (!problems) {
    problems = validateDocument(document)
    problemCache.set(document, problems)
  }
  return problems
}

export type Draft = {
  tool: Tool
  document: Document
  version: string
  dirty: boolean
  saving: boolean
  savedAt: number | null
  conflict: boolean
  saveError: unknown
  canUndo: boolean
  canRedo: boolean
  problems: Problem[]
  update(fn: (doc: Document) => Document, options?: UpdateOptions): void
  save(): Promise<void>
  onSavedDraft<T>(request: (version: string) => Promise<T>): Promise<T>
  undo(): void
  redo(): void
  reload(): Promise<void>
}

/**
 * The editor's draft of `slug`. Suspends until the tool is loaded (the editor
 * shell loads it first, so pages under it render at once). Only for callers
 * with `edit` access: the server sends `draft` to editors only.
 */
export function useDraft(slug: string): Draft {
  const queryClient = useQueryClient()
  const { data: tool } = useSuspenseQuery(toolQuery(slug))
  let draft = stores.get(slug)
  if (!draft) {
    draft = createDraftStore({
      slug,
      tool,
      client: apiClient,
      isDraftChanged: (error) => isApiError(error, 'draft_changed'),
      onSaved: (saved) => queryClient.setQueryData(toolQuery(slug).queryKey, saved),
    })
    stores.set(slug, draft)
  }
  const handle = draft
  useEffect(() => handle.sync(tool), [handle, tool])
  const state = useSelector(handle.store, (value) => value)
  return useMemo(
    () => ({
      tool: state.tool,
      document: state.document,
      version: state.version,
      dirty: isDirty(state),
      saving: state.saving,
      savedAt: state.savedAt,
      conflict: state.conflict,
      saveError: state.saveError,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      problems: problemsOf(state.document),
      update: handle.update,
      save: handle.save,
      onSavedDraft: handle.onSavedDraft,
      undo: handle.undo,
      redo: handle.redo,
      reload: handle.reload,
    }),
    [state, handle]
  )
}
