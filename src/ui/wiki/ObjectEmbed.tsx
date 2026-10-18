import { useEffect, useMemo, useState } from 'react'
import { Editor } from '../../editor/Editor'
import * as B from '../../model/board'
import { maskFor } from '../../model/brainstorm'
import * as D from '../../model/dataset'
import { embedBoard, getSnap, makeSnap, snapBoard, snapKey } from '../../model/embed'
import type { Block } from '../../model/markdown'
import type { Board, Id, Item } from '../../model/types'
import { BoardView, formatTime } from '../BoardView'
import { measureText } from '../measure'
import { EditorContext, useEditor } from '../useEditor'
import { useEscape } from '../useEscape'
import { useWorkspace } from '../useWorkspace'

type EmbedBlock = Extract<Block, { t: 'embed' }>
const NONE: ReadonlySet<Id> = new Set()
const PAD = 24

/**
 * A canvas object (or a whole board) inside a page, drawn by the board's own renderer. It shows
 * the board as this browser has it; without the board, the copy the wiki keeps (which anyone who
 * has the board refreshes as they read the page).
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
  const livePart = useMemo(() => (source ? embedBoard(maskFor(source, editor.me), block.item) : null), [source, block.item, editor.me])

  // The wiki's copy follows the board, for friends who don't have it.
  useEffect(() => {
    if (!source || !meta || editor.readOnly || (snap && snap.at >= meta.updated)) return
    const s = makeSnap(source, block.board, block.item, meta.updated)
    if (s) editor.keepSnap(s)
  }, [source, meta, snap, editor, block.board, block.item])

  const board = livePart ?? (snap ? snapBoard(snap) : null)
  const target = block.item !== undefined && board ? B.getItem(board, block.item) : undefined
  const gone = !!source && block.item !== undefined && !livePart
  const label = block.label || (target ? target.text.split('\n')[0] : '') || meta?.title || 'Embedded board'
  const when = livePart ? 'live' : snap ? `a copy from ${formatTime(snap.at)}` : ''

  const open = () => void ws.openLink({ board: block.board, ...(block.item !== undefined ? { item: block.item } : {}) })
  const view = board ? <EmbedView board={board} target={target} maxHeight={block.height} /> : null

  return (
    <figure className="embed">
      {view ?? (
        <div className="embed-missing muted">
          {meta ? (gone ? 'That object was deleted from the board.' : 'Opening…') : 'That board isn’t in this browser, and the wiki has no copy of it yet. Ask whoever added it to open this page once.'}
        </div>
      )}
      <figcaption>
        <span className="embed-label">{label}</span>
        <span className="muted">
          {meta ? ` · from ${meta.title || 'a board'}` : ''}
          {when ? ` · ${when}` : ''}
          {gone && snap ? ' · deleted from the board since' : ''}
        </span>
        <span className="embed-actions">
          {meta && (
            <button className="link" onClick={open}>
              Open on board
            </button>
          )}
          {view && (
            <button className="link" onClick={() => setExpanded(true)}>
              Expand
            </button>
          )}
        </span>
      </figcaption>
      {expanded && board && <EmbedExpanded label={label} board={board} target={target} onClose={() => setExpanded(false)} onOpen={meta ? open : undefined} />}
    </figure>
  )
}

/** Tables, Kanban boards and databases read better as real tables; the rest is drawn. */
function EmbedView({ board, target, maxHeight, big }: { board: Board; target: Item | undefined; maxHeight?: number; big?: boolean }) {
  if (target && (target.kind === 'table' || target.kind === 'kanban' || target.kind === 'data')) return <DataEmbed board={board} item={target} />
  return <Drawn board={board} maxHeight={maxHeight} big={big} />
}

function Drawn({ board, maxHeight, big }: { board: Board; maxHeight?: number; big?: boolean }) {
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
    <div className={`embed-view${big ? ' big' : ''}`} style={big ? undefined : { aspectRatio: `${w} / ${h}`, maxHeight: maxHeight ?? 560 }}>
      <svg viewBox={`${x} ${y} ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Embedded board view">
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
function EmbedExpanded({ label, board, target, onClose, onOpen }: { label: string; board: Board; target: Item | undefined; onClose: () => void; onOpen?: () => void }) {
  useEscape(onClose)
  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal embed-expanded" role="dialog" aria-modal="true" aria-label={label}>
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
          <EmbedView board={board} target={target} big />
        </div>
      </div>
    </div>
  )
}
