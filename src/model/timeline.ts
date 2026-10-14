/**
 * Timelines: lanes of events (date spans) and milestones on a shared time
 * axis. A timeline can also follow Kanban boards: their dated cards show up
 * live in a lane per board, and dragging them on the timeline reschedules the
 * cards. Overdue cards (past due and not in the last column) are flagged.
 */

import { getItem } from './board'
import { uid } from './uid'
import { BRANCHES, type Board, type Id, type Item, type TimelineData, type TimelineEntry, type TimelineLane } from './types'

const DAY = 86_400_000

/** Whole days since 1970-01-01 for a YYYY-MM-DD date. */
export function toDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / DAY)
}

export function fromDay(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10)
}

/** Today in the viewer's time zone. */
export function today(now = new Date()): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY)
}

export const isIsoDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)

export function newTimeline(now = today()): TimelineData {
  const lanes = [
    { id: uid(), name: 'Plan' },
    { id: uid(), name: 'Build' },
    { id: uid(), name: 'Launch' },
  ]
  return {
    lanes,
    entries: [
      { id: uid(), lane: lanes[0].id, title: 'Research', start: fromDay(now - 3), end: fromDay(now + 4), color: BRANCHES[0][1] },
      { id: uid(), lane: lanes[1].id, title: 'First version', start: fromDay(now + 5), end: fromDay(now + 19), color: BRANCHES[2][1] },
      { id: uid(), lane: lanes[2].id, title: 'Go live', start: fromDay(now + 21), color: BRANCHES[1][1] },
    ],
  }
}

/** An entry as drawn, including ones that come from linked Kanban cards. */
export interface ShownEntry extends TimelineEntry {
  /** For Kanban cards: the board and card it comes from. */
  source?: { kanban: Id; card: string }
  overdue?: boolean
  done?: boolean
}

export interface ShownTimeline {
  lanes: (TimelineLane & { linked?: boolean })[]
  entries: ShownEntry[]
}

/** The timeline's own lanes and entries plus those from the Kanban boards it follows. */
export function shownTimeline(b: Board, t: TimelineData, now = today()): ShownTimeline {
  const lanes: ShownTimeline['lanes'] = [...t.lanes]
  const entries: ShownEntry[] = [...t.entries]
  for (const source of t.sources ?? []) {
    const k = getItem(b, source)
    if (!k?.kanban) continue
    const lane = `kanban:${source}`
    lanes.push({ id: lane, name: k.text || 'Kanban', linked: true })
    const last = k.kanban.columns.length - 1
    k.kanban.columns.forEach((col, c) => {
      for (const card of col.cards) {
        const start = isIsoDay(card.start) ? card.start : isIsoDay(card.due) ? card.due : null
        if (!start) continue
        const end = isIsoDay(card.start) && isIsoDay(card.due) && card.due > card.start ? card.due : undefined
        const done = c === last && last > 0
        entries.push({
          id: `card:${source}:${card.id}`,
          lane,
          title: card.title || 'Untitled card',
          start,
          end,
          color: card.color ?? BRANCHES[c % BRANCHES.length][1],
          source: { kanban: source, card: card.id },
          done,
          overdue: !done && isIsoDay(card.due) && toDay(card.due) < now,
        })
      }
    })
  }
  return { lanes, entries }
}

/** First and last day shown: the saved range, or the content (and today) with some margin. */
export function visibleRange(t: TimelineData, entries: TimelineEntry[], now = today()): { start: number; end: number } {
  if (t.range) return { start: toDay(t.range.start), end: Math.max(toDay(t.range.end), toDay(t.range.start) + 1) }
  let start = now
  let end = now
  for (const e of entries) {
    start = Math.min(start, toDay(e.start))
    end = Math.max(end, toDay(e.end ?? e.start))
  }
  const pad = Math.max(2, Math.round((end - start) * 0.08))
  start -= pad
  end += pad + 1
  if (end - start < 14) {
    const mid = Math.round((start + end) / 2)
    start = mid - 7
    end = mid + 7
  }
  return { start, end }
}

