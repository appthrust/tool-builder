// CodeMirror 6 SQL editor for draft queries: PostgreSQL highlighting on a dark
// surface, `{{ name }}` placeholders marked, and an imperative `insert` for
// the "Insert placeholder" action and the schema browser. Colours come from
// Tailwind classes (HighlightStyle `class`, wrapper classes) so the editor
// follows the design tokens instead of hardcoded theme colours.
// Tab is left to focus navigation (no indentWithTab) so the editor never
// traps keyboard users.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { bracketMatching, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { PLACEHOLDER } from '../../../model/document'
import { cn } from '../../../ui'

export type SqlEditorHandle = {
  /** Replaces the selection with `text` and focuses the editor. */
  insert(text: string): void
}

const highlight = HighlightStyle.define([
  { tag: tags.keyword, class: 'text-sky-300 font-medium' },
  { tag: [tags.operatorKeyword, tags.operator], class: 'text-sky-200' },
  { tag: [tags.string, tags.special(tags.string)], class: 'text-amber-200' },
  { tag: [tags.number, tags.bool, tags.null], class: 'text-violet-300' },
  { tag: [tags.lineComment, tags.blockComment, tags.comment], class: 'text-stone-500 italic' },
  { tag: [tags.typeName, tags.standard(tags.name)], class: 'text-teal-200' },
  { tag: [tags.punctuation, tags.paren, tags.bracket], class: 'text-stone-400' },
])

const placeholderMarks = new MatchDecorator({
  regexp: new RegExp(PLACEHOLDER.source, 'g'),
  decoration: Decoration.mark({ class: 'rounded-sm bg-accent/35 px-px text-teal-50 ring-1 ring-accent/70' }),
})

const placeholderPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = placeholderMarks.createDeco(view)
    }
    update(update: ViewUpdate) {
      this.decorations = placeholderMarks.updateDeco(update, this.decorations)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const theme = EditorView.theme(
  {
    '&': { color: 'inherit', backgroundColor: 'transparent', fontSize: '13px', height: '100%' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
    '.cm-content': { caretColor: 'currentColor', padding: '12px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'currentColor' },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'inherit', border: 'none', opacity: '0.45' },
    '.cm-activeLine': { backgroundColor: 'rgb(255 255 255 / 0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', opacity: '1' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgb(255 255 255 / 0.16)',
    },
    '.cm-matchingBracket': { backgroundColor: 'rgb(255 255 255 / 0.12)', outline: 'none' },
  },
  { dark: true },
)

export function SqlEditor({
  value,
  onChange,
  onRun,
  label,
  invalid,
  className,
  ref,
}: {
  value: string
  onChange: (value: string) => void
  /** Mod-Enter (Ctrl/Cmd+Enter) inside the editor. */
  onRun?: () => void
  /** Accessible name of the text area. */
  label: string
  invalid?: boolean
  className?: string
  ref?: Ref<SqlEditorHandle>
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef({ onChange, onRun })
  useEffect(() => {
    latest.current = { onChange, onRun }
  }, [onChange, onRun])

  // One view per mount; the document follows `value` in the effect below and
  // the label is fixed for the lifetime of the editor (the page keys it by query id).
  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                latest.current.onRun?.()
                return true
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          sql({ dialect: PostgreSQL }),
          syntaxHighlighting(highlight),
          placeholderPlugin,
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = created
    return () => {
      created.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External changes (undo from another screen, a reload) replace the text.
  useEffect(() => {
    const current = view.current
    if (!current) return
    const text = current.state.doc.toString()
    if (text !== value) current.dispatch({ changes: { from: 0, to: text.length, insert: value } })
  }, [value])

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const current = view.current
      if (!current) return
      current.dispatch(current.state.replaceSelection(text))
      current.focus()
    },
  }))

  return (
    <div
      ref={host}
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-48 overflow-hidden rounded-lg bg-stone-950 font-mono text-stone-100 ring-1 ring-stone-800 focus-within:ring-2 focus-within:ring-accent',
        invalid ? 'ring-bad' : undefined,
        className,
      )}
    />
  )
}
