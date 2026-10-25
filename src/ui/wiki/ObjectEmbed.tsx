import { useEffect, useMemo, useRef, useState } from 'react'
import { type Op, applyOps } from '../../api/ops'
import { useDialog } from '../useDialog'
import { Editor } from '../../editor/Editor'
import * as B from '../../model/board'
import { maskFor } from '../../model/brainstorm'
import * as D from '../../model/dataset'
import { embedBoard, embedToken, getSnap, makeSnap, snapBoard, snapKey } from '../../model/embed'
import { editOps, editText, editable, embedMarkdown, kanbanTick } from '../../model/embedText'
import { type Block, parseMarkdown } from '../../model/markdown'
import { layoutAll } from '../../model/mindmap'
import { Markdown, type MarkdownActions } from './Markdown'
import { type Board, type Id, type Item, itemKindLabel } from '../../model/types'
import { BoardView, formatTime } from '../BoardView'
import { measureText } from '../measure'
import { EditorContext, useEditor } from '../useEditor'
import { useEscape } from '../useEscape'
import { useWorkspace } from '../useWorkspace'

type EmbedBlock = Extract<Block, { t: 'embed' }>
const NONE: ReadonlySet<Id> = new Set()
const PAD = 24
/** Objects a live embed draws at most. */
const LIVE_MAX = 2_000
/** How much bigger than on the board an embed may be drawn (one sticky shouldn't fill the page). */
const MAX_ZOOM = 1.25

/**
 * A canvas object (or a whole board) inside a page, drawn by the board's own renderer. It shows
 * the board as this browser has it; without the board, the copy the wiki keeps (saved when someone
 * embeds it or clicks "Update the copy", and kept fresh by whoever saved it).
 */
export function ObjectEmbed({ block, page }: { block: EmbedBlock; page?: string }) {
  const editor = useEditor()
  const ws = useWorkspace()
  const meta = ws.findBoard(block.board)
  const key = snapKey(block.board, block.item)
  const [source, setSource] = useState<Board | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let live = true
    if (!meta) setSource(null)
    else void ws.readBoard(block.board).then((b) => live && setSource(b))
    return () => {
      live = false
    }
  }, [block.board, meta?.updated, ws, meta])

  const snap = getSnap(editor.board, key)
  const livePart = useMemo(() => {
    const part = source ? embedBoard(maskFor(source, editor.me), block.item) : null
    if (!part || part.items.length <= LIVE_MAX) return part
    // A huge board drawn whole would stall the page: the first objects give the idea.
    const items = part.items.slice(0, LIVE_MAX)
    const kept = new Set(items.map((i) => i.id))
    return { ...part, items, connectors: part.connectors.filter((c) => kept.has(c.from) && kept.has(c.to)) }
  }, [source, block.item, editor.me])

  // The wiki's copy follows the board, for friends who don't have it — but only by choice: just
  // reading a page never copies a board into the wiki. Whoever saved the copy keeps it fresh.
  const stale = !!source && !!meta && !editor.readOnly && !(snap && snap.at >= meta.updated)
  const saveCopy = () => {
    if (!source || !meta) return
    const s = makeSnap(source, block.board, block.item, meta.updated, editor.me)
    if (s) editor.keepSnap(s)
  }
  const mine = !!snap?.by && snap.by === editor.me
  useEffect(() => {
    if (stale && mine) saveCopy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, mine])

  const saved = useMemo(() => (snap ? snapBoard(snap) : null), [snap])
  const board = livePart ?? saved
  const target = block.item !== undefined && board ? B.getItem(board, block.item) : undefined
  const gone = !!source && block.item !== undefined && !livePart
  const label = block.label || (target ? target.text.split('\n')[0] : '') || meta?.title || 'Embedded board'
  const when = livePart ? 'live' : snap ? `saved copy, updated ${formatTime(snap.at)}` : ''
  const whenTip = livePart ? 'Drawn from the board as it is now in this browser' : 'You don’t have this board, so this is the copy the wiki keeps (whoever saved it keeps it up to date as they read this page)'
  const name = `${target ? itemKindLabel(target) : 'Board'}: ${label}${meta ? `, from ${meta.title}` : ''}`

  const open = () => void ws.openLink({ board: block.board, ...(block.item !== undefined ? { item: block.item } : {}) })

  // As text: made from the board each time it's shown, so it can't drift from it. Changing it here
  // changes the board (shown at once, then saved to the board, which tells everyone in it).
  const asText = !!block.asText
  const canChange = !!source && !!meta && meta.live?.role !== 'view' && !gone && (block.item === undefined || !!target)
  const [editing, setEditing] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const write = async (ops: Op[]) => {
    if (!source) return false
    const before = source
    try {
      // Shown straight away, as it will be on the board.
      setSource(layoutAll(applyOps(source, ops, { measure: measureText }).board, measureText))
      await ws.applyElsewhere({ board: block.board }, ops)
      setProblem(null)
      return true
    } catch (err) {
      setSource(before)
      setProblem((err as Error).message)
      return false
    }
  }
  const tick = target?.kind === 'kanban' && canChange ? (line: number) => { const ops = kanbanTick(target, line); if (ops) void write(ops) } : undefined
  const saveEdit = async () => {
    if (editing === null || !target) return
    const ops = editOps(target, editing)
    if (typeof ops === 'string') return setProblem(ops)
    if (await write(ops)) setEditing(null)
  }
  const switchTo = (text: boolean) => page && editor.setPageLine(page, block.line, embedToken(block.label || label, block.board, block.item, text), text ? 'Showed an embed as text' : 'Showed an embed as a picture')

  const view = !board ? null : asText ? (
    editing !== null ? (
      <EditAsText value={editing} kind={editable(target)} onChange={setEditing} onSave={() => void saveEdit()} onCancel={() => { setEditing(null); setProblem(null) }} />
    ) : (
      <TextView board={board} target={target} onTick={tick} />
    )
  ) : (
    <EmbedView board={board} target={target} maxHeight={block.height} name={name} />
  )

  return (
    <figure className={`embed${asText ? ' embed-as-text' : ''}`}>
      {view ?? (
        <div className="embed-missing muted">
          {meta ? (gone ? 'That object was deleted from the board.' : 'Opening…') : 'That board isn’t in this browser, and the wiki has no copy of it yet. Ask whoever added it to save a copy for friends.'}
        </div>
      )}
      <figcaption>
        <span className="embed-label">{label}</span>
        <span className="muted">
          {meta ? ` · from ${meta.title || 'a board'}` : ''}
          {when ? <span title={whenTip}>{` · ${when}`}</span> : ''}
          {gone && snap ? ' · deleted from the board since' : ''}
        </span>
        <span className="embed-actions">
          {asText && canChange && editable(target) && editing === null && livePart && (
            <button className="link" onClick={() => target && setEditing(editText(livePart, target))} title="Change it here as text; the board changes too">
              Edit as text
            </button>
          )}
          {page && !gone && editing === null && (
            <button className="link" onClick={() => switchTo(!asText)} title={asText ? 'Draw it as on the board instead' : 'Show it as text that stays in step with the board'}>
              {asText ? 'Show as picture' : 'Show as text'}
            </button>
          )}
          {meta && !gone && (
            <button className="link" onClick={open}>
              Open on board
            </button>
          )}
          {stale && !mine && (
            <button className="link" onClick={saveCopy} title="Saves what this shows into the wiki, so friends who don’t have the board see it too (comments and votes stay on the board)">
              {snap ? 'Update the copy' : 'Save a copy for friends'}
            </button>
          )}
          {view && !asText && (
            <button className="link" onClick={() => setExpanded(true)}>
              Expand
            </button>
          )}
        </span>
      </figcaption>
      {problem && <p className="embed-problem">{problem}</p>}
      {expanded && board && <EmbedExpanded label={label} name={name} board={board} target={target} onClose={() => setExpanded(false)} onOpen={meta && !gone ? open : undefined} />}
    </figure>
  )
}

