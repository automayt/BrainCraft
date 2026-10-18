import { useEffect, useMemo, useRef, useState } from 'react'
import { objectLabel } from '../../model/notes'
import { type Board, type Id, type Item, type Kind, itemKindLabel } from '../../model/types'
import { useDialog } from '../useDialog'
import { useEscape } from '../useEscape'
import { useWorkspace } from '../useWorkspace'

/** What's worth embedding first: whole areas and widgets, then everything else. */
const ORDER: Partial<Record<Kind, number>> = { frame: 0, mind: 1, table: 2, kanban: 2, timeline: 2, data: 2, flow: 3, code: 4 }
/** Objects listed at once; searching finds the rest. */
const SHOWN = 80

export interface EmbedChoice {
  board: string
  item?: Id
  label: string
}

/** Picks something to show in a page: a board, then one of its objects (or the whole board). */
export function EmbedPicker({ onPick, onClose }: { onPick: (c: EmbedChoice) => void; onClose: () => void }) {
  const ws = useWorkspace()
  const ref = useRef<HTMLDivElement>(null)
  useDialog(ref)
  useEscape(onClose)
  const boards = ws.otherBoards.filter((b) => b.kind !== 'wiki')
  const [key, setKey] = useState<string | null>(boards.length === 1 ? boards[0].key : null)
  const [board, setBoard] = useState<Board | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let live = true
    setBoard(null)
    if (key) void ws.readBoard(key).then((b) => live && setBoard(b))
    return () => {
      live = false
    }
  }, [key, ws])

  const all = useMemo(() => {
    if (!board) return []
    const q = query.trim().toLowerCase()
    // Mind-map ideas below the central one come with their map; pen strokes alone say little.
    return board.items
      .filter((i) => i.kind !== 'pen' && !(i.kind === 'mind' && i.parent !== undefined))
      .filter((i) => !q || objectLabel(i).toLowerCase().includes(q) || itemKindLabel(i).toLowerCase().includes(q))
      .sort((a, z) => (ORDER[a.kind] ?? 5) - (ORDER[z.kind] ?? 5))
  }, [board, query])
  const items = all.slice(0, SHOWN)
  // The highlighted row for the keyboard: 0 is the whole board, then the objects. Searching
  // highlights the first match.
  const [k, setK] = useState(0)
  useEffect(() => setK(query.trim() ? 1 : 0), [query])
  const at = Math.min(k, items.length)
  useEffect(() => {
    ref.current?.querySelector('.embed-choices .on')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const title = boards.find((b) => b.key === key)?.title ?? 'Board'
  const pick = (i?: Item) => onPick({ board: key!, ...(i ? { item: i.id } : {}), label: i ? objectLabel(i) : title })

  return (
    <div className="modal-backdrop no-canvas" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal embed-picker" role="dialog" aria-modal="true" aria-label="Embed from a board">
        <header>
          <h2>{key ? `Embed from ${title}` : 'Embed from a board'}</h2>
          {key && boards.length > 1 && (
            <button className="link" onClick={() => setKey(null)}>
              Other boards
            </button>
          )}
          <button className="icon-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {!key ? (
          boards.length ? (
            <ul className="embed-choices">
              {boards.map((b) => (
                <li key={b.key}>
                  <button onClick={() => setKey(b.key)}>
                    <strong>
                      {b.icon ?? '🗺'} {b.title || 'Untitled board'}
                    </strong>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">There are no canvas boards in this browser to embed from yet.</p>
          )
        ) : (
          <>
            <input
              className="embed-search"
              placeholder="Find an object"
              aria-label="Find an object (arrows to choose, Enter to embed)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  setK((at + (e.key === 'ArrowDown' ? 1 : items.length)) % (items.length + 1))
                } else if (e.key === 'Enter' && board) {
                  e.preventDefault()
                  pick(at ? items[at - 1] : undefined)
                }
              }}
              autoFocus
            />
            {!board ? (
              <p className="muted">Opening…</p>
            ) : (
              <ul className="embed-choices">
                <li>
                  <button className={at === 0 ? 'on' : ''} onClick={() => pick()}>
                    <strong>The whole board</strong>
                    <small className="muted">{board.items.length} objects</small>
                  </button>
                </li>
                {items.map((i, n) => (
                  <li key={i.id}>
                    <button className={at === n + 1 ? 'on' : ''} onClick={() => pick(i)}>
                      <strong>{objectLabel(i)}</strong>
                      <small className="muted">{itemKindLabel(i)}</small>
                    </button>
                  </li>
                ))}
                {!items.length && query && <li className="muted">Nothing called that on this board.</li>}
                {all.length > SHOWN && <li className="muted">Showing {SHOWN} of {all.length}. Type to find the rest.</li>}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
