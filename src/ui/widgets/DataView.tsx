/**
 * A view of a dataset: a table, a board grouped by a field, or a timeline of date fields.
 * Every view of the same dataset edits the same records, so changes show up everywhere.
 */

import { type PointerEvent, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as D from '../../model/dataset'
import { parseMarkdown, toggleTask } from '../../model/markdown'
import { Markdown, type MarkdownActions } from '../wiki/Markdown'
import * as TL from '../../model/timeline'
import { fromDay, isIsoDay, today } from '../../model/timeline'
import type { DataRecord, DataView as View, DataViewType, Dataset, Field, FieldType, FieldValue, Item } from '../../model/types'
import { textOn } from '../paint'
import { EditorContext } from '../useEditor'
import { useEscape } from '../useEscape'
import { Menu, Widget } from './Widget'

const WIDTH: Record<FieldType, number> = { text: 220, number: 96, date: 132, select: 140, person: 128, checkbox: 76 }
const ROWNUM = 36

const typeIcon = (t: FieldType) => D.FIELD_TYPES.find((x) => x.type === t)!.icon

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface Ctx {
  item: Item
  ds: Dataset
  view: View
  live: boolean
  edit: (f: (d: Dataset) => Dataset) => void
  setView: (f: (v: View) => View) => void
  openRecord: (id: string) => void
  /** The board is open for editing (this view may not be selected yet). */
  editable: boolean
  /** Selects this view (a card or bar pressed before the view was selected). */
  select: () => void
}

/** A choice shown as a coloured pill. */
function Pill({ name, color }: { name: string; color?: string }) {
  return (
    <span className="dv-pill" style={color ? { background: color, color: textOn(color) } : undefined}>
      {name}
    </span>
  )
}

/** A value as read-only content. */
function Show({ ds, f, v }: { ds: Dataset; f: Field; v: FieldValue | undefined }) {
  if (v === undefined || v === '') return null
  if (f.type === 'select') {
    const o = D.optionOf(f, v)
    return o ? <Pill name={o.name} color={o.color} /> : null
  }
  if (f.type === 'checkbox') return v ? <span className="dv-check">✓</span> : null
  if (f.type === 'date' && typeof v === 'string' && isIsoDay(v)) return <span>{shortDate(v)}</span>
  return <span>{D.display(ds, f, v)}</span>
}

/** An editor for one value, matched to its field's type. Text-like values save on blur or Enter. */
function Cell({ c, f, r, autoFocus }: { c: Ctx; f: Field; r: DataRecord; autoFocus?: boolean }) {
  const v = r.values[f.id]
  const set = (value: FieldValue | null) => c.edit((d) => D.setValue(d, r.id, f.id, value))
  const [adding, setAdding] = useState(false)
  if (!c.live) return <Show ds={c.ds} f={f} v={v} />
  const label = `${f.name} of ${D.recordTitle(c.ds, r)}`
  switch (f.type) {
    case 'checkbox':
      return <input type="checkbox" checked={!!v} aria-label={label} onChange={(e) => set(e.target.checked)} />
    case 'date':
      return (
        <input
          type="date"
          aria-label={label}
          defaultValue={typeof v === 'string' ? v : ''}
          key={String(v)}
          onBlur={(e) => e.target.value !== (v ?? '') && set(e.target.value || null)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )
    case 'select': {
      const o = D.optionOf(f, v)
      if (adding)
        return (
          <input
            autoFocus
            placeholder="New choice"
            aria-label={`New choice for ${f.name}`}
            onBlur={(e) => {
              const name = e.target.value.trim()
              setAdding(false)
              if (!name) return
              c.edit((d) => {
                const [next, opt] = D.addOption(d, f.id, name)
                return opt ? D.setValue(next, r.id, f.id, opt) : next
              })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
        )
      return (
        <select
          className="dv-select"
          aria-label={label}
          value={o?.id ?? ''}
          style={o ? { background: o.color, color: textOn(o.color) } : undefined}
          onChange={(e) => (e.target.value === '+' ? setAdding(true) : set(e.target.value || null))}
        >
          <option value="">—</option>
          {f.options?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
          <option value="+">+ New choice…</option>
        </select>
      )
    }
    default:
      return (
        <input
          autoFocus={autoFocus}
          className={f.type === 'number' ? 'num' : ''}
          inputMode={f.type === 'number' ? 'decimal' : undefined}
          aria-label={label}
          defaultValue={v === undefined ? '' : String(v)}
          key={String(v)}
          placeholder={f.id === D.titleField(c.ds).id ? 'Untitled' : ''}
          onBlur={(e) => e.target.value !== (v === undefined ? '' : String(v)) && set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              ;(e.target as HTMLInputElement).value = v === undefined ? '' : String(v)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      )
  }
}

/** A record that has a page (notes, a checklist, a spec). */
const HasPage = () => (
  <span className="dv-has-page" title="Has a page: open it to read" aria-label="has a page">
    ≡
  </span>
)

/** Links inside a record's page read as plain words (it has no wiki around it). */
const PAGE_ACTIONS: Omit<MarkdownActions, 'toggle'> = {
  link: (_to, label, key) => <span key={key}>{label}</span>,
  mention: (_id, label, key) => <span key={key}>@{label}</span>,
  children: () => null,
  headings: [],
}

/**
 * A record as a page, over the board: its title large, its fields, then its page (notes, a
 * checklist, a spec) in Markdown, read as formatted text and edited with a click. Wherever a record
 * is opened: a table row, a card, a bar, a calendar chip, a gallery card.
 */
function RecordPage({ c, id, onClose }: { c: Ctx; id: string; onClose: () => void }) {
  const r = c.ds.records.find((x) => x.id === id)
  const [draft, setDraft] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sheet = useRef<HTMLDivElement>(null)
  const blocks = useMemo(() => parseMarkdown(r?.body ?? ''), [r?.body])
  // Writing settles into the record a moment after it stops, and at once on leaving.
  const save = (text: string) => {
    clearTimeout(timer.current)
    timer.current = undefined
    c.edit((d) => D.setBody(d, id, text))
  }
  const close = () => {
    if (draft !== null && timer.current) save(draft)
    onClose()
  }
  useEscape(close)
  // The keyboard (and a screen reader) goes to the page that just opened, and back after.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    sheet.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.icon-close)')?.focus({ preventScroll: true })
    return () => {
      clearTimeout(timer.current)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [id])
  if (!r) return null
  const [titleField, ...rest] = c.ds.fields
  const title = D.recordTitle(c.ds, r)
  const write = () => setDraft(r.body ?? '')

  return createPortal(
    <div
      className="modal-backdrop no-canvas"
      onPointerDown={(e) => {
        // Clicks here are the page's, not the widget's on the board behind it.
        e.stopPropagation()
        if (e.target === e.currentTarget) close()
      }}
    >
      <div ref={sheet} className="modal record-page" role="dialog" aria-modal="true" aria-label={`Record: ${title}`}>
        <header>
          <span className="muted">{c.ds.name}</span>
          <button className="icon-close" aria-label="Close" onClick={close}>
            ×
          </button>
        </header>
        <div className="record-body">
          {titleField && (
            <div className="record-title">
              <Cell c={c} f={titleField} r={r} />
            </div>
          )}
          {rest.length > 0 && (
            <dl className="record-fields">
              {rest.map((f) => (
                <div key={f.id}>
                  <dt>
                    <span className="dv-type">{typeIcon(f.type)}</span>
                    {f.name}
                  </dt>
                  <dd>
                    <Cell c={c} f={f} r={r} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <section className="record-notes" aria-label="Page">
            {draft !== null ? (
              <>
                <textarea
                  className="record-text"
                  aria-label={`Page for ${title}`}
                  autoFocus
                  spellCheck
                  value={draft}
                  placeholder={'Notes, a checklist or a spec, in Markdown:\n\n## Heading\n- [ ] Something to do\n- A point'}
                  onChange={(e) => {
                    const v = e.target.value
                    setDraft(v)
                    clearTimeout(timer.current)
                    timer.current = setTimeout(() => save(v), 600)
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      save(e.currentTarget.value)
                      setDraft(null)
                    }
                  }}
                />
                <div className="record-notes-foot">
                  <button
                    className="primary"
                    onClick={() => {
                      save(draft)
                      setDraft(null)
                    }}
                  >
                    Done
                  </button>
                  <small className="muted">Markdown: ## headings, - lists, - [ ] checklists, | tables |. Saved as you write.</small>
                </div>
              </>
            ) : r.body ? (
              <>
                <div className="md record-md" onDoubleClick={c.live ? write : undefined}>
                  <Markdown blocks={blocks} actions={{ ...PAGE_ACTIONS, toggle: c.live ? (line) => c.edit((d) => D.setBody(d, id, toggleTask(r.body ?? '', line))) : undefined }} />
                </div>
                {c.live && (
                  <button className="link record-edit" onClick={write}>
                    Edit the page
                  </button>
                )}
              </>
            ) : c.live ? (
              <button className="record-empty" onClick={write}>
                Write notes, a checklist or a spec for this record…
              </button>
            ) : null}
          </section>
        </div>
        {c.live && (
          <footer>
            <button
              className="danger"
              onClick={() => {
                onClose()
                c.edit((d) => D.deleteRecord(d, id))
              }}
            >
              Delete record
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ----- table ------------------------------------------------------------------------------

function FieldMenu({ c, f, onClose }: { c: Ctx; f: Field; onClose: () => void }) {
  const isTitle = f.id === D.titleField(c.ds).id
  const items: ([string, () => void] | null)[] = [
    ['Sort ascending', () => c.setView((v) => ({ ...v, sort: { field: f.id, dir: 'asc' } }))],
    ['Sort descending', () => c.setView((v) => ({ ...v, sort: { field: f.id, dir: 'desc' } }))],
    null,
  ]
  if (!isTitle) {
    for (const t of D.FIELD_TYPES) if (t.type !== f.type) items.push([`Make it ${t.label.toLowerCase()}`, () => c.edit((d) => D.changeFieldType(d, f.id, t.type))])
    items.push(null, ['Hide in this view', () => c.setView((v) => ({ ...v, hidden: [...(v.hidden ?? []), f.id] }))], ['Delete field', () => c.edit((d) => D.deleteField(d, f.id))])
  }
  return <Menu items={items} onClose={onClose} />
}

function TableBody({ c }: { c: Ctx }) {
  const fields = D.shownFields(c.ds, c.view)
  const rows = D.viewRecords(c.ds, c.view)
  const [menu, setMenu] = useState<string | null>(null)
  const [focusNew, setFocusNew] = useState<string | null>(null)
  const addRecord = (after?: string) =>
    c.edit((d) => {
      const [next, id] = D.addRecord(d, {}, after)
      setFocusNew(id)
      return next
    })
  return (
    <div className="dv-table" role="table" style={{ gridTemplateColumns: `${ROWNUM}px ${fields.map((f) => `${WIDTH[f.type]}px`).join(' ')}${c.live ? ' 40px' : ''}` }}>
      <div className="dv-th corner" />
      {fields.map((f) => (
        <div key={f.id} className="dv-th" role="columnheader">
          <span className="dv-type" title={D.FIELD_TYPES.find((t) => t.type === f.type)!.label}>
            {typeIcon(f.type)}
          </span>
          {c.live ? (
            <input
              className="dv-fname"
              defaultValue={f.name}
              key={f.name}
              aria-label="Field name"
              onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && c.edit((d) => D.renameField(d, f.id, e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <span className="dv-fname">{f.name}</span>
          )}
          {c.view.sort?.field === f.id && <span className="dv-sort">{c.view.sort.dir === 'asc' ? '↑' : '↓'}</span>}
          {c.live && (
            <button className="more" aria-label={`${f.name} options`} onClick={() => setMenu(f.id)}>
              ⋯
            </button>
          )}
          {menu === f.id && <FieldMenu c={c} f={f} onClose={() => setMenu(null)} />}
        </div>
      ))}
      {c.live && (
        <div className="dv-th add">
          <button aria-label="Add a field" title="Add a field" onClick={() => setMenu('+')}>
            +
          </button>
          {menu === '+' && (
            <Menu
              onClose={() => setMenu(null)}
              items={D.FIELD_TYPES.map((t) => [`${t.icon}  ${t.label}`, () => c.edit((d) => D.addField(d, t.label, t.type)[0])] as [string, () => void])}
            />
          )}
        </div>
      )}
      {rows.map((r, k) => (
        <div key={r.id} role="row" style={{ display: 'contents' }}>
          <div className="dv-td rownum">
            {c.live ? (
              <button aria-label={`Record ${k + 1} options`} onClick={() => setMenu(`r:${r.id}`)}>
                {k + 1}
              </button>
            ) : (
              k + 1
            )}
            {menu === `r:${r.id}` && (
              <Menu
                onClose={() => setMenu(null)}
                items={[
                  ['Open record', () => c.openRecord(r.id)],
                  ['Insert below', () => addRecord(r.id)],
                  null,
                  ['Delete record', () => c.edit((d) => D.deleteRecord(d, r.id))],
                ]}
              />
            )}
          </div>
          {fields.map((f, n) => (
            <div key={f.id} className={`dv-td t-${f.type}`} role="cell">
              <Cell c={c} f={f} r={r} autoFocus={n === 0 && focusNew === r.id} />
            </div>
          ))}
          {c.live && <div className="dv-td" />}
        </div>
      ))}
      {c.live && (
        <button className="dv-new" style={{ gridColumn: `1 / span ${fields.length + 2}` }} onClick={() => addRecord()}>
          + New record
        </button>
      )}
      {!rows.length && !c.live && (
        <div className="dv-td empty" style={{ gridColumn: `1 / span ${fields.length + 1}` }}>
          {c.ds.records.length ? 'No records match' : 'No records yet'}
        </div>
      )}
    </div>
  )
}

// ----- board ------------------------------------------------------------------------------

interface CardDrag {
  id: string
  /** The view wasn't selected when the press began: a plain click only selects it. */
  fresh: boolean
  pointer: number
  x: number
  y: number
  moved: boolean
  target: { key: string | null; before: string | null } | null
}

function dropTarget(x: number, y: number, dragged: string): CardDrag['target'] {
  const col = document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.dataset.group !== undefined) as HTMLElement | undefined
  if (!col) return null
  const cards = Array.from(col.querySelectorAll<HTMLElement>('[data-record]')).filter((el) => el.dataset.record !== dragged)
  const next = cards.find((el) => {
    const r = el.getBoundingClientRect()
    return y < r.top + r.height / 2
  })
  return { key: col.dataset.group || null, before: next?.dataset.record ?? null }
}

function BoardBody({ c }: { c: Ctx }) {
  const group = D.groupField(c.ds, c.view)
  const cols = D.groups(c.ds, c.view)
  const meta = D.shownFields(c.ds, c.view).filter((f, k) => k > 0 && f.id !== group?.id)
  const [drag, setDrag] = useState<CardDrag | null>(null)
  const dragRef = useRef<CardDrag | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  if (!group)
    return (
      <div className="dv-empty">
        <p>A board needs a choice or person field to make its columns.</p>
        {c.live && (
          <button className="primary" onClick={() => c.edit((d) => D.addField(d, 'Status', 'select')[0])}>
            Add a Status field
          </button>
        )}
      </div>
    )

  const down = (e: PointerEvent, r: DataRecord) => {
    if (!c.editable || e.button !== 0) return
    // Cards drag on the first press, even before the view is selected.
    e.stopPropagation()
    if (!c.live) c.select()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = { id: r.id, fresh: !c.live, pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false, target: null }
    setDrag(dragRef.current)
  }
  const move = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4
    dragRef.current = { ...d, moved, target: moved ? dropTarget(e.clientX, e.clientY, d.id) : null }
    setDrag(dragRef.current)
  }
  const up = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (!d.moved) return d.fresh ? undefined : c.openRecord(d.id)
    if (d.target) c.edit((x) => D.moveToGroup(x, c.view, d.id, d.target!.key, d.target!.before))
  }

  return (
    <div className="dv-board">
      {cols.map((g) => (
        <section key={g.key ?? 'none'} className={`dv-col${drag?.target && (drag.target.key ?? '') === (g.key ?? '') ? ' drop' : ''}`} data-group={g.key ?? ''}>
          <header>
            <i style={{ background: g.color ?? 'var(--faint)' }} />
            <span>{g.name}</span>
            <span className="count">{g.records.length}</span>
          </header>
          <div className="dv-cards">
            {g.records.map((r) => (
              <article
                key={r.id}
                data-record={r.id}
                className={`dv-card${drag?.id === r.id && drag.moved ? ' dragging' : ''}`}
                onPointerDown={(e) => down(e, r)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => ((dragRef.current = null), setDrag(null))}
              >
                <strong>
                  {D.recordTitle(c.ds, r)}
                  {r.body && <HasPage />}
                </strong>
                <div className="dv-meta">
                  {meta.map((f) =>
                    r.values[f.id] === undefined ? null : (
                      <span key={f.id} title={f.name} className={`m-${f.type}`}>
                        {f.type === 'checkbox' ? (
                          r.values[f.id] ? `✓ ${f.name}` : null
                        ) : (
                          <>
                            {f.type === 'number' && <small>{f.name} </small>}
                            <Show ds={c.ds} f={f} v={r.values[f.id]} />
                          </>
                        )}
                      </span>
                    ),
                  )}
                </div>
              </article>
            ))}
            {c.live &&
              (adding === (g.key ?? '') ? (
                <input
                  autoFocus
                  className="dv-add-input"
                  placeholder={D.titleField(c.ds).name}
                  onBlur={(e) => {
                    const title = e.target.value.trim()
                    setAdding(null)
                    if (title) c.edit((d) => D.addRecord(d, { [D.titleField(d).id]: title, ...(g.key ? { [group.id]: g.key } : {}) })[0])
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const title = e.currentTarget.value.trim()
                      if (title) c.edit((d) => D.addRecord(d, { [D.titleField(d).id]: title, ...(g.key ? { [group.id]: g.key } : {}) })[0])
                      e.currentTarget.value = ''
                    }
                    if (e.key === 'Escape') setAdding(null)
                  }}
                />
              ) : (
                <button className="dv-add" onClick={() => setAdding(g.key ?? '')}>
                  + Add
                </button>
              ))}
          </div>
        </section>
      ))}
      {c.live && group.type === 'select' && (
        <button
          className="dv-add-col"
          onClick={() => {
            const n = (group.options?.length ?? 0) + 1
            c.edit((d) => D.addOption(d, group.id, `Group ${n}`)[0])
          }}
        >
          + {group.name}
        </button>
      )}
    </div>
  )
}

// ----- timeline ---------------------------------------------------------------------------

const LABEL_W = 150
const ROW_H = 30

interface BarDrag {
  id: string
  fresh: boolean
  pointer: number
  x: number
  edge?: 'start' | 'end'
  days: number
  moved: boolean
}

function TimelineBody({ c, width }: { c: Ctx; width: number }) {
  const editor = useContext(EditorContext)!
  const { start, end } = D.dateFields(c.ds, c.view)
  const { bars, undated } = D.bars(c.ds, c.view)
  const group = D.groupField(c.ds, c.view)
  const [drag, setDrag] = useState<BarDrag | null>(null)
  const dragRef = useRef<BarDrag | null>(null)
  const now = today()

  if (!start)
    return (
      <div className="dv-empty">
        <p>A timeline needs a date field.</p>
        {c.live && (
          <button className="primary" onClick={() => c.edit((d) => D.addField(D.addField(d, 'Start', 'date')[0], 'End', 'date')[0])}>
            Add Start and End dates
          </button>
        )}
      </div>
    )

  const days = bars.flatMap((b) => [b.start, b.end])
  const lo = Math.min(now, ...days) - 3
  const hi = Math.max(now, ...days) + 4
  const track = Math.max(200, width - LABEL_W - 16)
  const per = track / (hi - lo + 1)
  const xOf = (day: number) => (day - lo) * per

  // Lanes from the group field (when there is one), each with its records' rows.
  const lanes: { key: string; name: string; color?: string; rows: D.Bar[] }[] = []
  if (group) {
    for (const g of D.groups(c.ds, c.view)) {
      const rows = bars.filter((b) => g.records.includes(b.record))
      if (rows.length) lanes.push({ key: g.key ?? 'none', name: g.name, color: g.color, rows })
    }
  } else lanes.push({ key: 'all', name: '', rows: bars })

  // Ticks: days, weeks, months or years depending on room (the same ruler as the Timeline widget).
  const ticks = TL.ticks(lo, hi, per).map((t) => ({ x: xOf(t.day), label: t.label, major: t.major }))

  const down = (e: PointerEvent, b: D.Bar, edge?: 'start' | 'end') => {
    if (!c.editable || e.button !== 0) return
    // Bars drag on the first press, even before the view is selected.
    e.stopPropagation()
    if (!c.live) c.select()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = { id: b.record.id, fresh: !c.live, pointer: e.pointerId, x: e.clientX, edge, days: 0, moved: false }
    setDrag(dragRef.current)
  }
  const move = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    const dx = (e.clientX - d.x) / editor.camera.zoom
    dragRef.current = { ...d, moved: d.moved || Math.abs(dx) > 3, days: Math.round(dx / per) }
    setDrag(dragRef.current)
  }
  const up = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (!d.moved) return d.fresh ? undefined : c.openRecord(d.id)
    if (d.days) c.edit((x) => D.shiftDates(x, c.view, d.id, d.days, d.edge))
  }

  let y = 0
  return (
    <div className="dv-timeline" style={{ height: lanes.reduce((h, l) => h + l.rows.length * ROW_H + (group ? 26 : 0), 34) + 8 }}>
      <div className="dv-axis" style={{ left: LABEL_W }}>
        {ticks.map((t, k) => (
          <span key={k} className={`dv-tick${t.major ? ' major' : ''}`} style={{ left: t.x }}>
            {t.label}
          </span>
        ))}
      </div>
      <div className="dv-today" style={{ left: LABEL_W + xOf(now) + per / 2 }}>
        <span>Today</span>
      </div>
      <div className="dv-lanes" style={{ top: 34 }}>
        {lanes.map((l) => {
          const laneTop = y
          y += (group ? 26 : 0) + l.rows.length * ROW_H
          return (
            <div key={l.key} className="dv-lane" style={{ top: laneTop }}>
              {group && (
                <div className="dv-lane-name">
                  <i style={{ background: l.color ?? 'var(--faint)' }} />
                  {l.name}
                </div>
              )}
              {l.rows.map((b) => {
                const shift = drag?.id === b.record.id ? drag.days : 0
                const s = b.start + (drag?.edge === 'end' ? 0 : shift)
                const e = Math.max(s, b.end + (drag?.edge === 'start' ? 0 : shift))
                const color = group?.type === 'select' ? D.optionOf(group, b.record.values[group.id])?.color : undefined
                const fill = color ?? 'var(--accent-strong)'
                return (
                  <div key={b.record.id} className="dv-row">
                    <span className="dv-row-label" title={D.recordTitle(c.ds, b.record)}>
                      {D.recordTitle(c.ds, b.record)}
                    </span>
                    {b.milestone ? (
                      <div
                        className="dv-mile"
                        style={{ left: LABEL_W + xOf(s) + per / 2 - 8, background: fill }}
                        title={`${D.recordTitle(c.ds, b.record)} · ${shortDate(fromDay(s))}`}
                        onPointerDown={(ev) => down(ev, b)}
                        onPointerMove={move}
                        onPointerUp={up}
                      />
                    ) : (
                      <div
                        className={`dv-span${drag?.id === b.record.id ? ' dragging' : ''}`}
                        style={{ left: LABEL_W + xOf(s), width: Math.max(per, (e - s + 1) * per), background: fill, color: color ? textOn(color) : 'var(--on-accent)' }}
                        title={`${D.recordTitle(c.ds, b.record)} · ${shortDate(fromDay(s))} – ${shortDate(fromDay(e))}`}
                        onPointerDown={(ev) => down(ev, b)}
                        onPointerMove={move}
                        onPointerUp={up}
                      >
                        {c.live && end && <i className="grip start" onPointerDown={(ev) => down(ev, b, 'start')} />}
                        <span>{D.recordTitle(c.ds, b.record)}</span>
                        {c.live && end && <i className="grip end" onPointerDown={(ev) => down(ev, b, 'end')} />}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {undated > 0 && <p className="dv-undated muted">{undated} without a {start.name.toLowerCase()} date</p>}
    </div>
  )
}

// ----- calendar ---------------------------------------------------------------------------

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface DayDrag {
  id: string
  fresh: boolean
  pointer: number
  x: number
  y: number
  moved: boolean
  day: number | null
}

function CalendarBody({ c }: { c: Ctx }) {
  const { start } = D.dateFields(c.ds, c.view)
  const now = today()
  // Paging months is each viewer's own business: not a change to the board.
  const [paged, setPaged] = useState<string | null>(null)
  const month = paged ?? c.view.month ?? D.monthOf(now)
  const [drag, setDrag] = useState<DayDrag | null>(null)
  const dragRef = useRef<DayDrag | null>(null)
  const group = D.groupField(c.ds, c.view)
  // A day opened to show all its records (past the first three).
  const [allOf, setAllOf] = useState<number | null>(null)

  if (!start)
    return (
      <div className="dv-empty">
        <p>A calendar needs a date field.</p>
        {c.live && (
          <button className="primary" onClick={() => c.edit((d) => D.addField(d, 'Date', 'date')[0])}>
            Add a Date field
          </button>
        )}
      </div>
    )

  const cells = D.monthGrid(month)
  const byDay = D.recordsByDay(c.ds, c.view, cells)
  const undated = D.bars(c.ds, c.view).undated
  const [y, m] = (D.isMonth(month) ? month : D.monthOf(now)).split('-').map(Number)
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const dayAt = (x: number, yy: number) => {
    const el = document.elementFromPoint(x, yy)?.closest('[data-day]')
    return el ? Number(el.getAttribute('data-day')) : null
  }
  const down = (e: PointerEvent, id: string) => {
    if (!c.editable || e.button !== 0) return
    e.stopPropagation()
    if (!c.live) c.select()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = { id, fresh: !c.live, pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false, day: null }
    setDrag(dragRef.current)
  }
  const move = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    const moved = d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4
    dragRef.current = { ...d, moved, day: moved ? dayAt(e.clientX, e.clientY) : null }
    setDrag(dragRef.current)
  }
  const up = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (!d.moved) return d.fresh ? undefined : c.openRecord(d.id)
    if (d.day !== null) c.edit((x) => D.moveToDay(x, c.view, d.id, d.day!))
  }
  const addOn = (day: number) => {
    let id = ''
    c.edit((d) => {
      const [next, rid] = D.addRecord(d, { [D.titleField(d).id]: 'New', [start.id]: fromDay(day) })
      id = rid
      return next
    })
    if (id) c.openRecord(id)
  }

  return (
    <div className="dv-calendar">
      <div className="dv-cal-head">
        <strong>{title}</strong>
        <span className="dv-cal-nav">
          <button title="Previous month" aria-label="Previous month" onClick={() => setPaged(D.addMonths(month, -1))}>
            ‹
          </button>
          <button title="This month" onClick={() => setPaged(D.monthOf(now))}>
            Today
          </button>
          <button title="Next month" aria-label="Next month" onClick={() => setPaged(D.addMonths(month, 1))}>
            ›
          </button>
        </span>
      </div>
      <div className="dv-cal-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="dv-cal-weekday">
            {w}
          </span>
        ))}
        {cells.map((cell) => {
          const here = byDay.get(cell.day) ?? []
          const shown = allOf === cell.day ? here : here.slice(0, 3)
          return (
            <div
              key={cell.day}
              data-day={cell.day}
              className={`dv-cal-day${cell.inMonth ? '' : ' out'}${cell.day === now ? ' today' : ''}${drag?.moved && drag.day === cell.day ? ' drop' : ''}`}
              onDoubleClick={(e) => c.live && !(e.target as Element).closest('.dv-cal-chip') && addOn(cell.day)}
              title={c.live ? 'Double-click to add a record on this day' : undefined}
            >
              <span className="dv-cal-num">{Number(fromDay(cell.day).slice(8))}</span>
              {shown.map((b) => {
                const color = group?.type === 'select' ? D.optionOf(group, b.record.values[group.id])?.color : undefined
                const continues = b.start < cell.day
                return (
                  <button
                    key={b.record.id}
                    className={`dv-cal-chip${drag?.id === b.record.id && drag.moved ? ' dragging' : ''}${continues ? ' continues' : ''}`}
                    style={color ? { background: color, color: textOn(color) } : undefined}
                    title={D.recordTitle(c.ds, b.record)}
                    onPointerDown={(e) => down(e, b.record.id)}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={() => ((dragRef.current = null), setDrag(null))}
                    // From the keyboard (Enter or Space), open it; the pointer opens it on release.
                    onClick={(e) => e.detail === 0 && c.openRecord(b.record.id)}
                  >
                    {continues ? '… ' : ''}
                    {D.recordTitle(c.ds, b.record)}
                  </button>
                )
              })}
              {here.length > 3 && (
                <button className="dv-cal-more" onPointerDown={(e) => e.stopPropagation()} onClick={() => setAllOf(allOf === cell.day ? null : cell.day)}>
                  {allOf === cell.day ? 'Fewer' : `+${here.length - 3} more`}
                </button>
              )}
            </div>
          )
        })}
      </div>
      {undated > 0 && (
        <p className="dv-undated muted">
          {undated} without a {start.name.toLowerCase()} date{c.live ? ' (switch to the table to add one)' : ''}
        </p>
      )}
    </div>
  )
}

// ----- gallery ----------------------------------------------------------------------------

/** A card's picture, or its first letter on its group's colour (also when the picture won't load). */
function GalleryCover({ src, color, name }: { src?: string; color?: string; name: string }) {
  const [broken, setBroken] = useState(false)
  const show = src && !broken
  return (
    <div className="dv-gcover" style={show ? undefined : { background: color ?? 'var(--surface-2)' }}>
      {show ? (
        <img src={src} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span style={color ? { color: textOn(color) } : undefined}>{name.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  )
}

function GalleryBody({ c }: { c: Ctx }) {
  const records = D.viewRecords(c.ds, c.view)
  const group = D.groupField(c.ds, c.view)
  const meta = D.shownFields(c.ds, c.view)
    .slice(1)
    .filter((f) => !(f.type === 'text' && records.some((r) => D.coverOf(c.ds, r) === r.values[f.id])))
    .slice(0, 3)
  const add = () => {
    let id = ''
    c.edit((d) => {
      const [next, rid] = D.addRecord(d, { [D.titleField(d).id]: 'New' })
      id = rid
      return next
    })
    if (id) c.openRecord(id)
  }
  return (
    <div className="dv-gallery">
      {records.map((r) => {
        const cover = D.coverOf(c.ds, r)
        const color = group?.type === 'select' ? D.optionOf(group, r.values[group.id])?.color : undefined
        const name = D.recordTitle(c.ds, r)
        return (
          <article
            key={r.id}
            className="dv-gcard"
            role="button"
            tabIndex={c.live ? 0 : -1}
            aria-label={name}
            onKeyDown={(e) => {
              if (c.live && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                c.openRecord(r.id)
              }
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              if (!c.live) c.select()
            }}
            onClick={() => c.live && c.openRecord(r.id)}
          >
            <GalleryCover src={cover} color={color} name={name} />
            <strong>
              {name}
              {r.body && <HasPage />}
            </strong>
            <div className="dv-meta">
              {meta.map((f) =>
                r.values[f.id] === undefined || r.values[f.id] === '' ? null : (
                  <span key={f.id} title={f.name} className={`m-${f.type}`}>
                    {f.type === 'checkbox' ? (r.values[f.id] ? `✓ ${f.name}` : null) : <Show ds={c.ds} f={f} v={r.values[f.id]} />}
                  </span>
                ),
              )}
            </div>
          </article>
        )
      })}
      {c.live && (
        <button className="dv-gcard dv-gadd" onClick={add}>
          + New
        </button>
      )}
      {!records.length && !c.live && <p className="muted">No records</p>}
    </div>
  )
}

// ----- the widget -------------------------------------------------------------------------

const VIEW_ICON: Record<DataViewType, ReactNode> = {
  table: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 3h12v10H2zM2 6.5h12M6 6.5V13" />
    </svg>
  ),
  board: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 3h3.5v8H2zM6.25 3h3.5v5h-3.5zM10.5 3H14v10h-3.5z" />
    </svg>
  ),
  timeline: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4h7M5 8h8M3 12h6" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.5h11v10h-11zM2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </svg>
  ),
  gallery: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 2.5h5v5H2zM9 2.5h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" />
    </svg>
  ),
}

export function DataViewWidget({ item, live, editingTitle }: { item: Item; live: boolean; editingTitle: boolean }) {
  const editor = useContext(EditorContext)!
  const view = item.view!
  const ds = D.getDataset(editor.board, view.dataset)
  const [open, setOpen] = useState<string | null>(null)
  const [menu, setMenu] = useState<'views' | 'fields' | null>(null)
  if (!ds) return null
  const c: Ctx = {
    item,
    ds,
    view,
    live: live && !editor.readOnly,
    edit: (f) => editor.updateDataset(ds.id, f),
    setView: (f) => editor.updateView(item.id, f),
    openRecord: setOpen,
    editable: !editor.readOnly,
    select: () => editor.select([item.id]),
  }
  const others = D.viewsOf(editor.board, ds.id).length - 1
  const hidden = (view.hidden ?? []).filter((id) => D.fieldById(ds, id))
  const groupable = ds.fields.filter((f) => f.type === 'select' || f.type === 'person')
  const dates = ds.fields.filter((f) => f.type === 'date')
  const { start, end } = D.dateFields(ds, view)

  const actions = (
    <>
      <div className="dv-tabs" role="tablist" aria-label="View">
        {D.VIEW_TYPES.map((t) => (
          <button key={t.type} role="tab" aria-selected={view.type === t.type} className={view.type === t.type ? 'on' : ''} title={t.label} onClick={() => c.setView((v) => ({ ...v, type: t.type }))}>
            {VIEW_ICON[t.type]}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <span className="sep" />
      <button title="Show the same records in another view, next to this one" onClick={() => setMenu('views')}>
        + View
      </button>
      {menu === 'views' && (
        <Menu
          onClose={() => setMenu(null)}
          items={D.VIEW_TYPES.map((t) => [`${t.label} of ${ds.name}`, () => editor.addDataView(item.id, t.type)] as [string, () => void])}
        />
      )}
      {hidden.length > 0 && (
        <button onClick={() => setMenu('fields')} title="Fields hidden in this view">
          Hidden ({hidden.length})
        </button>
      )}
      {menu === 'fields' && (
        <Menu
          onClose={() => setMenu(null)}
          items={[
            ...hidden.map((id) => [`Show ${D.fieldById(ds, id)!.name}`, () => c.setView((v) => ({ ...v, hidden: v.hidden?.filter((h) => h !== id) }))] as [string, () => void]),
            null,
            ['Show all', () => c.setView((v) => ({ ...v, hidden: [] }))],
          ]}
        />
      )}
      <button
        title="Copy as CSV (what's shown)"
        onClick={() =>
          navigator.clipboard?.writeText(D.toCsv(ds, view)).then(
            () => editor.setStatus('Copied as CSV'),
            () => editor.setStatus('Clipboard unavailable'),
          )
        }
      >
        CSV
      </button>
    </>
  )

  const shown = D.viewRecords(ds, view).length
  return (
    <Widget item={item} live={live} editingTitle={editingTitle} actions={actions}>
      <div className="dv-bar">
        <span className="dv-source" title={others ? `${others + 1} views show these records` : 'Add a view to see these records another way'}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <ellipse cx="8" cy="4" rx="5" ry="2" />
            <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
          </svg>
          {ds.name}
          {others > 0 && <em>linked · {others + 1} views</em>}
        </span>
        {c.live ? (
          <input
            className="dv-search"
            placeholder="Search records"
            aria-label="Search records"
            value={view.query ?? ''}
            onChange={(e) => {
              const q = e.target.value
              c.setView((v) => ({ ...v, query: q }))
            }}
          />
        ) : (
          view.query && <span className="muted">Search: “{view.query}”</span>
        )}
        {view.type === 'board' && c.live && groupable.length > 1 && (
          <label className="dv-pick">
            Group by
            <select value={D.groupField(ds, view)?.id} onChange={(e) => c.setView((v) => ({ ...v, groupBy: e.target.value }))}>
              {groupable.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {view.type === 'calendar' && c.live && dates.length > 1 && (
          <label className="dv-pick">
            Date
            <select value={start?.id} onChange={(e) => c.setView((v) => ({ ...v, start: e.target.value }))}>
              {dates.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {view.type === 'timeline' && c.live && dates.length > 0 && (
          <label className="dv-pick">
            Dates
            <select value={start?.id} onChange={(e) => c.setView((v) => ({ ...v, start: e.target.value }))}>
              {dates.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            →
            <select value={end?.id ?? ''} onChange={(e) => c.setView((v) => ({ ...v, end: e.target.value || undefined }))}>
              <option value="">(one day)</option>
              {dates
                .filter((f) => f.id !== start?.id)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {view.sort && (
          <span className="dv-sorted">
            {D.fieldById(ds, view.sort.field)?.name} {view.sort.dir === 'asc' ? '↑' : '↓'}
            {c.live && (
              <button className="link" onClick={() => c.setView((v) => ({ ...v, sort: undefined }))}>
                clear
              </button>
            )}
          </span>
        )}
        <span className="dv-count muted">
          {shown === ds.records.length ? `${shown} record${shown === 1 ? '' : 's'}` : `${shown} of ${ds.records.length}`}
        </span>
      </div>
      <div className="dv-scroll">
        {view.type === 'table' && <TableBody c={c} />}
        {view.type === 'board' && <BoardBody c={c} />}
        {view.type === 'timeline' && <TimelineBody c={c} width={item.w} />}
        {view.type === 'calendar' && <CalendarBody c={c} />}
        {view.type === 'gallery' && <GalleryBody c={c} />}
      </div>
      {open && <RecordPage c={c} id={open} onClose={() => setOpen(null)} />}
    </Widget>
  )
}