export interface Tick {
  day: number
  label: string
  major: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Axis labels: days, weeks or months depending on how much room each day gets. */
export function ticks(start: number, end: number, pxPerDay: number): Tick[] {
  const out: Tick[] = []
  for (let day = start; day <= end; day++) {
    const d = new Date(day * DAY)
    const date = d.getUTCDate()
    const firstOfMonth = date === 1
    const monday = d.getUTCDay() === 1
    if (pxPerDay >= 26) {
      out.push({ day, label: firstOfMonth ? `${MONTHS[d.getUTCMonth()]} ${date}` : `${date}`, major: firstOfMonth || monday })
    } else if (pxPerDay >= 5) {
      if (monday) out.push({ day, label: `${MONTHS[d.getUTCMonth()]} ${date}`, major: firstOfMonth })
    } else if (firstOfMonth) {
      out.push({ day, label: d.getUTCMonth() === 0 ? `${MONTHS[0]} ${d.getUTCFullYear()}` : MONTHS[d.getUTCMonth()], major: d.getUTCMonth() === 0 })
    }
  }
  return out
}

/**
 * Stacks overlapping entries within each lane into rows. `minDays` is the
 * room a milestone (and its label) needs.
 */
export function packRows(entries: TimelineEntry[], minDays: number): Map<string, number> {
  const rows = new Map<string, number>()
  const byLane = new Map<string, TimelineEntry[]>()
  for (const e of entries) byLane.set(e.lane, [...(byLane.get(e.lane) ?? []), e])
  for (const list of byLane.values()) {
    const ends: number[] = []
    for (const e of [...list].sort((a, z) => toDay(a.start) - toDay(z.start))) {
      const s = toDay(e.start)
      const f = Math.max(e.end ? toDay(e.end) : s, s + minDays)
      let row = ends.findIndex((end) => end < s)
      if (row < 0) row = ends.length
      ends[row] = f
      rows.set(e.id, row)
    }
  }
  return rows
}

// ----- editing ---------------------------------------------------------------------

export function addEntry(t: TimelineData, entry: Omit<TimelineEntry, 'id'>): [TimelineData, string] {
  const id = uid()
  return [{ ...t, entries: [...t.entries, { ...entry, id }] }, id]
}

export function updateEntry(t: TimelineData, id: string, patch: Partial<TimelineEntry>): TimelineData {
  return {
    ...t,
    entries: t.entries.map((e) => {
      if (e.id !== id) return e
      const next = { ...e, ...patch }
      if (patch.end === undefined && 'end' in patch) delete next.end
      return next
    }),
  }
}

export function deleteEntry(t: TimelineData, id: string): TimelineData {
  return { ...t, entries: t.entries.filter((e) => e.id !== id) }
}

/** Shifts an entry by `days`, or one of its ends when resizing (never past the other end). */
export function shiftDates(e: { start: string; end?: string }, days: number, edge?: 'start' | 'end'): { start: string; end?: string } {
  const s = toDay(e.start)
  const f = e.end ? toDay(e.end) : undefined
  if (edge === 'start') return { start: fromDay(Math.min(s + days, (f ?? s) - 1)), end: e.end }
  if (edge === 'end') return { start: e.start, end: fromDay(Math.max((f ?? s) + days, s + 1)) }
  return { start: fromDay(s + days), end: f === undefined ? undefined : fromDay(f + days) }
}

export function addLane(t: TimelineData, name = 'New lane'): [TimelineData, string] {
  const id = uid()
  return [{ ...t, lanes: [...t.lanes, { id, name }] }, id]
}

export function renameLane(t: TimelineData, id: string, name: string): TimelineData {
  return { ...t, lanes: t.lanes.map((l) => (l.id === id ? { ...l, name } : l)) }
}

export function deleteLane(t: TimelineData, id: string): TimelineData {
  return { ...t, lanes: t.lanes.filter((l) => l.id !== id), entries: t.entries.filter((e) => e.lane !== id) }
}

export function toggleSource(t: TimelineData, kanban: Id): TimelineData {
  const sources = t.sources ?? []
  return { ...t, sources: sources.includes(kanban) ? sources.filter((s) => s !== kanban) : [...sources, kanban] }
}

/** Zooms the visible range about its middle (factor < 1 zooms in). */
export function zoomRange(range: { start: number; end: number }, factor: number): { start: string; end: string } {
  const mid = (range.start + range.end) / 2
  const half = Math.max(3, Math.min(3650, ((range.end - range.start) / 2) * factor))
  return { start: fromDay(Math.round(mid - half)), end: fromDay(Math.round(mid + half)) }
}

export function panRange(range: { start: number; end: number }, days: number): { start: string; end: string } {
  return { start: fromDay(range.start + days), end: fromDay(range.end + days) }
}

/** Kanban boards on `b` this timeline could follow. */
export const kanbanBoards = (b: Board): Item[] => b.items.filter((i) => i.kind === 'kanban')
