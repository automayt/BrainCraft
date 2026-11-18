import { textOn } from '../paint'
import { type PointerEvent, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import * as TL from '../../model/timeline'
import * as TH from '../../model/timelineHours'
import { BRANCHES, type Item, type TimelineData, type TimelineEntry, type TimelineLane } from '../../model/types'
import { Rough } from '../roughShapes'
import { EditorContext } from '../useEditor'
import { Menu, Widget } from './Widget'

/** "19 Oct", the way people say dates (the year only when it isn't this one). */
const friendly = (iso: string) => {
  const d = new Date(`${iso}T00:00`)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

/** A shade of a colour, for a hand-drawn bar's outline and pencil hatch. */
const shade = (hex: string, k: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const c = (s: number) => Math.round(((n >> s) & 255) * k)
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`
}

/** A wobble of its own for each bar, the same every time it's drawn. */
const seedOf = (id: string) => {
  let h = 7
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) % 1_000_003
  return h
}

/** Within this many pixels of the edge (on screen), a drag takes the days in view along with it. */
const EDGE = 26
/** A press that moves less than this is a click, not the start of a span. */
const SLOP = 4

/** A bar being moved, or stretched by one of its ends. */
interface Drag {
  entry: TL.ShownEntry
  edge?: 'start' | 'end'
  pointer: number
  /** The day under the pointer when it was pressed, and how far down the screen. */
  grabDay: number
  grabY: number
  /** How far it has gone: whole days, and the lane it's over when that isn't its own. */
  days: number
  lane?: string
  /** How far it has gone down the screen, to follow the pointer between lanes (in the timeline's own pixels). */
  dy: number
}

/** A new span being drawn across a lane. */
interface Draw {
  lane: string
  pointer: number
  startX: number
  from: number
  to: number
  moved: boolean
}

/** A number of hours typed into a box: nothing when it's empty or isn't one. */
const typedHours = (s: string): number | undefined => {
  const n = Number(s.trim().replace(',', '.'))
  return s.trim() && Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * A small box for a number of hours, kept when it's left or Enter is pressed; Escape puts back what
 * it said. What's typed is kept even if the box goes away first (another span picked, its menu
 * closed): it belongs to what it was typed for, so give each thing's box its own `key`.
 */
function HoursBox({ value, label, onSet, placeholder, wide }: { value: number | undefined; label: string; onSet: (v: number | undefined) => void; placeholder?: string; wide?: boolean }) {
  /** What's been typed and not yet kept. */
  const typed = useRef<string | null>(null)
  const latest = useRef({ value, onSet })
  latest.current = { value, onSet }
  const keep = () => {
    const text = typed.current
    typed.current = null
    if (text === null) return
    const next = typedHours(text)
    if (next !== latest.current.value) latest.current.onSet(next)
  }
  useEffect(() => keep, [])
  return (
    <input
      className={`tl-num${wide ? ' wide' : ''}`}
      inputMode="decimal"
      aria-label={label}
      title={label}
      placeholder={placeholder ?? '–'}
      defaultValue={value === undefined ? '' : String(value)}
      key={String(value)}
      onChange={(e) => (typed.current = e.target.value)}
      onBlur={keep}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          typed.current = null
          ;(e.target as HTMLInputElement).value = value === undefined ? '' : String(value)
        }
        if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/** Leaves whatever box is being typed in, so what's in it is kept before the thing it's about changes or its menu closes. */
const leaveBox = () => {
  const a = document.activeElement
  if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement) a.blur()
}

export function TimelineView({ item, live, editingTitle }: { item: Item; live: boolean; editingTitle: boolean }) {
  const editor = useContext(EditorContext)!
  const t = item.timeline!
  const now = TL.today()
  const hand = !!item.sketch
  const hours = TH.tracksTime(t)
  /** The days in view while they're being dragged along or zoomed: kept here until it's let go, then saved. */
  const [view, setView] = useState<{ start: number; end: number } | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const L = TL.timelineLayout(editor.board, t, item.w, now, view ?? undefined)
  const { shown, range, days, labelW, trackW, pxPerDay, rows } = L
  const laneAt = new Map(L.lanes.map((l) => [l.id, l]))
  const x = (iso: string) => (TL.toDay(iso) - range.start) * pxPerDay
  const update = (f: (t: TimelineData) => TimelineData) => editor.updateTimeline(item.id, f)
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [laneMenu, setLaneMenu] = useState<string | null>(null)
  const [laneHours, setLaneHours] = useState<string | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [waitMenu, setWaitMenu] = useState(false)
  const deps = TL.dependencies(t)
  const late = new Set(deps.filter((d) => d.late).map((d) => d.to))
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const drawRef = useRef<Draw | null>(null)
  const [draw, setDraw] = useState<Draw | null>(null)
  const kanbans = TL.kanbanBoards(editor.board)
  /** The Kanban boards it shows the cards of that are still on the board. */
  const following = (t.sources ?? []).filter((s) => kanbans.some((k) => k.id === s)).length
  const body = useRef<HTMLDivElement>(null)
  const axis = useRef<HTMLDivElement>(null)
  /** Where the pointer last was, for carrying the view along while it's held at the edge. */
  const last = useRef<{ x: number; y: number } | null>(null)
  const totals = hours ? TH.timelineHours(t, now) : null

  /** The strip the bars are on, as it is on screen (at any zoom of the board). */
  const trackRect = () => body.current?.querySelector('.tl-track')?.getBoundingClientRect() ?? null
  /** The day (and how far through it) under a place on screen. */
  const dayAt = (clientX: number, r = viewRef.current ?? range): number => {
    const box = trackRect()
    if (!box || !box.width) return r.start
    return r.start + ((clientX - box.left) / box.width) * (r.end - r.start)
  }
  /** One of the timeline's own lanes under a place on screen. */
  const laneUnder = (clientX: number, clientY: number): string | undefined => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      // The bar being carried is under the pointer too, and still in the lane it came from.
      if ((el as HTMLElement).closest?.('.tl-entry')) continue
      const lane = (el as HTMLElement).closest?.('.tl-lane')
      if (lane && body.current?.contains(lane)) {
        const id = lane.getAttribute('data-lane') ?? ''
        return t.lanes.some((l) => l.id === id) ? id : undefined
      }
    }
    return undefined
  }

  // ----- moving and stretching a bar ---------------------------------------------------

  const follow = (clientX: number, clientY: number) => {
    const d = dragRef.current
    if (!d) return
    const box = trackRect()
    const scale = box && box.width ? trackW / box.width : 1
    const next: Drag = {
      ...d,
      days: Math.round(dayAt(clientX) - d.grabDay),
      // Only a whole bar of the timeline's own changes lanes.
      lane: d.edge || d.entry.source ? undefined : laneUnder(clientX, clientY),
      dy: d.edge || d.entry.source ? 0 : (clientY - d.grabY) * scale,
    }
    dragRef.current = next
    setDrag(next)
  }

  const startDrag = (e: PointerEvent, entry: TL.ShownEntry, edge?: 'start' | 'end') => {
    if (editor.readOnly || e.button !== 0) return
    // Bars drag on the first press, even before the timeline is selected.
    e.stopPropagation()
    if (!live) editor.select([item.id])
    leaveBox()
    setSelected(entry.id)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    last.current = { x: e.clientX, y: e.clientY }
    const d: Drag = { entry, edge, pointer: e.pointerId, grabDay: dayAt(e.clientX), grabY: e.clientY, days: 0, dy: 0 }
    dragRef.current = d
    setDrag(d)
  }
  const moveDrag = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    last.current = { x: e.clientX, y: e.clientY }
    follow(e.clientX, e.clientY)
  }
  const endDrag = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointer !== e.pointerId) return
    dragRef.current = null
    last.current = null
    setDrag(null)
    const went = viewRef.current
    setView(null)
    // A timeline that fits its entries goes on fitting them; one with days of its own keeps where it was taken to.
    editor.placeTimelineEntry(item.id, d.entry, d.days, d.edge, d.lane, went && t.range ? TL.rangeDays(went) : undefined)
  }

  // While a bar (or a new span) is held at the edge, the days in view go along with it, so it
  // can be taken past what was showing.
  const held = !!drag || !!draw?.moved
  useEffect(() => {
    if (!held) return
    const timer = setInterval(() => {
      const at = last.current
      const box = trackRect()
      if (!at || !box) return
      const dir = at.x > box.right - EDGE ? 1 : at.x < box.left + EDGE ? -1 : 0
      if (!dir) return
      const r = viewRef.current ?? range
      const step = Math.max(1, Math.round((r.end - r.start) / 45)) * dir
      const next = { start: r.start + step, end: r.end + step }
      viewRef.current = next
      setView(next)
      if (dragRef.current) follow(at.x, at.y)
      else if (drawRef.current) drawTo(at.x)
    }, 90)
    return () => clearInterval(timer)
    // Only while something is held; what it reads is in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held])

  /** Dates and lane of an entry, previewing a drag in progress. */
  const datesOf = (e: TL.ShownEntry) => (drag && drag.entry.id === e.id ? TL.shiftDates(e, drag.days, drag.edge) : e)

  // ----- drawing a new span --------------------------------------------------------------

  const drawTo = (clientX: number) => {
    const d = drawRef.current
    if (!d) return
    const next = { ...d, to: Math.floor(dayAt(clientX)), moved: d.moved || Math.abs(clientX - d.startX) >= SLOP }
    drawRef.current = next
    setDraw(next)
  }
  const startDraw = (e: PointerEvent, lane: string) => {
    leaveBox()
    setSelected(null)
    if (!live || editor.readOnly || e.button !== 0 || (e.target as Element).closest('.tl-entry, .tl-rename')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = { x: e.clientX, y: e.clientY }
    const day = Math.floor(dayAt(e.clientX))
    const d: Draw = { lane, pointer: e.pointerId, startX: e.clientX, from: day, to: day, moved: false }
    drawRef.current = d
    setDraw(d)
  }
  const moveDraw = (e: PointerEvent) => {
    if (drawRef.current?.pointer !== e.pointerId) return
    last.current = { x: e.clientX, y: e.clientY }
    drawTo(e.clientX)
  }
  const endDraw = (e: PointerEvent) => {
    const d = drawRef.current
    if (!d || d.pointer !== e.pointerId) return
    drawRef.current = null
    last.current = null
    setDraw(null)
    const went = viewRef.current
    setView(null)
    if (!d.moved) return
    const from = Math.min(d.from, d.to)
    const to = Math.max(d.from, d.to)
    let made = ''
    update((x) => {
      const [next, id] = TL.addEntry(x, { lane: d.lane, title: 'New span', start: TL.fromDay(from), end: TL.fromDay(to), color: BRANCHES[x.entries.length % BRANCHES.length][1] })
      made = id
      return went && x.range ? { ...next, range: TL.rangeDays(went) } : next
    })
    setSelected(made)
    setRenaming(made)
  }

  // ----- moving through time with the mouse: drag the dates, or turn the wheel over them ------

  const pan = useRef<{ pointer: number; startX: number; from: { start: number; end: number }; scale: number } | null>(null)
  const startPan = (e: PointerEvent) => {
    if (!live || editor.readOnly || e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const box = trackRect()
    pan.current = { pointer: e.pointerId, startX: e.clientX, from: range, scale: box && box.width ? days / box.width : 1 / pxPerDay }
  }
  const movePan = (e: PointerEvent) => {
    const p = pan.current
    if (!p || p.pointer !== e.pointerId) return
    const by = Math.round((p.startX - e.clientX) * p.scale)
    setView(by ? { start: p.from.start + by, end: p.from.end + by } : null)
  }
  const endPan = (e: PointerEvent) => {
    const p = pan.current
    if (!p || p.pointer !== e.pointerId) return
    pan.current = null
    const went = viewRef.current
    setView(null)
    if (went && (went.start !== p.from.start || went.end !== p.from.end)) update((x) => ({ ...x, range: TL.rangeDays(went) }))
  }

  // The wheel over the dates zooms time about the day under the pointer (everywhere else on the
  // timeline it's the board's, as on any object). Saved once the wheel rests, as one step.
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ range, update })
  latest.current = { range, update }
  useEffect(() => {
    const el = axis.current
    if (!el || !live || editor.readOnly) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || !e.deltaY) return
      e.preventDefault()
      e.stopPropagation()
      const r = viewRef.current ?? latest.current.range
      const next = TL.zoomAbout(r, dayAt(e.clientX, r), e.deltaY > 0 ? 1.18 : 1 / 1.18)
      viewRef.current = next
      setView(next)
      if (settle.current) clearTimeout(settle.current)
      settle.current = setTimeout(() => {
        const went = viewRef.current
        settle.current = null
        if (!went) return
        setView(null)
        latest.current.update((x) => ({ ...x, range: TL.rangeDays(went) }))
      }, 350)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (settle.current) clearTimeout(settle.current)
    }
    // dayAt reads the screen and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, editor.readOnly])

  // ----- adding things ---------------------------------------------------------------------

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
  const addLane = () => {
    let made = ''
    update((x) => {
      const [next, id] = TL.addLane(x, hours ? 'New person' : 'New lane')
      made = id
      return next
    })
    setNaming(made)
  }

  const sel = shown.entries.find((e) => e.id === selected)
  const own = sel && !sel.source ? t.entries.find((e) => e.id === sel.id) : undefined
  const actions = (
    <>
      <button title="Add an event starting today" onClick={() => addAt(t.lanes[0]?.id ?? '', now)}>
        + Event
      </button>
      <button title="Add a milestone today" onClick={() => addAt(t.lanes[0]?.id ?? '', now, true)}>
        + Milestone
      </button>
      <button title="Add a lane" onClick={addLane}>
        + Lane
      </button>
      <span className="sep" />
      <button title="Earlier (or drag the dates)" aria-label="Earlier" onClick={() => update((x) => ({ ...x, range: TL.panRange(range, -Math.max(1, Math.round(days / 4))) }))}>
        ‹
      </button>
      <button title="Later (or drag the dates)" aria-label="Later" onClick={() => update((x) => ({ ...x, range: TL.panRange(range, Math.max(1, Math.round(days / 4))) }))}>
        ›
      </button>
      <button title="Zoom out (or turn the wheel over the dates)" aria-label="Zoom out" onClick={() => update((x) => ({ ...x, range: TL.zoomRange(range, 1.6) }))}>
        −
      </button>
      <button title="Zoom in (or turn the wheel over the dates)" aria-label="Zoom in" onClick={() => update((x) => ({ ...x, range: TL.zoomRange(range, 0.6) }))}>
        +
      </button>
      <button title="Fit to the events" onClick={() => update((x) => ({ ...x, range: undefined }))}>
        Fit
      </button>
      <span className="sep" />
      {late.size > 0 && (
        <button className="tl-lineup" title="Move events so each starts after what it waits for" onClick={() => update((x) => TL.lineUp(x))}>
          Line up ({late.size})
        </button>
      )}
      <button
        className={hours ? 'on' : ''}
        aria-pressed={hours}
        title={
          hours
            ? 'This timeline manages time: hours planned and spent on each span, what each lane has, and a budget'
            : 'Manage time here: give spans hours, say how many hours a week each lane has, and set a budget'
        }
        onClick={() => (hours ? setBudgetOpen(!budgetOpen) : update((x) => ({ ...x, time: true as const })))}
      >
        Hours{t.budget ? ` (${TH.formatHours(t.budget.hours)}${t.budget.per ? ` a ${t.budget.per}` : ''})` : ''}
      </button>
      {budgetOpen && (
        <>
          <div
            className="menu-scrim"
            onPointerDown={() => {
              leaveBox()
              setBudgetOpen(false)
            }}
          />
          <div className="widget-menu tl-budget">
            <label>
              Budget
              <HoursBox value={t.budget?.hours} label="Budget in hours" placeholder="none" wide onSet={(v) => update((x) => TL.withBudget(x, v === undefined ? undefined : { hours: v, ...(x.budget?.per ? { per: x.budget.per } : {}) }))} />
              <span>h</span>
              <select
                aria-label="What the budget covers"
                value={t.budget?.per ?? ''}
                disabled={!t.budget}
                onChange={(e) => update((x) => (x.budget ? TL.withBudget(x, { hours: x.budget.hours, ...(e.target.value ? { per: e.target.value as 'week' | 'month' } : {}) }) : x))}
              >
                <option value="">in all</option>
                <option value="week">a week</option>
                <option value="month">a month</option>
              </select>
            </label>
            <p className="muted">In all for a fixed amount of work; a week or a month for a retainer. Leave it empty for none.</p>
            <label>
              Money sign
              <input
                className="tl-num"
                aria-label="Money sign"
                placeholder="$"
                maxLength={4}
                defaultValue={t.currency ?? ''}
                key={t.currency ?? ''}
                onBlur={(e) => e.target.value.trim() !== (t.currency ?? '') && update((x) => TL.withCurrency(x, e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            </label>
            <p className="muted">Each lane’s hours a week, budget and hourly rate are under its ⋯.</p>
            <button
              onClick={() => {
                setBudgetOpen(false)
                update((x) => TL.withoutHours(x))
              }}
            >
              Stop showing hours
            </button>
          </div>
        </>
      )}
      <button className={following ? 'on' : ''} title="Show the dated cards of this board’s Kanban boards here, each board in a lane of its own" onClick={() => setSourcesOpen(!sourcesOpen)}>
        Kanban cards{following ? ` (${following})` : ''}
      </button>
      {sourcesOpen && (
        <>
          <div className="menu-scrim" onPointerDown={() => setSourcesOpen(false)} />
          <div className="widget-menu sources">
            <strong>Show cards from</strong>
            {kanbans.length === 0 && <p className="muted">There’s no Kanban board on this board yet. Add one (K) and give its cards dates: tick it here and they show in a lane of their own, moving as the cards do.</p>}
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

  // Where each bar sits, for the dependency arrows.
  const barY = (e: TL.ShownEntry) => (laneAt.get(e.lane)?.top ?? 0) + TL.LANE_PAD + (rows.get(e.id) ?? 0) * TL.ROW_H + 12
  /** A bar's right edge: the end of its last day (a milestone is a point). */
  const endX = (d: { start: string; end?: string }) => (d.end ? x(d.end) + pxPerDay : x(d.start))
  const byId = new Map(shown.entries.map((e) => [e.id, e]))
  const arrows = deps.flatMap((d) => {
    const a = byId.get(d.from)
    const z = byId.get(d.to)
    if (!a || !z) return []
    const da = datesOf(a)
    const dz = datesOf(z)
    const x0 = labelW + endX(da) + (da.end ? 0 : 8)
    const x1 = labelW + x(dz.start) - (dz.end ? 2 : 10)
    const y0 = barY(a)
    const y1 = barY(z)
    const bend = Math.max(14, Math.min(40, Math.abs(x1 - x0) / 2))
    const lateNow = TL.toDay(dz.start) <= TL.toDay(da.end ?? da.start) && (!!da.end || TL.toDay(dz.start) < TL.toDay(da.start))
    return [{ key: `${d.from}>${d.to}`, d: `M${x0} ${y0}C${x0 + bend} ${y0} ${x1 - bend} ${y1} ${x1} ${y1}`, late: lateNow }]
  })
  const ownOthers = sel && !sel.source ? t.entries.filter((e) => e.id !== sel.id && (sel.after?.includes(e.id) || !TL.wouldLoop(t, e.id, sel.id))) : []
  const patch = (p: Partial<TimelineEntry>) => sel && update((x) => TL.updateEntry(x, sel.id, p))

  /** What a lane adds up to, under its name. */
  const laneFigures = (lane: TimelineLane): ReactNode => {
    const h = totals?.lanes.find((l) => l.lane === lane.id)
    if (!h) return null
    const over = lane.capacity !== undefined ? TH.overloaded(t, lane) : []
    return (
      <small
        className={`tl-figures${h.standing === 'over' || over.length ? ' over' : h.standing === 'near' ? ' near' : ''}`}
        title={[
          `Planned ${TH.formatHours(h.planned)}${h.tentative ? `, and ${TH.formatHours(h.tentative)} not settled` : ''}`,
          h.spent ? `Spent ${TH.formatHours(h.spent)}` : '',
          lane.capacity !== undefined ? `Has ${TH.formatHours(lane.capacity)} a week` : '',
          lane.budget !== undefined ? `Budget ${TH.formatHours(lane.budget)}: ${h.left! < 0 ? `${TH.formatHours(-h.left!)} over` : `${TH.formatHours(h.left!)} left`}` : '',
          h.cost ? `Costs ${TH.formatMoney(h.cost.planned, t.currency)}` : '',
          over.length ? `More than it has in ${over.length === 1 ? `the week of ${TH.shortDay(over[0].from)}` : `${over.length} weeks`}` : '',
        ]
          .filter(Boolean)
          .join('\n')}
      >
        {TH.formatHours(h.planned)}
        {lane.budget !== undefined ? ` of ${TH.formatHours(lane.budget)}` : ''}
        {h.spent ? ` · ${TH.formatHours(h.spent)} spent` : ''}
      </small>
    )
  }

  /** What it all adds up to, along the foot. */
  const summary = (): ReactNode => {
    if (!totals) return <span className="muted">Drag across a lane to add a span · drag a span to move it, its ends to stretch it · drag the dates to move through time</span>
    const b = totals.budget
    return (
      <>
        <span>
          Planned <b>{TH.formatHours(totals.planned)}</b>
        </span>
        {totals.tentative > 0 && <span className="muted">+ {TH.formatHours(totals.tentative)} not settled</span>}
        {totals.spent > 0 && (
          <span>
            Spent <b>{TH.formatHours(totals.spent)}</b>
          </span>
        )}
        {totals.cost && <span>Costs {TH.formatMoney(totals.cost.planned, t.currency)}</span>}
        {b && !b.per && (
          <span className={`tl-standing ${b.standing}`} title={`Budget ${TH.formatHours(b.hours)}; the greater of planned and spent is ${TH.formatHours(b.used)}`}>
            Budget {TH.formatHours(b.hours)}: {b.left < 0 ? `${TH.formatHours(-b.left)} over` : `${TH.formatHours(b.left)} left`}
          </span>
        )}
        {b?.per && (
          <span className={`tl-standing ${b.standing}`} title={b.over.map((p) => `${b.per === 'week' ? 'Week of ' : ''}${TH.shortDay(p.from)}: ${TH.formatHours(p.hours)}`).join('\n')}>
            Budget {TH.formatHours(b.hours)} a {b.per}: {b.over.length ? `over in ${b.over.length} ${b.per}${b.over.length > 1 ? 's' : ''}` : 'never over'}
            {b.current ? ` · this ${b.per} ${TH.formatHours(b.current.hours)}` : ''}
          </span>
        )}
        {!b && <span className="muted">No budget (Hours sets one)</span>}
      </>
    )
  }

  return (
    <Widget item={item} live={live} editingTitle={editingTitle} actions={actions}>
      <div
        ref={body}
        className={`timeline${hours ? ' hours' : ''}${drag ? ' dragging' : ''}`}
        tabIndex={live ? 0 : -1}
        onKeyDown={(e) => {
          if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !sel.source && !(e.target as Element).closest('input, select')) {
            e.stopPropagation()
            e.preventDefault()
            update((x) => TL.deleteEntry(x, sel.id))
            setSelected(null)
          }
        }}
      >
        <div ref={axis} className="tl-axis" style={{ paddingLeft: labelW }} title={live ? 'Drag to move through time; turn the wheel here to zoom it' : undefined} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
          {TL.ticks(range.start, range.end, pxPerDay).map((tick) => (
            <span key={tick.day} className={`tl-tick${tick.major ? ' major' : ''}`} style={{ left: labelW + (tick.day - range.start) * pxPerDay }}>
              {tick.label}
            </span>
          ))}
        </div>
        <div className="tl-lanes">
          {arrows.length > 0 && (
            <svg className="tl-deps" width={item.w} height={L.lanesH} aria-hidden="true">
              <defs>
                <marker id={`tl-arrow-${item.id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0L8 4L0 8z" className="tl-arrowhead" />
                </marker>
                <marker id={`tl-arrow-late-${item.id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0L8 4L0 8z" className="tl-arrowhead late" />
                </marker>
              </defs>
              {arrows.map((a) => (
                <path key={a.key} d={a.d} className={a.late ? 'late' : ''} markerEnd={`url(#tl-arrow${a.late ? '-late' : ''}-${item.id})`} />
              ))}
            </svg>
          )}
          {todayX >= 0 && todayX <= trackW && (
            <div className="tl-today" style={{ left: labelW + todayX }}>
              <span>Today</span>
            </div>
          )}
          {shown.lanes.map((lane) => {
            const at = laneAt.get(lane.id)
            const load = !lane.linked && lane.capacity !== undefined ? TH.laneLoad(t, lane, range.start, range.end) : []
            return (
              <div key={lane.id} data-lane={lane.id} className={`tl-lane${lane.linked ? ' linked' : ''}${drag?.lane === lane.id && drag.lane !== drag.entry.lane ? ' drop' : ''}`} style={{ height: at?.height }}>
                <div className="tl-label" style={{ width: labelW }}>
                  <div className="tl-who">
                    {live && !lane.linked ? (
                      <input
                        defaultValue={lane.name}
                        key={lane.name}
                        aria-label="Lane name"
                        autoFocus={naming === lane.id}
                        onFocus={(e) => naming === lane.id && e.target.select()}
                        onBlur={(e) => {
                          if (naming === lane.id) setNaming(null)
                          if (e.target.value !== lane.name) update((x) => TL.renameLane(x, lane.id, e.target.value || lane.name))
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    ) : (
                      <span title={lane.linked ? 'Cards from a Kanban board' : undefined}>{lane.name}</span>
                    )}
                    {hours && !lane.linked && laneFigures(lane)}
                  </div>
                  {live && !lane.linked && (
                    <button className="more" title="Lane options" aria-label={`Options for ${lane.name}`} onClick={() => setLaneMenu(lane.id)}>
                      ⋯
                    </button>
                  )}
                  {laneMenu === lane.id && (
                    <Menu
                      onClose={() => setLaneMenu(null)}
                      items={[
                        ['Add event here today', () => addAt(lane.id, now)],
                        ['Add milestone here today', () => addAt(lane.id, now, true)],
                        ['Hours a week, budget and rate…', () => setLaneHours(lane.id)],
                        null,
                        ['Move up', () => update((x) => TL.moveLane(x, lane.id, -1))],
                        ['Move down', () => update((x) => TL.moveLane(x, lane.id, 1))],
                        null,
                        ['Delete lane and its events', () => update((x) => TL.deleteLane(x, lane.id))],
                      ]}
                    />
                  )}
                  {laneHours === lane.id && (
                    <>
                      <div
                        className="menu-scrim"
                        onPointerDown={() => {
                          leaveBox()
                          setLaneHours(null)
                        }}
                      />
                      <div className="widget-menu tl-lane-hours">
                        <strong>{lane.name}</strong>
                        <label>
                          Has
                          <HoursBox value={lane.capacity} label="Hours a week" onSet={(v) => update((x) => TL.updateLane(x, lane.id, { capacity: v }))} />
                          <span>h a week</span>
                        </label>
                        <label>
                          Budget
                          <HoursBox value={lane.budget} label="Budget in hours" onSet={(v) => update((x) => TL.updateLane(x, lane.id, { budget: v }))} />
                          <span>h in all</span>
                        </label>
                        <label>
                          Rate
                          <HoursBox value={lane.rate} label="Rate an hour" onSet={(v) => update((x) => TL.updateLane(x, lane.id, { rate: v }))} />
                          <span>an hour</span>
                        </label>
                        <p className="muted">Hours a week show how full each week is, under the lane. Leave any empty for none.</p>
                      </div>
                    </>
                  )}
                </div>
                <div
                  className="tl-track"
                  style={{ width: trackW }}
                  onPointerDown={(e) => !lane.linked && startDraw(e, lane.id)}
                  onPointerMove={moveDraw}
                  onPointerUp={endDraw}
                  onPointerCancel={endDraw}
                  onDoubleClick={(e) => {
                    if (!live || lane.linked || (e.target as Element).closest('.tl-entry')) return
                    addAt(lane.id, Math.floor(dayAt(e.clientX)))
                  }}
                >
                  {load.map((p) => (
                    <i
                      key={p.from}
                      className={`tl-load ${p.standing}${p.hours ? '' : ' empty'}`}
                      style={{ left: (p.from - range.start) * pxPerDay, width: 7 * pxPerDay }}
                      title={`Week of ${TH.shortDay(p.from)}: ${TH.formatHours(p.hours)} of ${TH.formatHours(p.of)}`}
                    />
                  ))}
                  {draw?.lane === lane.id && draw.moved && (
                    <div className="tl-entry ghost" style={{ left: (Math.min(draw.from, draw.to) - range.start) * pxPerDay, top: TL.LANE_PAD, width: (Math.abs(draw.to - draw.from) + 1) * pxPerDay }}>
                      <span>
                        {TH.shortDay(Math.min(draw.from, draw.to))}
                        {draw.from !== draw.to ? ` → ${TH.shortDay(Math.max(draw.from, draw.to))}` : ''}
                      </span>
                    </div>
                  )}
                  {shown.entries
                    .filter((e) => e.lane === lane.id)
                    .map((entry) => {
                      const d = datesOf(entry)
                      const left = x(d.start)
                      const top = TL.LANE_PAD + (rows.get(entry.id) ?? 0) * TL.ROW_H
                      const milestone = !d.end
                      const width = milestone ? 0 : Math.max(6, endX(d) - left)
                      const moving = drag?.entry.id === entry.id
                      const figures = entry.source ? '' : TH.entryHours(entry)
                      const planned = TH.plannedHours(entry)
                      const cls = `tl-entry${milestone ? ' milestone' : ''}${selected === entry.id ? ' selected' : ''}${entry.overdue ? ' overdue' : ''}${entry.done ? ' done' : ''}${late.has(entry.id) ? ' late' : ''}${entry.tentative ? ' tentative' : ''}${moving ? ' moving' : ''}`
                      const title = `${entry.title} · ${friendly(d.start)}${d.end ? ` → ${friendly(d.end)}` : ''}${figures ? ` · ${figures}` : ''}${entry.tentative ? ' · not settled' : ''}${entry.source ? ' (Kanban card)' : ''}${entry.overdue ? ' · overdue' : ''}${late.has(entry.id) ? ' · starts before what it waits for is done' : ''}`
                      if (renaming === entry.id && !entry.source)
                        return (
                          <input
                            key={entry.id}
                            className="tl-rename"
                            autoFocus
                            style={{ left: Math.max(0, left), top }}
                            defaultValue={entry.title}
                            onFocus={(e) => e.target.select()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                              setRenaming(null)
                              if (e.target.value !== entry.title) update((x) => TL.updateEntry(x, entry.id, { title: e.target.value || entry.title }))
                            }}
                            onKeyDown={(e) => {
                              // Escape leaves the name as it was.
                              if (e.key === 'Escape') (e.target as HTMLInputElement).value = entry.title
                              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                            }}
                          />
                        )
                      return (
                        <div
                          key={entry.id}
                          className={cls}
                          title={title}
                          style={
                            milestone
                              ? { left: left - 8, top, ['--c' as string]: entry.color, ...(moving && drag.dy ? { transform: `translateY(${drag.dy}px)` } : {}) }
                              : { left, top, width, ...(hand ? {} : { background: entry.color }), color: textOn(entry.color), ...(moving && drag.dy ? { transform: `translateY(${drag.dy}px)` } : {}) }
                          }
                          onPointerDown={(e) => startDrag(e, entry)}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          onDoubleClick={() => live && !entry.source && setRenaming(entry.id)}
                        >
                          {hand && !milestone && (
                            <svg className="tl-rough" width={width} height={24} aria-hidden="true">
                              <Rough geom={{ kind: 'rect', x: 1.5, y: 1.5, w: Math.max(3, width - 3), h: 21 }} style={{ stroke: shade(entry.color, 0.6), fill: entry.color, hatch: shade(entry.color, 0.85), seed: seedOf(entry.id), strokeWidth: 1.4 }} />
                            </svg>
                          )}
                          {milestone ? <i className="diamond" /> : null}
                          <span>{entry.title}</span>
                          {figures && <em>{figures}</em>}
                          {!milestone && planned !== undefined && entry.spent !== undefined && <i className={`tl-spent${entry.spent > planned ? ' over' : ''}`} style={{ width: `${Math.min(100, planned ? (entry.spent / planned) * 100 : 100)}%` }} />}
                          {!milestone && live && (
                            <>
                              <b className="grip start" onPointerDown={(e) => startDrag(e, entry, 'start')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                              <b className="grip end" onPointerDown={(e) => startDrag(e, entry, 'end')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                            </>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            )
          })}
          <div className="tl-add" style={{ height: TL.ADD_H }}>
            <div className="tl-label" style={{ width: labelW }}>
              {live && !editor.readOnly && (
                <button title={hours ? 'Add a person, a team or anything else whose time is planned' : 'Add a lane'} aria-label="Add a lane" onClick={addLane}>
                  +
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="tl-foot" style={{ height: TL.FOOT_H }}>
          {live && sel && !sel.source ? (
            <div className="tl-selected">
              <strong>{sel.title}</strong>
              <span className="muted">
                {friendly(sel.start)}
                {sel.end ? ` → ${friendly(sel.end)}` : ' (milestone)'}
              </span>
              {hours && own && (
                <span className="tl-entry-hours">
                  <HoursBox key={`planned ${own.id}`} value={own.hours} label="Hours planned" onSet={(v) => patch(v === undefined ? { hours: undefined, per: undefined } : { hours: v })} />
                  <select aria-label="How the hours are meant" value={own.per ?? ''} disabled={own.hours === undefined} onChange={(e) => patch({ per: (e.target.value || undefined) as TimelineEntry['per'] })}>
                    <option value="">h in all</option>
                    <option value="day">h a day</option>
                    <option value="week">h a week</option>
                  </select>
                  <HoursBox key={`spent ${own.id}`} value={own.spent} label="Hours spent so far" onSet={(v) => patch({ spent: v })} />
                  <span className="muted">spent</span>
                  <label title="Not settled yet: drawn lighter, and counted apart from what’s planned">
                    <input type="checkbox" checked={!!own.tentative} onChange={(e) => patch({ tentative: e.target.checked ? true : undefined })} />
                    maybe
                  </label>
                </span>
              )}
              <span className="swatches">
                {BRANCHES.map(([name, color]) => (
                  <button key={color} className={`swatch${sel.color === color ? ' active' : ''}`} style={{ background: color }} title={name} onClick={() => patch({ color })} />
                ))}
              </span>
              <button onClick={() => patch(sel.end ? { end: undefined } : { end: TL.fromDay(TL.toDay(sel.start) + 3) })}>{sel.end ? 'Make milestone' : 'Make span'}</button>
              {ownOthers.length > 0 && (
                <span className="tl-wait-anchor">
                  <button className={sel.after?.length ? 'on' : ''} title="Events that must finish before this one starts" onClick={() => setWaitMenu(!waitMenu)}>
                    Waits for{sel.after?.length ? ` (${sel.after.length})` : '…'}
                  </button>
                  {waitMenu && (
                    <Menu
                      onClose={() => setWaitMenu(false)}
                      items={ownOthers.map((e) => [
                        `${sel.after?.includes(e.id) ? '✓ ' : ''}${e.title}`,
                        () => update((x) => (sel.after?.includes(e.id) ? TL.removeDependency(x, e.id, sel.id) : TL.addDependency(x, e.id, sel.id))),
                      ])}
                    />
                  )}
                </span>
              )}
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
          ) : live && sel?.source ? (
            <div className="tl-selected muted">Drag to reschedule this Kanban card · edit it on its board</div>
          ) : (
            <div className="tl-summary">{shown.lanes.length === 0 ? <span className="muted">Add a lane to start.</span> : summary()}</div>
          )}
        </div>
      </div>
    </Widget>
  )
}
