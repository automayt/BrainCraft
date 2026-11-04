import { type PointerEvent, useContext, useEffect, useRef, useState } from 'react'
import * as K from '../../model/kanban'
import { today, toDay } from '../../model/timeline'
import { FILLS, type Item, type KanbanCard, type KanbanData } from '../../model/types'
import { EditorContext } from '../useEditor'
import { lift, type Lifted } from './liftedCard'
import { Menu, Widget } from './Widget'

interface Place {
  column: string
  /** Among the column's other cards (not the one being dragged). */
  index: number
}

interface DragState {
  card: string
  pointer: number
  startX: number
  startY: number
  moved: boolean
  /** Where it came from, and goes back to if it's let go off the columns or Esc is pressed. */
  from: Place
  target: Place | null
  /** Its height, for the gap that opens where it will land. */
  height: number
  /** Let go: gliding into its place. */
  landing?: boolean
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

/** The header's template menu, kept apart from the columns' own menus. */
const TEMPLATES_MENU = '#templates'

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
  const lifted = useRef<Lifted | null>(null)
  const stopDrag = useRef<(() => void) | null>(null)
  const now = today()
  const lastCol = k.columns.length - 1

  // Gone mid-drag (deleted by someone else, say): the floating card goes too.
  useEffect(
    () => () => {
      stopDrag.current?.()
      lifted.current?.drop(null, () => {})
    },
    [],
  )

  const setDragState = (d: DragState | null) => {
    dragRef.current = d
    setDrag(d)
  }
  /** A column's cards, without the one being dragged. */
  const others = (cards: KanbanCard[]) => cards.filter((c) => !(drag?.moved && c.id === drag.card))

