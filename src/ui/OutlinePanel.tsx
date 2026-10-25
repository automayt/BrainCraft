/**
 * A mind map as an outline beside the board, kept in step both ways: type in the outline and the
 * map changes (a moment after you stop), change the map and the outline follows. Enter starts a
 * line at the same depth, Tab and Shift Tab move lines in and out, and cutting a block and pasting
 * it elsewhere moves that branch. Copies or downloads as simple Markdown.
 */

import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { getItem } from '../model/board'
import { markdownOf, outlineOf } from '../model/outlineSync'
import { download } from './imageExport'
import { useEditor } from './useEditor'

/** How long typing pauses before the map catches up. */
const SETTLE_MS = 350

/** The lines a selection touches, as [first line start, last line end]. */
function lineSpan(text: string, from: number, to: number): [number, number] {
  const start = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  const endAt = text.indexOf('\n', to > from && text[to - 1] === '\n' ? to - 1 : to)
  return [start, endAt < 0 ? text.length : endAt]
}

export function OutlinePanel() {
  const editor = useEditor()
  const rootId = editor.outlineOf
  const root = rootId === null ? undefined : getItem(editor.board, rootId)
  const current = root ? outlineOf(editor.board, root.id) : ''
  const [text, setText] = useState(current)
  const area = useRef<HTMLTextAreaElement>(null)
  /** The map's outline after our own last change: while it still matches, what's typed stands. */
  const ours = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // The map changed elsewhere (on the canvas, or by someone else): the outline follows.
  useEffect(() => {
    if (current === ours.current) return
    if (timer.current && document.activeElement === area.current) return
    ours.current = null
    setText(current)
  }, [current])

  // Another map, or none.
  useEffect(() => {
    ours.current = null
    setText(current)
    // Only when the map changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId])

  // Typing goes to the map once it settles; leaving the panel sends what's left at once.
  const commit = (value: string) => {
    clearTimeout(timer.current)
    timer.current = undefined
    if (rootId === null) return
    editor.setOutline(rootId, value)
    ours.current = outlineOf(editor.board, rootId)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!root) {
    // The map was deleted (or another board opened): nothing to show.
    if (rootId !== null) queueMicrotask(() => editor.openOutline(null))
    return null
  }

  const change = (value: string, caret?: [number, number]) => {
    setText(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(value), SETTLE_MS)
    if (caret)
      requestAnimationFrame(() => {
        area.current?.setSelectionRange(caret[0], caret[1])
      })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Typing stays here; Ctrl shortcuts (undo aside) still reach the app.
    if (!(e.ctrlKey || e.metaKey)) e.stopPropagation()
    const el = e.currentTarget
    const { selectionStart: from, selectionEnd: to, value } = el
    if (e.key === 'Tab') {
      e.preventDefault()
      const [start, end] = lineSpan(value, from, to)
      const lines = value.slice(start, end).split('\n')
      const moved = lines.map((l, k) => {
        // The central idea stays where it is.
        if (start === 0 && k === 0) return l
        return e.shiftKey ? l.replace(/^ {1,2}/, '') : `  ${l}`
      })
      const block = moved.join('\n')
      const shift = moved[0].length - lines[0].length
      change(value.slice(0, start) + block + value.slice(end), [Math.max(start, from + shift), to + (block.length - (end - start))])
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const [start] = lineSpan(value, from, from)
      const indent = /^ */.exec(value.slice(start))![0]
      // A new line under the central idea is one of its ideas.
      const lead = start === 0 ? '  ' : indent
      const insert = `\n${lead}`
      change(value.slice(0, from) + insert + value.slice(to), [from + insert.length, from + insert.length])
    } else if (e.key === 'Escape') {
      commit(el.value)
      editor.openOutline(null)
    }
  }

  const name = (root.text || 'Mind map').replace(/\s+/g, ' ').trim()
  const markdown = () => markdownOf(editor.board, root.id)
  return (
    <aside className="notes-panel outline-panel no-canvas" aria-label="Outline" onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <div>
          <h2>Outline</h2>
          <button className="panel-target" onClick={() => editor.focusObject(root.id)} title="Go to this mind map">
            Mind map · {name}
          </button>
        </div>
        <button className="icon-close" aria-label="Close the outline" title="Close (Esc)" onClick={() => editor.openOutline(null)}>
          ×
        </button>
      </header>
      <textarea
        ref={area}
        className="outline-text"
        aria-label={`Outline of the mind map ${name}`}
        spellCheck
        value={text}
        readOnly={editor.readOnly}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKey}
        onBlur={(e) => timer.current && commit(e.target.value)}
      />
      <p className="outline-help muted">One idea per line. Enter adds one, Tab moves it under the line above, Shift Tab moves it back out. Cut a block and paste it elsewhere to move a branch.</p>
      <footer className="outline-foot">
        <button
          onClick={() =>
            navigator.clipboard
              ?.writeText(markdown())
              .then(() => editor.setStatus('Copied the map as Markdown'))
              .catch(() => editor.setStatus('Clipboard unavailable'))
          }
        >
          Copy as Markdown
        </button>
        <button onClick={() => download(new Blob([markdown()], { type: 'text/markdown' }), `${name.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) || 'Mind map'}.md`)}>Download .md</button>
      </footer>
    </aside>
  )
}
