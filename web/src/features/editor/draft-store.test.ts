import { describe, expect, test } from 'bun:test'
import type { Tool } from '../../api/types'
import type { Component, Document } from '../../model/document'
import { AUTOSAVE_DELAY_MS, createDraftStore, HISTORY_LIMIT, isDirty, problemsOf, type DraftClient, type Timers } from './draft-store'

const text = (id: string, value: string): Component => ({ id, type: 'text', layout: { x: 0, y: 0, w: 4, h: 1 }, props: { value: { kind: 'value', value } } })

const doc = (components: Component[] = []): Document => ({ schemaVersion: 1, pages: [{ id: 'main', title: 'Orders', components }], queries: [] })

const tool = (draft: Document, draftVersion: string, name = 'Order desk'): Tool => ({
  id: 'tool-1',
  slug: 'order-desk',
  name,
  description: '',
  liveReleaseNumber: null,
  draftUpdatedAt: '2026-10-14T00:00:00Z',
  access: { use: true, edit: true },
  createdAt: '2026-10-14T00:00:00Z',
  archivedAt: null,
  draft,
  draftVersion,
  live: null,
})

/** One pending timer at a time, like the debounced autosave; `fire` runs it. */
function manualTimers() {
  const scheduled: { callback: () => void; ms: number }[] = []
  const timers: Timers = {
    set: (callback, ms) => {
      const entry = { callback, ms }
      scheduled.push(entry)
      return () => {
        const index = scheduled.indexOf(entry)
        if (index >= 0) scheduled.splice(index, 1)
      }
    },
  }
  return {
    timers,
    pending: () => scheduled.length,
    delays: () => scheduled.map((entry) => entry.ms),
    fire: () => scheduled.splice(0).forEach((entry) => entry.callback()),
  }
}

type SaveCall = { slug: string; document: Document; draftVersion: string; resolve: (tool: Tool) => void; reject: (error: unknown) => void }

function fakeClient(server: { tool: Tool }) {
  const saves: SaveCall[] = []
  const client: DraftClient = {
    saveDraft: (slug, document, draftVersion) => {
      const { promise, resolve, reject } = Promise.withResolvers<Tool>()
      saves.push({ slug, document, draftVersion, resolve, reject })
      return promise
    },
    getTool: async () => server.tool,
  }
  return { client, saves }
}

const conflict = { error: 'draft_changed', message: 'The draft changed', details: { draftVersion: 'v9' } }
const isDraftChanged = (error: unknown) => typeof error === 'object' && error !== null && 'error' in error && error.error === 'draft_changed'

function setup(initial = doc([text('title', 'Orders')])) {
  const server = { tool: tool(initial, 'v1') }
  const { client, saves } = fakeClient(server)
  const clock = manualTimers()
  const saved: Tool[] = []
  const draft = createDraftStore({ slug: 'order-desk', tool: server.tool, client, isDraftChanged, onSaved: (t) => saved.push(t), timers: clock.timers, now: () => 42 })
  return { server, draft, saves, clock, saved }
}

const rename = (value: string) => (document: Document): Document => ({
  ...document,
  pages: document.pages.map((page) => ({ ...page, components: page.components.map((c) => (c.id === 'title' ? { ...c, props: { value: { kind: 'value', value } } } : c)) })),
})