  /**
   * Picks a card up: past a few pixels it lifts off and follows the pointer, a gap opening where it
   * would land; let go, it glides into that gap and moves there.
   */
  const onCardDown = (e: PointerEvent, card: KanbanCard, from: Place) => {
    if (editor.readOnly || e.button !== 0 || (e.target as Element).closest('button, input, textarea')) return
    // Cards drag on the first press, even before the board is selected (instead of moving the whole board).
    e.stopPropagation()
    if (!live) editor.select([item.id])
    const el = e.currentTarget as HTMLElement
    const board = el.closest('.kanban-columns')
    el.setPointerCapture(e.pointerId)
    setDragState({ card: card.id, pointer: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, from, target: null, height: el.offsetHeight })

    const move = (ev: globalThis.PointerEvent) => {
      const d = dragRef.current
      if (!d || d.pointer !== ev.pointerId || d.landing) return
      if (!d.moved) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) <= 4) return
        lifted.current = lift(el, d.startX, d.startY, editor.camera.zoom)
        document.documentElement.classList.add('card-grabbing')
      }
      lifted.current?.move(ev.clientX, ev.clientY)
      // Between two columns the gap stays where it was; off the board altogether, it goes back home.
      const over = dropTarget(ev.clientX, ev.clientY, d.card)
      const onBoard = !!board && document.elementsFromPoint(ev.clientX, ev.clientY).includes(board)
      setDragState({ ...d, moved: true, target: over ?? (onBoard ? (d.target ?? d.from) : d.from) })
    }
    const finish = (back: boolean) => {
      stop()
      const d = dragRef.current
      if (!d) return
      if (!d.moved) return setDragState(null)
      const to = back ? d.from : (d.target ?? d.from)
      setDragState({ ...d, target: to, landing: true })
      // Once the gap is drawn where it lands, the card glides into it.
      requestAnimationFrame(() => {
        const gap = document.querySelector(`[data-gap="${item.id}"]`)?.getBoundingClientRect() ?? null
        const card = lifted.current
        const land = () => {
          lifted.current = null
          setDragState(null)
          if (to.column !== d.from.column || to.index !== d.from.index) update((x) => K.moveCard(x, d.card, to.column, to.index))
        }
        if (card) card.drop(gap, land)
        else land()
      })
    }
    const up = (ev: globalThis.PointerEvent) => ev.pointerId === dragRef.current?.pointer && finish(ev.type === 'pointercancel')
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !dragRef.current?.moved) return
      ev.preventDefault()
      ev.stopPropagation()
      finish(true)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', key, true)
      document.documentElement.classList.remove('card-grabbing')
      stopDrag.current = null
    }
    stopDrag.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('keydown', key, true)
  }

  const actions = (
    <>
      <button title="Columns from a template (cards stay where they are)" onClick={() => setMenu(TEMPLATES_MENU)}>
        Templates
      </button>
      {menu === TEMPLATES_MENU && (
        <Menu
          onClose={() => setMenu(null)}
          items={K.KANBAN_TEMPLATES.map((t) => [t.label, () => update((x) => K.withColumns(x, t.columns))] as [string, () => void])}
        />
      )}
    </>
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
                <button className="more" title="Column options" aria-label={`Options for column ${col.title}`} onClick={() => setMenu(col.id)}>
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
                const held = drag?.moved && drag.card === card.id
                // The gap goes before the card it would land in front of, counting the others only.
                const gapHere = !held && drag?.moved && drag.target?.column === col.id && drag.target.index === others(col.cards).indexOf(card)
                return (
                  <div key={card.id}>
                    {gapHere && <div className="drop-gap" data-gap={item.id} style={{ height: drag.height }} />}
                    <article
                      data-card={card.id}
                      className={`kanban-card${held ? ' dragging' : ''}`}
                      style={{ borderLeftColor: card.color ?? 'transparent' }}
                      onPointerDown={(e) => onCardDown(e, card, { column: col.id, index })}
                      onDoubleClick={() => live && setEditing(card.id)}
                      tabIndex={live ? 0 : -1}
                      aria-label={`${card.title || 'Untitled'}, in ${col.title}`}
                      onKeyDown={(e) => {
                        if (!live || e.target !== e.currentTarget) return
                        // Alt + arrows move the card without dragging; Enter renames, Space opens the details.
                        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
                        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
                        if (e.altKey && (dx || dy)) {
                          e.preventDefault()
                          e.stopPropagation()
                          const to = k.columns[ci + dx]
                          if (!to) return
                          update((x) => K.moveCard(x, card.id, to.id, dx ? to.cards.length : Math.max(0, index + dy)))
                          requestAnimationFrame(() => (document.querySelector(`[data-card="${card.id}"]`) as HTMLElement | null)?.focus())
                        } else if (e.key === 'Enter') {
                          e.preventDefault()
                          e.stopPropagation()
                          setEditing(card.id)
                        } else if (e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          setDetails(details === card.id ? null : card.id)
                        }
                      }}
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
                        <button className="card-more" title="Card details" aria-label={`Details for ${card.title || 'card'}`} onClick={() => setDetails(details === card.id ? null : card.id)}>
                          ⋯
                        </button>
                      )}
                      {details === card.id && (
                        <CardDetails
                          card={card}
                          columns={k.columns.filter((c) => c.id !== col.id).map((c) => ({ id: c.id, title: c.title }))}
                          onMove={(column) => {
                            setDetails(null)
                            update((x) => K.moveCard(x, card.id, column, x.columns.find((c) => c.id === column)?.cards.length ?? 0))
                          }}
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
              {!col.cards.length && !(drag?.moved && drag.target?.column === col.id) && <p className="kanban-empty">{live || editor.readOnly ? 'No cards yet' : 'No cards yet. Select the Kanban to add one'}</p>}
              {drag?.moved && drag.target?.column === col.id && drag.target.index >= others(col.cards).length && (
                <div className="drop-gap" data-gap={item.id} style={{ height: drag.height }} />
              )}
              {live &&
                (adding === col.id ? (
                  <textarea
                    className="add-card-input"
                    autoFocus
                    rows={2}
                    placeholder="Card title (Enter adds another, Esc cancels)"
                    onBlur={(e) => {
                      // Clicking away keeps what was typed, as a card.
                      const title = e.target.value.trim()
                      if (title) update((x) => K.addCard(x, col.id, title)[0])
                      setAdding(null)
                    }}
                    onKeyDown={(e) => {
                      const input = e.target as HTMLTextAreaElement
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (input.value.trim()) update((x) => K.addCard(x, col.id, input.value.trim())[0])
                        input.value = ''
                      } else if (e.key === 'Escape') {
                        input.value = ''
                        setAdding(null)
                      }
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
        {live && (
          <button className="kanban-add-col" title="Add a column" aria-label="Add a column" onClick={() => update((x) => K.addColumn(x)[0])}>
            +
          </button>
        )}
      </div>
    </Widget>
  )
}

function CardDetails({
  card,
  columns,
  onMove,
  onChange,
  onDelete,
  onClose,
}: {
  card: KanbanCard
  columns: { id: string; title: string }[]
  onMove: (column: string) => void
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
        {columns.length > 0 && (
          <div className="card-move">
            <span>Move to</span>
            {columns.map((c) => (
              <button key={c.id} onClick={() => onMove(c.id)}>
                {c.title}
              </button>
            ))}
          </div>
        )}
        <button className="danger" onClick={onDelete}>
          Delete card
        </button>
      </div>
    </>
  )
}
