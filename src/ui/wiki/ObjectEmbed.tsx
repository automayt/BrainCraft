import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialog } from '../useDialog'
import { Editor } from '../../editor/Editor'
import * as B from '../../model/board'
import { maskFor } from '../../model/brainstorm'
import * as D from '../../model/dataset'
import { embedBoard, getSnap, makeSnap, snapBoard, snapKey } from '../../model/embed'
import type { Block } from '../../model/markdown'
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
export function ObjectEmbed({ block }: { block: EmbedBlock }) {
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
  const view = board ? <EmbedView board={board} target={target} maxHeight={block.height} name={name} /> : null

  return (
    <figure className="embed">
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
          {view && (
            <button className="link" onClick={() => setExpanded(true)}>
              Expand
            </button>
          )}
        </span>
      </figcaption>
      {expanded && board && <EmbedExpanded label={label} name={name} board={board} target={target} onClose={() => setExpanded(false)} onOpen={meta && !gone ? open : undefined} />}
    </figure>
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
