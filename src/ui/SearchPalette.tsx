import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { lookup, search } from '../model/search'
import { type Id, type Kind, KIND_LABELS } from '../model/types'
import { commands, matchCommands } from './commands'
import { useUi } from './uiContext'
import { useEditor } from './useEditor'

type Filter = { label: string; kinds?: (Kind | 'connector')[] }

const FILTERS: Filter[] = [
  { label: 'All' },
  { label: 'Notes', kinds: ['sticky', 'text'] },
  { label: 'Mind maps', kinds: ['mind'] },
  { label: 'Flowcharts', kinds: ['flow', 'connector'] },
  { label: 'Tables', kinds: ['table'] },
  { label: 'Kanban', kinds: ['kanban'] },
  { label: 'Timelines', kinds: ['timeline'] },
  { label: 'Comments', kinds: ['comment'] },
  { label: 'Shapes', kinds: ['rect', 'ellipse'] },
  { label: 'Frames', kinds: ['frame'] },
  { label: 'Images', kinds: ['image'] },
]

/** Wraps each query word found in `text` in <mark>. */
function highlight(text: string, query: string): ReactNode {
  const words = query.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!words.length) return text
  const re = new RegExp(`(${words.join('|')})`, 'gi')
  return text.split(re).map((part, k) => (k % 2 ? <mark key={k}>{part}</mark> : part))
}

interface Row {
  key: string
  /** The object to go to, or a command to run. */
  id?: Id
  run?: () => void
  title: string
  kind: string
  detail?: ReactNode
  keys?: string
}

/** Ctrl+K: search everything on the board, or browse every object when the query is empty. */
export function SearchPalette() {
  const editor = useEditor()
  const ui = useUi()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState(0)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  // Focus before the browser paints, so the first key typed after Ctrl+K lands in the box.
  useLayoutEffect(() => {
    if (editor.searchOpen) {
      setActive(0)
      input.current?.select()
    }
  }, [editor.searchOpen])

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!editor.searchOpen) return null
  const kinds = FILTERS[filter].kinds ? new Set(FILTERS[filter].kinds) : undefined
  const commandOnly = query.trimStart().startsWith('>')
  const cmds: Row[] =
    filter === 0 && query.trim()
      ? matchCommands(commands(editor, ui), query)
          .slice(0, commandOnly ? 40 : 5)
          .map((c) => ({ key: `cmd:${c.id}`, run: c.run, title: c.label, kind: c.group, keys: c.keys }))
      : []
  const objects: Row[] = commandOnly
    ? []
    : query.trim()
    ? search(editor.board, query, kinds).map((r, k) => ({
        key: `${k}`,
        id: r.id,
        title: r.title,
        kind: r.kind === 'connector' ? 'Line' : KIND_LABELS[r.kind],
        detail: (
          <>
            <span className="where">{r.where}</span> {highlight(r.snippet, query)}
          </>
        ),
      }))
    : lookup(editor.board, kinds).map((e) => ({
        key: `${e.id}`,
        id: e.id,
        title: e.title,
        kind: KIND_LABELS[e.kind],
        detail: e.notes ? <span className="where">{e.notes} comment{e.notes === 1 ? '' : 's'}</span> : undefined,
      }))
  const rows = [...cmds, ...objects]

  const close = () => editor.setSearchOpen(false)
  const go = (row: Row | undefined) => {
    if (!row) return
    close()
    if (row.run) row.run()
    else if (row.id !== undefined) editor.focusObject(row.id)
  }

  return (
    <div className="palette-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Search the board">
        <input
          ref={input}
          autoFocus
          value={query}
          placeholder="Search the board, or run a command (type > for commands only)"
          aria-label="Search"
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, rows.length - 1))
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
            else if (e.key === 'Enter') go(rows[active])
            else if (e.key === 'Tab') setFilter((f) => (f + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length)
            else return
            e.preventDefault()
          }}
        />
        <div className="filters" role="tablist">
          {FILTERS.map((f, k) => (
            <button
              key={f.label}
              role="tab"
              aria-selected={k === filter}
              className={k === filter ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setFilter(k)
                setActive(0)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="palette-caption muted">
          {commandOnly ? 'Commands' : query.trim() ? `${objects.length} match${objects.length === 1 ? '' : 'es'}${cmds.length ? ` · ${cmds.length} command${cmds.length === 1 ? '' : 's'}` : ''}` : `All objects (${rows.length}) · type > for commands`}
          <span>↑↓ choose · Enter go · Tab filter · Esc close</span>
        </div>
        <ul ref={list} className="results" role="listbox">
          {rows.map((r, k) => (
            <li key={r.key}>
              <button
                role="option"
                aria-selected={k === active}
                className={k === active ? 'active' : ''}
                onMouseEnter={() => setActive(k)}
                onClick={() => go(r)}
              >
                <span className={`kind${r.run ? ' command' : ''}`}>{r.kind}</span>
                <span className="result-title">
                  <span className="title-text">{query.trim() ? highlight(r.title, query.replace(/^\s*>/, '')) : r.title}</span>
                  {r.keys && <kbd>{r.keys}</kbd>}
                </span>
                {r.detail && <span className="detail">{r.detail}</span>}
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="empty muted">Nothing found.</li>}
        </ul>
      </div>
    </div>
  )
}
