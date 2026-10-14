import { type PointerEvent, useContext, useRef, useState } from 'react'
import * as K from '../../model/kanban'
import { today, toDay } from '../../model/timeline'
import { FILLS, type Item, type KanbanCard, type KanbanData } from '../../model/types'
import { EditorContext } from '../useEditor'
import { Menu, Widget } from './Widget'

interface DragState {
  card: string
  pointer: number
  startX: number
  startY: number
  moved: boolean
  target: { column: string; index: number } | null
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Where a card dragged to (x, y) on screen would land. */
function dropTarget(x: number, y: number, dragged: string): { column: string; index: number } | null {
  const col = document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.dataset.col) as HTMLElement | undefined
  if (!col) return null
  const cards = Array.from(col.querySelectorAll<HTMLElement>('[data-card]')).filter((c) => c.dataset.card !== dragged)
  let index = cards.length
  for (let k = 0; k < cards.length; k++) {
    const r = cards[k].getBoundingClientRect()
    if (y < r.top + r.height / 2) {
      index = k
      break
    }
  }
  return { column: col.dataset.col!, index }
}

export function KanbanView({ item, live, editingTitle }: { item: Item; live: boolean; editingTitle: boolean }) {
  const editor = useContext(EditorContext)!
  const k = item.kanban!
  const update = (f: (k: KanbanData) => KanbanData) => editor.updateKanban(item.id, f)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const now = today()
  const lastCol = k.columns.length - 1

  const onCardDown = (e: PointerEvent, card: KanbanCard) => {
    if (!live || e.button !== 0 || (e.target as Element).closest('button, input, textarea')) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const d = { card: card.id, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, target: null }
    dragRef.current = d
    setDrag(d)
  }
  const onCardMove = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4
    const next = { ...d, moved, target: moved ? dropTarget(e.clientX, e.clientY, d.card) : null }
    dragRef.current = next
    setDrag(next)
  }
  const onCardUp = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (d.moved && d.target) update((x) => K.moveCard(x, d.card, d.target!.column, d.target!.index))
  }

  const actions = (
    <button title="Add a column" onClick={() => update((x) => K.addColumn(x)[0])}>
      + Column
    </button>
  )

  return (
    <Widget item={item} live={live} editingTitle={editingTitle} actions={actions}>
      <div className="kanban-columns">
        {k.columns.map((col, ci) => (
          <section key={col.id} className={`kanban-col${drag?.target?.column === col.id ? ' drop' : ''}`} data-col={col.id}>
            <header>
              {live ? (
                <input
                  className="kanban-col-title"
                  defaultValue={col.title}
                  key={col.title}
                  aria-label="Column name"
                  onBlur={(e) => e.target.value !== col.title && update((x) => K.renameColumn(x, col.id, e.target.value || col.title))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <span className="kanban-col-title">{col.title}</span>
              )}
              <span className="count">{col.cards.length}</span>
              {live && (
                <button className="more" title="Column options" onClick={() => setMenu(col.id)}>
                  ⋯
                </button>
              )}
              {menu === col.id && (
                <Menu
                  onClose={() => setMenu(null)}
                  items={[
                    ['Move left', () => update((x) => K.moveColumn(x, col.id, -1))],
                    ['Move right', () => update((x) => K.moveColumn(x, col.id, 1))],
                    null,
                    [col.cards.length ? `Delete column and ${col.cards.length} card${col.cards.length === 1 ? '' : 's'}` : 'Delete column', () => update((x) => K.deleteColumn(x, col.id))],
                  ]}
                />
              )}
            </header>
            <div className="kanban-cards">
              {col.cards.map((card, index) => {
                const overdue = card.due && ci !== lastCol && toDay(card.due) < now
                const showDrop = drag?.moved && drag.target?.column === col.id && drag.target.index === index
                return (
                  <div key={card.id}>
                    {showDrop && <div className="drop-line" />}
                    <article
                      data-card={card.id}
                      className={`kanban-card${drag?.moved && drag.card === card.id ? ' dragging' : ''}`}
                      style={{ borderLeftColor: card.color ?? 'transparent' }}
                      onPointerDown={(e) => onCardDown(e, card)}
                      onPointerMove={onCardMove}
                      onPointerUp={onCardUp}
                      onPointerCancel={onCardUp}
                      onDoubleClick={() => live && setEditing(card.id)}
                    >
                      {editing === card.id ? (
                        <textarea
                          autoFocus
                          defaultValue={card.title}
                          rows={2}
                          onFocus={(e) => e.target.select()}
                          onBlur={(e) => {
                            setEditing(null)
                            if (e.target.value !== card.title) update((x) => K.updateCard(x, card.id, { title: e.target.value }))
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              ;(e.target as HTMLTextAreaElement).blur()
                            } else if (e.key === 'Escape') setEditing(null)
                          }}
                        />
                      ) : (
                        <p>{card.title || <span className="muted">Untitled</span>}</p>
                      )}
                      {(card.due || card.start) && (
                        <div className={`card-date${overdue ? ' overdue' : ''}`}>
                          {card.start && card.due ? `${shortDate(card.start)} – ${shortDate(card.due)}` : card.due ? `Due ${shortDate(card.due)}` : `Starts ${shortDate(card.start!)}`}
                          {overdue && ' · overdue'}
                        </div>
                      )}
                      {live && (
                        <button className="card-more" title="Card details" onClick={() => setDetails(details === card.id ? null : card.id)}>
                          ⋯
                        </button>
                      )}
                      {details === card.id && (
                        <CardDetails
                          card={card}
                          onClose={() => setDetails(null)}
                          onChange={(patch) => update((x) => K.updateCard(x, card.id, patch))}
                          onDelete={() => {
                            setDetails(null)
                            update((x) => K.deleteCard(x, card.id))
                          }}
                        />
                      )}
                    </article>
                  </div>
                )
              })}
              {drag?.moved && drag.target?.column === col.id && drag.target.index >= col.cards.filter((c) => c.id !== drag.card).length && (
                <div className="drop-line" />
              )}
              {live &&
                (adding === col.id ? (
                  <textarea
                    className="add-card-input"
                    autoFocus
                    rows={2}
                    placeholder="Card title — Enter to add another, Esc to stop"
                    onBlur={() => setAdding(null)}
                    onKeyDown={(e) => {
                      const input = e.target as HTMLTextAreaElement
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (input.value.trim()) update((x) => K.addCard(x, col.id, input.value.trim())[0])
                        input.value = ''
                      } else if (e.key === 'Escape') setAdding(null)
                    }}
                  />
                ) : (
                  <button className="add-card" onClick={() => setAdding(col.id)}>
                    + Add card
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
    </Widget>
  )
}

function CardDetails({
  card,
  onChange,
  onDelete,
  onClose,
}: {
  card: KanbanCard
  onChange: (patch: Partial<KanbanCard>) => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <>
      <div className="menu-scrim" onPointerDown={onClose} />
      <div className="card-details" onPointerDown={(e) => e.stopPropagation()}>
        <div className="swatches">
          <button className={`swatch none${card.color ? '' : ' active'}`} title="No colour" onClick={() => onChange({ color: '' })} />
          {FILLS.slice(0, 8).map(([name, color]) => (
            <button key={color} className={`swatch${card.color === color ? ' active' : ''}`} style={{ background: color }} title={name} onClick={() => onChange({ color })} />
          ))}
        </div>
        <label>
          Start
          <input type="date" value={card.start ?? ''} onChange={(e) => onChange({ start: e.target.value })} />
        </label>
        <label>
          Due
          <input type="date" value={card.due ?? ''} onChange={(e) => onChange({ due: e.target.value })} />
        </label>
        <button className="danger" onClick={onDelete}>
          Delete card
        </button>
      </div>
    </>
  )
}
