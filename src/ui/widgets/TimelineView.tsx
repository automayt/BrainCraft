import { textOn } from '../paint'
import { type PointerEvent, useContext, useRef, useState } from 'react'
import * as TL from '../../model/timeline'
import { BRANCHES, type Item, type TimelineData } from '../../model/types'
import { EditorContext } from '../useEditor'
import { Menu, Widget } from './Widget'

const LABEL_W = 130
const ROW_H = 30
const LANE_PAD = 8

interface Drag {
  entry: TL.ShownEntry
  edge?: 'start' | 'end'
  pointer: number
  startX: number
  pxPerDay: number
  days: number
}

export function TimelineView({ item, live, editingTitle }: { item: Item; live: boolean; editingTitle: boolean }) {
  const editor = useContext(EditorContext)!
  const t = item.timeline!
  const now = TL.today()
  const shown = TL.shownTimeline(editor.board, t, now)
  const range = TL.visibleRange(t, shown.entries, now)
  const days = range.end - range.start
  const trackW = Math.max(100, item.w - LABEL_W - 2)
  const pxPerDay = trackW / days
  const x = (iso: string) => (TL.toDay(iso) - range.start) * pxPerDay
  const rows = TL.packRows(shown.entries, Math.ceil(110 / pxPerDay))
  const laneRows = (lane: string) => Math.max(1, ...shown.entries.filter((e) => e.lane === lane).map((e) => (rows.get(e.id) ?? 0) + 1))
  const update = (f: (t: TimelineData) => TimelineData) => editor.updateTimeline(item.id, f)
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [laneMenu, setLaneMenu] = useState<string | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const kanbans = TL.kanbanBoards(editor.board)

  const startDrag = (e: PointerEvent, entry: TL.ShownEntry, edge?: 'start' | 'end') => {
    if (editor.readOnly || e.button !== 0) return
    // Bars drag on the first press, even before the timeline is selected.
    e.stopPropagation()
    if (!live) editor.select([item.id])
    setSelected(entry.id)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    // Measure on screen so this works at any canvas zoom.
    const track = (e.currentTarget as Element).closest('.tl-track')!.getBoundingClientRect()
    const d = { entry, edge, pointer: e.pointerId, startX: e.clientX, pxPerDay: track.width / days, days: 0 }
    dragRef.current = d
    setDrag(d)
  }
  const moveDrag = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    const next = { ...d, days: Math.round((e.clientX - d.startX) / d.pxPerDay) }
    dragRef.current = next
    setDrag(next)
  }
  const endDrag = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    dragRef.current = null
    setDrag(null)
    if (d.days) editor.shiftTimelineEntry(item.id, d.entry, d.days, d.edge)
  }

  /** Dates of an entry, previewing an in-progress drag. */
  const datesOf = (e: TL.ShownEntry) => (drag && drag.entry.id === e.id ? TL.shiftDates(e, drag.days, drag.edge) : e)

  const addAt = (lane: string, day: number, milestone = false) => {
    const own = t.lanes.find((l) => l.id === lane) ?? t.lanes[0]
    if (!own) {
      update((x) => {
        const [withLane, id] = TL.addLane(x, 'Events')
        return TL.addEntry(withLane, { lane: id, title: 'New event', start: TL.fromDay(day), ...(milestone ? {} : { end: TL.fromDay(day + 3) }), color: BRANCHES[0][1] })[0]
      })
      return
    }
    let newId = ''
    update((x) => {
      const [next, id] = TL.addEntry(x, {
        lane: own.id,
        title: milestone ? 'Milestone' : 'New event',
        start: TL.fromDay(day),
        ...(milestone ? {} : { end: TL.fromDay(day + 3) }),
        color: BRANCHES[x.entries.length % BRANCHES.length][1],
      })
      newId = id
      return next
    })
    setSelected(newId)
    setRenaming(newId)
  }

  const sel = shown.entries.find((e) => e.id === selected)
  const actions = (
    <>
      <button title="Add an event starting today" onClick={() => addAt(t.lanes[0]?.id ?? '', now)}>
        + Event
      </button>
      <button title="Add a milestone today" onClick={() => addAt(t.lanes[0]?.id ?? '', now, true)}>
        + Milestone
      </button>
      <button title="Add a lane" onClick={() => update((x) => TL.addLane(x)[0])}>
        + Lane
      </button>
      <span className="sep" />
      <button title="Earlier" onClick={() => update((x) => ({ ...x, range: TL.panRange(range, -Math.max(1, Math.round(days / 4))) }))}>
        ‹
      </button>
      <button title="Zoom in" onClick={() => update((x) => ({ ...x, range: TL.zoomRange(range, 0.6) }))}>
        +
      </button>
      <button title="Zoom out" onClick={() => update((x) => ({ ...x, range: TL.zoomRange(range, 1.6) }))}>
        −
      </button>
      <button title="Later" onClick={() => update((x) => ({ ...x, range: TL.panRange(range, Math.max(1, Math.round(days / 4))) }))}>
        ›
      </button>
      <button title="Fit to the events" onClick={() => update((x) => ({ ...x, range: undefined }))}>
        Fit
      </button>
      <span className="sep" />
      <button className={t.sources?.length ? 'on' : ''} title="Show dated cards from Kanban boards" onClick={() => setSourcesOpen(!sourcesOpen)}>
        Kanban{t.sources?.length ? ` (${t.sources.length})` : ''}
      </button>
      {sourcesOpen && (
        <>
          <div className="menu-scrim" onPointerDown={() => setSourcesOpen(false)} />
          <div className="widget-menu sources">
            {kanbans.length === 0 && <p className="muted">Add a Kanban board (K) and give its cards dates — they'll show up here.</p>}
            {kanbans.map((kb) => (
              <label key={kb.id}>
                <input type="checkbox" checked={t.sources?.includes(kb.id) ?? false} onChange={() => update((x) => TL.toggleSource(x, kb.id))} />
                {kb.text || 'Kanban board'}
              </label>
            ))}
          </div>
        </>
      )}
    </>
  )

  const todayX = (now - range.start) * pxPerDay
  return (
    <Widget item={item} live={live} editingTitle={editingTitle} actions={actions}>
      <div
        className="timeline"
        tabIndex={live ? 0 : -1}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !sel.source && !(e.target as Element).closest('input')) {
            e.stopPropagation()
            e.preventDefault()
            update((x) => TL.deleteEntry(x, sel.id))
            setSelected(null)
          }
        }}
      >
        <div className="tl-axis" style={{ paddingLeft: LABEL_W }}>
          {TL.ticks(range.start, range.end, pxPerDay).map((tick) => (
            <span key={tick.day} className={`tl-tick${tick.major ? ' major' : ''}`} style={{ left: LABEL_W + (tick.day - range.start) * pxPerDay }}>
              {tick.label}
            </span>
          ))}
        </div>
        <div className="tl-lanes">
          {todayX >= 0 && todayX <= trackW && (
            <div className="tl-today" style={{ left: LABEL_W + todayX }}>
              <span>Today</span>
            </div>
          )}
          {shown.lanes.map((lane) => (
            <div key={lane.id} className={`tl-lane${lane.linked ? ' linked' : ''}`} style={{ height: laneRows(lane.id) * ROW_H + LANE_PAD * 2 }}>
              <div className="tl-label" style={{ width: LABEL_W }}>
                {live && !lane.linked ? (
                  <input
                    defaultValue={lane.name}
                    key={lane.name}
                    aria-label="Lane name"
                    onBlur={(e) => e.target.value !== lane.name && update((x) => TL.renameLane(x, lane.id, e.target.value || lane.name))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span title={lane.linked ? 'Cards from a Kanban board' : undefined}>{lane.name}</span>
                )}
                {live && !lane.linked && (
                  <button className="more" title="Lane options" onClick={() => setLaneMenu(lane.id)}>
                    ⋯
                  </button>
                )}
                {laneMenu === lane.id && (
                  <Menu
                    onClose={() => setLaneMenu(null)}
                    items={[
                      ['Add event here today', () => addAt(lane.id, now)],
                      ['Add milestone here today', () => addAt(lane.id, now, true)],
                      null,
                      ['Delete lane and its events', () => update((x) => TL.deleteLane(x, lane.id))],
                    ]}
                  />
                )}
              </div>
              <div
                className="tl-track"
                style={{ width: trackW }}
                onPointerDown={() => setSelected(null)}
                onDoubleClick={(e) => {
                  if (!live || lane.linked || (e.target as Element).closest('.tl-entry')) return
                  const r = e.currentTarget.getBoundingClientRect()
                  addAt(lane.id, range.start + Math.floor(((e.clientX - r.left) / r.width) * days))
                }}
              >
                {shown.entries
                  .filter((e) => e.lane === lane.id)
                  .map((entry) => {
                    const d = datesOf(entry)
                    const left = x(d.start)
                    const top = LANE_PAD + (rows.get(entry.id) ?? 0) * ROW_H
                    const milestone = !d.end
                    const cls = `tl-entry${milestone ? ' milestone' : ''}${selected === entry.id ? ' selected' : ''}${entry.overdue ? ' overdue' : ''}${entry.done ? ' done' : ''}`
                    const title = `${entry.title} · ${d.start}${d.end ? ` → ${d.end}` : ''}${entry.source ? ' (Kanban card)' : ''}${entry.overdue ? ' · overdue' : ''}`
                    if (renaming === entry.id && !entry.source)
                      return (
                        <input
                          key={entry.id}
                          className="tl-rename"
                          autoFocus
                          style={{ left: Math.max(0, left), top }}
                          defaultValue={entry.title}
                          onFocus={(e) => e.target.select()}
                          onBlur={(e) => {
                            setRenaming(null)
                            if (e.target.value !== entry.title) update((x) => TL.updateEntry(x, entry.id, { title: e.target.value || entry.title }))
                          }}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && (e.target as HTMLInputElement).blur()}
                        />
                      )
                    return (
                      <div
                        key={entry.id}
                        className={cls}
                        title={title}
                        style={
                          milestone
                            ? { left: left - 8, top, ['--c' as string]: entry.color }
                            : { left, top, width: Math.max(6, x(d.end!) - left), background: entry.color, color: textOn(entry.color) }
                        }
                        onPointerDown={(e) => startDrag(e, entry)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onDoubleClick={() => live && !entry.source && setRenaming(entry.id)}
                      >
                        {milestone ? <i className="diamond" /> : null}
                        <span>{entry.title}</span>
                        {!milestone && live && (
                          <>
                            <b className="grip start" onPointerDown={(e) => startDrag(e, entry, 'start')} onPointerMove={moveDrag} onPointerUp={endDrag} />
                            <b className="grip end" onPointerDown={(e) => startDrag(e, entry, 'end')} onPointerMove={moveDrag} onPointerUp={endDrag} />
                          </>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
          {shown.lanes.length === 0 && <p className="muted tl-empty">Add a lane to start.</p>}
        </div>
        {live && sel && !sel.source && (
          <div className="tl-selected">
            <strong>{sel.title}</strong>
            <span className="muted">
              {sel.start}
              {sel.end ? ` → ${sel.end}` : ' (milestone)'}
            </span>
            <span className="swatches">
              {BRANCHES.map(([name, color]) => (
                <button key={color} className={`swatch${sel.color === color ? ' active' : ''}`} style={{ background: color }} title={name} onClick={() => update((x) => TL.updateEntry(x, sel.id, { color }))} />
              ))}
            </span>
            <button onClick={() => update((x) => TL.updateEntry(x, sel.id, sel.end ? { end: undefined } : { end: TL.fromDay(TL.toDay(sel.start) + 3) }))}>
              {sel.end ? 'Make milestone' : 'Make span'}
            </button>
            <button onClick={() => setRenaming(sel.id)}>Rename</button>
            <button
              className="danger"
              onClick={() => {
                update((x) => TL.deleteEntry(x, sel.id))
                setSelected(null)
              }}
            >
              Delete
            </button>
          </div>
        )}
        {live && sel?.source && <div className="tl-selected muted">Drag to reschedule this Kanban card · edit it on its board</div>}
      </div>
    </Widget>
  )
}
