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
  // setUTCFullYear, unlike Date.UTC, reads years below 100 as written (0026 is not 1926).
  const t = new Date(0)
  t.setUTCFullYear(y, (m || 1) - 1, d || 1)
  return Math.round(t.getTime() / DAY)
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

/** Most labels an axis gets, however long the span (a mistyped year can make it centuries). */
const MAX_TICKS = 400

/**
 * Axis labels: days, weeks, months, quarters, years or decades, depending on how much room
 * each day gets. The first tick also names its month (and year), so a ruler of day numbers
 * says which month it's in.
 */
export function ticks(start: number, end: number, pxPerDay: number): Tick[] {
  const out: Tick[] = []
  if (pxPerDay >= 5) {
    for (let day = start; day <= end && out.length < MAX_TICKS; day++) {
      const d = new Date(day * DAY)
      const date = d.getUTCDate()
      const firstOfMonth = date === 1
      const monday = d.getUTCDay() === 1
      const named = firstOfMonth || !out.length
      if (pxPerDay >= 26) out.push({ day, label: named ? `${MONTHS[d.getUTCMonth()]} ${date}` : `${date}`, major: firstOfMonth || monday })
      else if (monday) out.push({ day, label: `${MONTHS[d.getUTCMonth()]} ${date}`, major: firstOfMonth })
    }
    return out
  }
  // Months or longer: step from one first-of-month to the next, never day by day.
  const perMonth = pxPerDay * 30.4
  const months = [1, 3, 12, 60, 120, 600, 1200].find((n) => perMonth * n >= 40) ?? 1200
  const s = new Date(start * DAY)
  let m = s.getUTCFullYear() * 12 + s.getUTCMonth() + (s.getUTCDate() === 1 ? 0 : 1)
  m = Math.ceil(m / months) * months
  for (; out.length < MAX_TICKS; m += months) {
    const year = Math.floor(m / 12)
    const month = m - year * 12
    const day = toDay(`${year}-${month + 1}-1`)
    if (day > end) break
    if (months < 12) out.push({ day, label: month === 0 || !out.length ? `${MONTHS[month]} ${year}` : MONTHS[month], major: month === 0 })
    else out.push({ day, label: String(year), major: year % (months >= 60 ? 100 : 10) === 0 })
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
  // Nothing waits on an entry that's gone.
  return { ...t, entries: t.entries.filter((e) => e.id !== id).map((e) => (e.after?.includes(id) ? withAfter(e, e.after.filter((x) => x !== id)) : e)) }
}

// ----- dependencies ----------------------------------------------------------------

function withAfter(e: TimelineEntry, after: string[]): TimelineEntry {
  const next = { ...e }
  if (after.length) next.after = after
  else delete next.after
  return next
}

/** The day an entry is finished: its end, or a milestone's own day. */
const finish = (e: { start: string; end?: string }) => toDay(e.end ?? e.start)

/** Whether `a` already (directly or not) waits for `b`. */
function waitsFor(t: TimelineData, a: string, b: string, seen = new Set<string>()): boolean {
  if (a === b) return true
  if (seen.has(a)) return false
  seen.add(a)
  const e = t.entries.find((x) => x.id === a)
  return !!e?.after?.some((x) => waitsFor(t, x, b, seen))
}

/** Makes `id` wait for `before` to finish. Refused (unchanged) if it would make a loop. */
export function addDependency(t: TimelineData, before: string, id: string): TimelineData {
  const e = t.entries.find((x) => x.id === id)
  if (!e || !t.entries.some((x) => x.id === before) || e.after?.includes(before) || waitsFor(t, before, id)) return t
  return { ...t, entries: t.entries.map((x) => (x.id === id ? withAfter(x, [...(x.after ?? []), before]) : x)) }
}

export function removeDependency(t: TimelineData, before: string, id: string): TimelineData {
  return { ...t, entries: t.entries.map((x) => (x.id === id && x.after?.includes(before) ? withAfter(x, x.after.filter((b) => b !== before)) : x)) }
}

/** Whether adding "id waits for before" would make a loop (or is the same entry). */
export const wouldLoop = (t: TimelineData, before: string, id: string) => waitsFor(t, before, id)

export interface Dependency {
  from: string
  to: string
  /** The waiting entry starts before the one it waits for has finished. */
  late: boolean
}

/** Every dependency on the timeline, with clashes marked. */
export function dependencies(t: TimelineData): Dependency[] {
  const byId = new Map(t.entries.map((e) => [e.id, e]))
  const out: Dependency[] = []
  for (const e of t.entries)
    for (const b of e.after ?? []) {
      const before = byId.get(b)
      if (before) out.push({ from: b, to: e.id, late: toDay(e.start) <= finish(before) && (!!before.end || toDay(e.start) < finish(before)) })
    }
  return out
}

/**
 * Moves entries that start too early to the day after what they wait for has
 * finished (keeping their length), working down the chain.
 */
export function lineUp(t: TimelineData): TimelineData {
  let entries = t.entries
  let changed = false
  // Enough passes to settle any chain (it can't be longer than the number of entries).
  for (let pass = 0; pass < entries.length; pass++) {
    let moved = false
    const byId = new Map(entries.map((e) => [e.id, e]))
    const next = entries.map((e) => {
      if (!e.after?.length) return e
      const ready = Math.max(...e.after.map((b) => byId.get(b)).filter((b): b is TimelineEntry => !!b).map((b) => finish(b) + (b.end ? 1 : 0)))
      if (!Number.isFinite(ready) || toDay(e.start) >= ready) return e
      moved = true
      return { ...e, ...shiftDates(e, ready - toDay(e.start)) }
    })
    if (!moved) break
    entries = next
    changed = true
  }
  return changed ? { ...t, entries } : t
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
