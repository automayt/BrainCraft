import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { lookup, search } from '../model/search'
import { type Board, type Id, type Kind, KIND_LABELS } from '../model/types'
import { commands, matchCommands } from './commands'
import { useUi } from './uiContext'
import { useEditor } from './useEditor'
import { useWorkspace } from './useWorkspace'
import { isWiki, pageOrder, pagePath, searchPages } from '../model/wiki'

type Filter = { label: string; kinds?: (Kind | 'connector')[] }

/** Other wikis searched alongside the open board, and the matches shown from each. */
const OTHER_WIKIS = 10
const PER_WIKI = 4

const FILTERS: Filter[] = [
  { label: 'All' },
  { label: 'Sticky notes & text', kinds: ['sticky', 'text'] },
  { label: 'Mind maps', kinds: ['mind'] },
  { label: 'Flowcharts', kinds: ['flow', 'connector'] },
  { label: 'Tables', kinds: ['table'] },
  { label: 'Kanban', kinds: ['kanban'] },
  { label: 'Timelines', kinds: ['timeline'] },
  { label: 'Sequence diagrams', kinds: ['sequence'] },
  { label: 'Databases', kinds: ['data'] },
  { label: 'Comment blocks', kinds: ['comment'] },
  { label: 'Shapes', kinds: ['rect', 'ellipse'] },
  { label: 'Frames', kinds: ['frame'] },
  { label: 'Images', kinds: ['image'] },
  { label: 'Links', kinds: ['link'] },
  { label: 'Code', kinds: ['code'] },
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
  const ws = useWorkspace()

  // The other wikis in this browser, read once each time the search opens, so their pages turn
  // up too ("where did we write down the van booking?").
  const [wikis, setWikis] = useState<{ key: string; title: string; icon?: string; board: Board }[]>([])
  useEffect(() => {
    if (!editor.searchOpen) return
    let live = true
    const others = ws.otherBoards.filter((b) => b.kind === 'wiki').slice(0, OTHER_WIKIS)
    void Promise.all(others.map(async (b) => ({ key: b.key, title: b.title, icon: b.icon, board: await ws.readBoard(b.key) }))).then(
      (l) => live && setWikis(l.flatMap((w) => (w.board ? [{ ...w, board: w.board }] : []))),
      () => {},
    )
    return () => {
      live = false
    }
  }, [editor.searchOpen, ws])

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
  // Only the filters for what's on this board (and the one picked).
  const present = new Set<Kind | 'connector'>(editor.board.items.map((i) => i.kind))
  if (editor.board.connectors.length) present.add('connector')
  const shown = FILTERS.flatMap((f, k) => (!f.kinds || k === filter || f.kinds.some((x) => present.has(x)) ? [k] : []))
  const commandOnly = query.trimStart().startsWith('>')
  const cmds: Row[] =
    filter === 0 && query.trim()
      ? matchCommands(commands(editor, ui), query)
          .slice(0, commandOnly ? 40 : 5)
          .map((c) => ({ key: `cmd:${c.id}`, run: c.run, title: c.label, kind: c.group, keys: c.keys }))
      : []
  const wiki = isWiki(editor.board)
  // In a wiki, the search is over its pages.
  const pages: Row[] =
    !wiki || commandOnly
      ? []
      : query.trim()
        ? searchPages(editor.board, query).map((h) => ({
            key: `p:${h.page.id}`,
            run: () => editor.openPage(h.page.id),
            title: `${h.page.icon ? `${h.page.icon} ` : ''}${h.page.title || 'Untitled'}`,
            kind: 'Page',
            detail: h.snippet ? <span>{highlight(h.snippet, query)}</span> : undefined,
          }))
        : pageOrder(editor.board).map((p) => ({
            key: `p:${p.id}`,
            run: () => editor.openPage(p.id),
            title: `${p.icon ? `${p.icon} ` : ''}${p.title || 'Untitled'}`,
            kind: 'Page',
            detail: <span className="where">{pagePath(editor.board, p.id).slice(0, -1).map((x) => x.title).join(' › ')}</span>,
          }))
  const objects: Row[] = commandOnly || wiki
    ? []
    : query.trim()
    ? search(editor.viewBoard, query, kinds).map((r, k) => ({
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
    : lookup(editor.viewBoard, kinds).map((e) => ({
        key: `${e.id}`,
        id: e.id,
        title: e.title,
        kind: KIND_LABELS[e.kind],
        detail: e.notes ? <span className="where">{e.notes} comment{e.notes === 1 ? '' : 's'}</span> : undefined,
      }))
  const elsewhere: Row[] =
    commandOnly || filter !== 0 || !query.trim()
      ? []
      : wikis.flatMap((w) =>
          searchPages(w.board, query, PER_WIKI).map((h) => ({
            key: `w:${w.key}:${h.page.id}`,
            run: () => void ws.openLink({ board: w.key, page: h.page.id }),
            title: `${h.page.icon ? `${h.page.icon} ` : ''}${h.page.title || 'Untitled'}`,
            kind: `${w.icon ?? '📘'} ${w.title || 'Wiki'}`,
            detail: h.snippet ? <span>{highlight(h.snippet, query)}</span> : undefined,
          })),
        )
  const rows = [...cmds, ...pages, ...objects, ...elsewhere]

  const close = () => editor.setSearchOpen(false)
  const go = (row: Row | undefined) => {
    if (!row) return
    close()
    if (row.run) row.run()
    else if (row.id !== undefined) editor.focusObject(row.id)
  }

  return (
    <div className="palette-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label={wiki ? 'Search the wiki' : 'Search the board'}>
        <input
          ref={input}
          autoFocus
          value={query}
          placeholder={wiki ? 'Search pages (here and in your other wikis), or type > for commands' : 'Search the board, or run a command (type > for commands only)'}
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
            else if (e.key === 'Tab') setFilter((f) => shown[(shown.indexOf(f) + (e.shiftKey ? shown.length - 1 : 1)) % shown.length])
            else return
            e.preventDefault()
          }}
        />
        <div className="filters" role="tablist">
          {shown.map((k) => (
            <button
              key={FILTERS[k].label}
              role="tab"
              aria-selected={k === filter}
              className={k === filter ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setFilter(k)
                setActive(0)
              }}
            >
              {FILTERS[k].label}
            </button>
          ))}
        </div>
        <div className="palette-caption muted">
          {commandOnly
            ? 'Commands'
            : query.trim()
              ? `${objects.length + pages.length + elsewhere.length} match${objects.length + pages.length + elsewhere.length === 1 ? '' : 'es'}${elsewhere.length ? ` (${elsewhere.length} in other wikis)` : ''}${cmds.length ? ` · ${cmds.length} command${cmds.length === 1 ? '' : 's'}` : ''}`
              : `All ${wiki ? 'pages' : 'objects'} (${rows.length}) · type > for commands`}
          <span>↑↓ choose · Enter go · Tab filter · Esc close</span>
        </div>
        <ul ref={list} className="results" role="listbox">
          {rows.map((r, k) => (
            <li key={r.key} className={elsewhere.length && r === elsewhere[0] ? 'results-break' : undefined}>
              {elsewhere.length > 0 && r === elsewhere[0] && <div className="results-heading">In your other wikis</div>}
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