/** Links and mentions inside embedded text are plain words; only checklists do anything. */
const TEXT_ACTIONS: Omit<MarkdownActions, 'toggle'> = {
  link: (_to, label, key) => <span key={key}>{label}</span>,
  mention: (_id, label, key) => <span key={key}>{label}</span>,
  children: () => null,
  headings: [],
}

/** The object as text, from the board as it is: ticking a Kanban card moves it to the last column. */
function TextView({ board, target, onTick }: { board: Board; target: Item | undefined; onTick?: (line: number) => void }) {
  const text = embedMarkdown(board, target)
  const blocks = useMemo(() => parseMarkdown(text), [text])
  if (!text.trim()) return <div className="embed-missing muted">Nothing to show yet.</div>
  return (
    <div className="embed-text md">
      <Markdown blocks={blocks} actions={{ ...TEXT_ACTIONS, toggle: onTick }} />
    </div>
  )
}

const EDIT_HELP: Record<string, string> = {
  outline: 'One idea per line; indent two spaces to put an idea under the line above.',
  columns: 'A "## Column" line for each column, its cards under it as "- " lines.',
  table: 'The first line is the column names: | Name | Status |, then a line per row.',
  lanes: 'A "## Lane" line for each lane, its entries as "- Title 2026-11-03" or "- Title 2026-11-03..2026-11-07".',
  mermaid: 'A Mermaid flowchart: A[Step] --> B{Decision?}, B -->|Yes| C[Next].',
}