/** Drains the save chain's microtasks (then → finally → follow-up save); no wall-clock wait. */
async function flushPromises() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('draft store', () => {
  test('an edit applies locally at once and autosaves the whole document 1 s later with If-Match', async () => {
    const { draft, saves, clock, saved } = setup()
    draft.update(rename('Refunds'))
    expect(isDirty(draft.store.state)).toBe(true)
    expect(draft.store.state.document.pages[0]?.components[0]?.props.value).toEqual({ kind: 'value', value: 'Refunds' })
    expect(saves).toHaveLength(0)
    expect(clock.delays()).toEqual([AUTOSAVE_DELAY_MS])

    clock.fire()
    expect(draft.store.state.saving).toBe(true)
    expect(saves).toHaveLength(1)
    expect(saves[0]?.draftVersion).toBe('v1')
    expect(saves[0]?.document).toBe(draft.store.state.document)

    saves[0]?.resolve(tool(saves[0].document, 'v2'))
    await flushPromises()
    expect(draft.store.state.saving).toBe(false)
    expect(draft.store.state.version).toBe('v2')
    expect(draft.store.state.savedAt).toBe(42)
    expect(isDirty(draft.store.state)).toBe(false)
    expect(saved.map((t) => t.draftVersion)).toEqual(['v2'])
  })

  test('edits within the delay restart it and save once with the latest document', () => {
    const { draft, saves, clock } = setup()
    draft.update(rename('R'))
    draft.update(rename('Re'))
    draft.update(rename('Ref'))
    expect(clock.pending()).toBe(1)
    clock.fire()
    expect(saves).toHaveLength(1)
    expect(saves[0]?.document.pages[0]?.components[0]?.props.value).toEqual({ kind: 'value', value: 'Ref' })
  })

  test('an update returning the same document is not an edit', () => {
    const { draft, clock } = setup()
    draft.update((document) => document)
    expect(isDirty(draft.store.state)).toBe(false)
    expect(draft.store.state.past).toHaveLength(0)
    expect(clock.pending()).toBe(0)
  })

  test('an edit during a save is saved next, against the version the first save returned', async () => {
    const { draft, saves, clock } = setup()
    draft.update(rename('A'))
    clock.fire()
    draft.update(rename('B'))
    clock.fire() // timer fires while the first save is in flight: queued, not sent
    expect(saves).toHaveLength(1)

    saves[0]?.resolve(tool(saves[0].document, 'v2'))
    await flushPromises()
    expect(saves).toHaveLength(2)
    expect(saves[1]?.draftVersion).toBe('v2')
    expect(saves[1]?.document.pages[0]?.components[0]?.props.value).toEqual({ kind: 'value', value: 'B' })
    expect(isDirty(draft.store.state)).toBe(true)

    saves[1]?.resolve(tool(saves[1].document, 'v3'))
    await flushPromises()
    expect(isDirty(draft.store.state)).toBe(false)
    expect(draft.store.state.version).toBe('v3')
  })

  test('409 draft_changed stops autosave until reload, which takes the server copy', async () => {
    const { server, draft, saves, clock, saved } = setup()
    draft.update(rename('Mine'))
    clock.fire()
    saves[0]?.reject(conflict)
    await flushPromises()
    expect(draft.store.state.conflict).toBe(true)
    expect(draft.store.state.saveError).toBeNull()

    draft.update(rename('Mine again'))
    expect(clock.pending()).toBe(0)
    // A caller that needs the server copy current (Run, Publish) is told why it is not.
    await expect(draft.save()).rejects.toBe(conflict)
    expect(saves).toHaveLength(1)

    const theirs = doc([text('title', 'Theirs')])
    server.tool = tool(theirs, 'v9', 'Renamed elsewhere')
    await draft.reload()
    expect(draft.store.state.conflict).toBe(false)
    expect(draft.store.state.document).toBe(theirs)
    expect(draft.store.state.version).toBe('v9')
    expect(draft.store.state.tool.name).toBe('Renamed elsewhere')
    expect(draft.store.state.past).toHaveLength(0)
    expect(isDirty(draft.store.state)).toBe(false)
    expect(saved.at(-1)?.draftVersion).toBe('v9')

    draft.update(rename('After reload'))
    expect(clock.pending()).toBe(1)
  })

  test('another failure keeps the edit dirty and is retried by save()', async () => {
    const { draft, saves, clock } = setup()
    draft.update(rename('X'))
    clock.fire()
    const failure = new Error('network')
    saves[0]?.reject(failure)
    await flushPromises()
    expect(draft.store.state.saveError).toBe(failure)
    expect(draft.store.state.conflict).toBe(false)
    expect(isDirty(draft.store.state)).toBe(true)

    const retry = draft.save()
    expect(saves).toHaveLength(2)
    expect(saves[1]?.draftVersion).toBe('v1')
    saves[1]?.resolve(tool(saves[1].document, 'v2'))
    await retry
    expect(draft.store.state.saveError).toBeNull()
    expect(isDirty(draft.store.state)).toBe(false)
  })

  test('a caller awaiting save() gets the failure of the save it waited for', async () => {
    const { draft, saves, clock } = setup()
    draft.update(rename('A'))
    clock.fire()
    draft.update(rename('B'))
    const waiting = draft.save() // joins the running save, then saves B
    const failure = new Error('network')
    saves[0]?.reject(failure)
    await expect(waiting).rejects.toBe(failure)
    expect(saves).toHaveLength(1)

    const clean = setup()
    clean.draft.update(rename('C'))
    const direct = clean.draft.save()
    clean.saves[0]?.reject(conflict)
    await expect(direct).rejects.toBe(conflict)
    expect(clean.draft.store.state.conflict).toBe(true)
  })

  test('undo and redo walk the history and autosave the result', () => {
    const { draft, clock } = setup()
    const original = draft.store.state.document
    draft.update(rename('one'))
    const one = draft.store.state.document
    draft.update(rename('two'))
    draft.undo()
    expect(draft.store.state.document).toBe(one)
    draft.undo()
    expect(draft.store.state.document).toBe(original)
    expect(isDirty(draft.store.state)).toBe(false)
    draft.undo() // nothing left
    expect(draft.store.state.document).toBe(original)
    draft.redo()
    expect(draft.store.state.document).toBe(one)
    expect(clock.pending()).toBe(1)

    draft.update(rename('branch'))
    expect(draft.store.state.future).toHaveLength(0)
  })

  test(`history keeps the last ${HISTORY_LIMIT} steps`, () => {
    const { draft } = setup()
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) draft.update(rename(`v${i}`))
    expect(draft.store.state.past).toHaveLength(HISTORY_LIMIT)
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) draft.undo()
    expect(draft.store.state.document.pages[0]?.components[0]?.props.value).toEqual({ kind: 'value', value: 'v9' })
  })

  test('consecutive edits with one coalesce key are one undo step', () => {
    const { draft } = setup()
    const original = draft.store.state.document
    draft.update(rename('a'), { coalesce: 'title.value' })
    draft.update(rename('ab'), { coalesce: 'title.value' })
    draft.update(rename('abc'), { coalesce: 'title.value' })
    expect(draft.store.state.past).toHaveLength(1)
    draft.update(rename('other'), { coalesce: 'other.field' })
    expect(draft.store.state.past).toHaveLength(2)
    draft.undo()
    draft.undo()
    expect(draft.store.state.document).toBe(original)
  })

  test('a newer server copy is adopted only when nothing local is pending', () => {
    const { draft } = setup()
    const theirs = doc([text('title', 'Theirs')])
    draft.sync(tool(theirs, 'v5', 'Renamed'))
    expect(draft.store.state.document).toBe(theirs)
    expect(draft.store.state.version).toBe('v5')

    draft.update(rename('Local'))
    const local = draft.store.state.document
    draft.sync({ ...tool(doc(), 'v6', 'Renamed again'), live: { releaseNumber: 3, document: theirs }, liveReleaseNumber: 3 })
    expect(draft.store.state.document).toBe(local)
    expect(draft.store.state.version).toBe('v5')
    expect(draft.store.state.tool.name).toBe('Renamed again')
    expect(draft.store.state.tool.liveReleaseNumber).toBe(3)
  })

  test('after a save, a refetch older than that save is ignored and a newer one is adopted', async () => {
    const { draft, saves, clock } = setup()
    const before = draft.store.state.document
    draft.update(rename('Saved'))
    clock.fire()
    saves[0]?.resolve({ ...tool(saves[0].document, 'v2'), draftUpdatedAt: '2026-10-14T00:00:05Z' })
    await flushPromises()
    const mine = draft.store.state.document

    // Started before the save: the copy the save replaced.
    draft.sync({ ...tool(before, 'v1', 'Renamed'), draftUpdatedAt: '2026-10-14T00:00:00Z' })
    expect(draft.store.state.document).toBe(mine)
    expect(draft.store.state.version).toBe('v2')
    expect(draft.store.state.tool.name).toBe('Renamed')
    expect(draft.store.state.tool.draftUpdatedAt).toBe('2026-10-14T00:00:05Z')

    const theirs = doc([text('title', 'Theirs')])
    draft.sync({ ...tool(theirs, 'v3'), draftUpdatedAt: '2026-10-14T00:00:09Z' })
    expect(draft.store.state.document).toBe(theirs)
    expect(draft.store.state.version).toBe('v3')
  })

  test('onSavedDraft saves first, passes the saved version, and a 409 from the request is a conflict', async () => {
    const { draft, saves, clock } = setup()
    draft.update(rename('Publish me'))
    const versions: string[] = []
    const published = draft.onSavedDraft(async (version) => {
      versions.push(version)
      throw conflict
    })
    expect(clock.pending()).toBe(0)
    saves[0]?.resolve(tool(saves[0].document, 'v2'))
    await expect(published).rejects.toBe(conflict)
    expect(versions).toEqual(['v2'])
    expect(draft.store.state.conflict).toBe(true)
    await expect(draft.save()).rejects.toBe(conflict)
  })

  test('problems come from the document schema and are cached per document', () => {
    const valid = doc([text('title', 'Orders')])
    expect(problemsOf(valid)).toEqual([])
    expect(problemsOf(valid)).toBe(problemsOf(valid))
    const dangling = doc([{ ...text('title', ''), props: { value: { kind: 'ref', ref: { component: 'missing', prop: 'value' } } } }])
    const problems = problemsOf(dangling)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.some((problem) => problem.path.startsWith('pages.0.components.0.props.value'))).toBe(true)
  })
})