/** Editing the object as text, saved to the board. */
function EditAsText({ value, kind, onChange, onSave, onCancel }: { value: string; kind: string | null; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="embed-edit">
      <textarea
        className="outline-text"
        aria-label="Edit as text"
        autoFocus
        spellCheck
        value={value}
        rows={Math.min(24, Math.max(6, value.split('\n').length + 1))}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSave()
          if (e.key === 'Tab' && kind === 'outline') {
            e.preventDefault()
            const el = e.currentTarget
            const start = el.value.lastIndexOf('\n', el.selectionStart - 1) + 1
            const line = el.value.slice(start)
            const next = e.shiftKey ? el.value.slice(0, start) + line.replace(/^ {1,2}/, '') : `${el.value.slice(0, start)}  ${line}`
            const caret = el.selectionStart + (next.length - el.value.length)
            onChange(next)
            requestAnimationFrame(() => el.setSelectionRange(caret, caret))
          }
        }}
      />
      {kind && <p className="muted embed-edit-help">{EDIT_HELP[kind]}</p>}
      <div className="embed-edit-actions">
        <button className="primary" onClick={onSave}>
          Save to the board
        </button>
        <button onClick={onCancel}>Cancel</button>
        <small className="muted">Ctrl Enter saves · the board changes for everyone in it</small>
      </div>
    </div>
  )
}

/** Tables, Kanban boards and databases read better as real tables; the rest is drawn. */
function EmbedView({ board, target, maxHeight, big, name }: { board: Board; target: Item | undefined; maxHeight?: number; big?: boolean; name: string }) {
  if (target && (target.kind === 'table' || target.kind === 'kanban' || target.kind === 'data')) return <DataEmbed board={board} item={target} />
  return <Drawn board={board} maxHeight={maxHeight} big={big} name={name} />
}

function Drawn({ board, maxHeight, big, name }: { board: Board; maxHeight?: number; big?: boolean; name: string }) {
  // Widgets read their board (and its datasets) from the editor, so each embed gets its own, read-only.
  const view = useMemo(() => {
    const e = new Editor(board, measureText)
    e.readOnly = true
    return e
  }, [board])
  const box = B.bounds(view.board)
  if (!box) return <div className="embed-missing muted">Nothing to show.</div>
  const x = box.x - PAD
  const y = box.y - PAD
  const w = box.w + PAD * 2
  const h = box.h + PAD * 2
  return (
    <div className={`embed-view${big ? ' big' : ''}`} style={big ? undefined : { aspectRatio: `${w} / ${h}`, maxHeight: maxHeight ?? 560, maxWidth: w * MAX_ZOOM, margin: '0 auto' }}>
      <svg viewBox={`${x} ${y} ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label={name}>
        {/* What it says, for screen readers (the drawing itself is hidden from them). */}
        <desc>{view.board.items.map((i) => i.text.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 60).join(' · ')}</desc>
        <EditorContext.Provider value={view}>
          <BoardView board={view.board} hidden={B.hiddenIds(view.board)} editingId={null} editingLabel={null} selectedConnector={null} selection={NONE} />
        </EditorContext.Provider>
      </svg>
    </div>
  )
}

/** A table, Kanban board or database view as an HTML table (copyable, readable on a phone). */
function DataEmbed({ board, item }: { board: Board; item: Item }) {
  if (item.kind === 'table' && item.table) {
    const cols = item.table.columns.filter((c) => !c.hidden)
    return (
      <div className="md-table embed-data">
        <table>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.id}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.table.rows
              .filter((r) => !r.hidden)
              .map((r) => (
                <tr key={r.id}>
                  {cols.map((c) => (
                    <td key={c.id}>{r.cells[c.id] ?? ''}</td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    )
  }
  if (item.kind === 'kanban' && item.kanban) {
    return (
      <div className="embed-kanban">
        {item.kanban.columns.map((col) => (
          <section key={col.id}>
            <h4>
              {col.title} <span className="muted">{col.cards.length}</span>
            </h4>
            <ul>
              {col.cards.map((c) => (
                <li key={c.id}>
                  {c.title}
                  {c.due && <small className="muted"> · due {c.due}</small>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    )
  }
  const ds = item.view ? D.getDataset(board, item.view.dataset) : undefined
  if (!ds || !item.view) return <div className="embed-missing muted">That database isn’t there any more.</div>
  const fields = D.shownFields(ds, item.view)
  return (
    <div className="md-table embed-data">
      <table>
        <thead>
          <tr>
            {fields.map((f) => (
              <th key={f.id}>{f.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {D.viewRecords(ds, item.view).map((r) => (
            <tr key={r.id}>
              {fields.map((f) => (
                <td key={f.id}>{D.display(ds, f, r.values[f.id])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The embed full screen. */
function EmbedExpanded({ label, name, board, target, onClose, onOpen }: { label: string; name: string; board: Board; target: Item | undefined; onClose: () => void; onOpen?: () => void }) {
  useEscape(onClose)
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal embed-expanded" role="dialog" aria-modal="true" aria-label={label}>
        <header>
          <h2>{label}</h2>
          {onOpen && (
            <button
              onClick={() => {
                onClose()
                onOpen()
              }}
            >
              Open on board
            </button>
          )}
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="embed-expanded-body">
          <EmbedView board={board} target={target} big name={name} />
        </div>
      </div>
    </div>
  )
}
