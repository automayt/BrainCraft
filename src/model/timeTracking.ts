/**
 * Time tracking: timers people start on an object, a database record, a wiki page or the board,
 * and time they log by hand, for themselves or for someone else. Kept on the board as entries
 * (`board.time`), each its own patch in a live session, so people tracking at the same time never
 * get in each other's way, and a timer keeps running through a reload, on any device.
 *
 * Also assignees and estimates on objects. Pure functions.
 */

import { getItem, updateItem } from './board'
import { canHaveStatus } from './status'
import * as D from './dataset'
import { objectLabel } from './notes'
import { uid } from './uid'
import { getPage, isWiki } from './wiki'
import type { Board, Id, Item, TimeEntry, TimeTarget } from './types'
import { hours } from './duration'

export { formatClock, formatDuration, hours, parseDuration } from './duration'

export const MAX_ENTRIES = 20_000
export const NOTE_MAX = 500
/** A timer running this long was most likely forgotten: the app asks before keeping it. */
export const LONG_RUN = 10 * 3_600_000
/** The longest a single entry can be. */
export const MAX_ENTRY = 7 * 24 * 3_600_000
const NAME_MAX = 60
const MAX_ASSIGNEES = 12
/** Before this (2000-01-01), a time is a mistake. */
const EARLIEST = 946_684_800_000

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= EARLIEST && v < 8.64e15

export const isEntryId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

export function cleanTarget(v: unknown): TimeTarget | undefined {
  if (!isObj(v)) return undefined
  if (typeof v.item === 'number' && Number.isSafeInteger(v.item) && v.item > 0) return { item: v.item }
  if (typeof v.dataset === 'string' && typeof v.record === 'string' && /^[\w-]{1,64}$/.test(v.dataset) && /^[\w-]{1,64}$/.test(v.record)) return { dataset: v.dataset, record: v.record }
  if (typeof v.page === 'string' && /^[\w-]{1,64}$/.test(v.page)) return { page: v.page }
  return undefined
}

/** An entry as kept: from a file, a link or someone else in a live session. */
export function cleanEntry(v: unknown): TimeEntry | null {
  if (!isObj(v) || !isEntryId(v.id) || !isTime(v.start)) return null
  const who = clean(v.who, NAME_MAX)
  if (!who) return null
  const out: TimeEntry = { id: v.id, who, start: v.start }
  // An end before the start, or an entry longer than a week, can't be right.
  if (v.end !== undefined) {
    if (!isTime(v.end) || v.end < v.start || v.end - v.start > MAX_ENTRY) return null
    out.end = v.end
  }
  const user = clean(v.user, 64)
  if (user) out.user = user
  const on = cleanTarget(v.on)
  if (on) out.on = on
  for (const k of ['label', 'by'] as const) {
    const s = clean(v[k], k === 'label' ? 120 : NAME_MAX)
    if (s) out[k] = s
  }
  const note = typeof v.note === 'string' ? v.note.trim().slice(0, NOTE_MAX) : ''
  if (note) out.note = note
  return out
}

/** A board's entries as kept: valid ones, the first of any repeated id, at most MAX_ENTRIES. */
export function cleanTime(raw: unknown): TimeEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw
    .slice(0, MAX_ENTRIES)
    .map(cleanEntry)
    .filter((e): e is TimeEntry => !!e && !seen.has(e.id) && !!seen.add(e.id))
}

// ----- people ----------------------------------------------------------------------------

export interface Person {
  name: string
  /** Their account, with accounts. */
  user?: string
}

/** One person, whichever way they're named: their account when there is one, else their name. */
export const personKey = (p: { who?: string; name?: string; user?: string }) => (p.user ? `u:${p.user}` : `n:${(p.who ?? p.name ?? '').trim().toLowerCase()}`)
const samePerson = (e: TimeEntry, p: Person) => (p.user && e.user ? e.user === p.user : e.who.trim().toLowerCase() === p.name.trim().toLowerCase())

/** Assignee names as kept: tidy, distinct (ignoring case), at most a dozen. */
export function cleanAssignees(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  return v
    .map((n) => clean(n, NAME_MAX))
    .filter((n) => n && !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()))
    .slice(0, MAX_ASSIGNEES)
}

/** Sets, adds or takes away people on objects that can be assigned (the same ones a status goes on). */
export function assign(b: Board, ids: Iterable<Id>, names: string[], how: 'set' | 'add' | 'remove' = 'set'): Board {
  const given = cleanAssignees(names)
  const lower = new Set(given.map((n) => n.toLowerCase()))
  for (const id of ids) {
    const it = getItem(b, id)
    if (!it || !canHaveStatus(it.kind)) continue
    const had = it.assignees ?? []
    const next =
      how === 'set' ? given : how === 'add' ? cleanAssignees([...had, ...given]) : had.filter((n) => !lower.has(n.toLowerCase()))
    if (next.length === had.length && next.every((n, k) => n === had[k])) continue
    b = updateItem(b, id, (i) => {
      const out: Item = { ...i }
      if (next.length) out.assignees = next
      else delete out.assignees
      return out
    })
  }
  return b
}

/** Sets (or, with null, clears) how long objects should take, in minutes. */
export function setEstimate(b: Board, ids: Iterable<Id>, minutes: number | null): Board {
  const m = minutes === null || !Number.isFinite(minutes) || minutes <= 0 ? null : Math.min(Math.round(minutes), 100_000)
  for (const id of ids) {
    const it = getItem(b, id)
    if (!it || !canHaveStatus(it.kind) || (it.estimate ?? null) === m) continue
    b = updateItem(b, id, (i) => {
      const out: Item = { ...i }
      if (m) out.estimate = m
      else delete out.estimate
      return out
    })
  }
  return b
}

/** Everyone the board knows of, for picking whom to assign or log time for: assignees, people tracking time, person fields. */
export function peopleOn(b: Board, also: string[] = []): string[] {
  const names = new Map<string, string>()
  const add = (n: string | undefined) => {
    const s = clean(n, NAME_MAX)
    if (s && !names.has(s.toLowerCase())) names.set(s.toLowerCase(), s)
  }
  also.forEach(add)
  for (const i of b.items) i.assignees?.forEach(add)
  for (const e of b.time ?? []) add(e.who)
  for (const ds of b.datasets ?? []) {
    const people = ds.fields.filter((f) => f.type === 'person')
    for (const r of ds.records) for (const f of people) add(typeof r.values[f.id] === 'string' ? (r.values[f.id] as string) : undefined)
  }
  return [...names.values()].sort((a, z) => a.localeCompare(z))
}

// ----- what time is on -----------------------------------------------------------------------

/** A key for grouping: the board, an object, a record or a page. */
export function targetKey(on: TimeTarget | undefined): string {
  if (!on) return 'board'
  if ('item' in on) return `i:${on.item}`
  if ('record' in on) return `r:${on.dataset}:${on.record}`
  return `p:${on.page}`
}

export const sameTarget = (a: TimeTarget | undefined, z: TimeTarget | undefined) => targetKey(a) === targetKey(z)

export interface TargetInfo {
  kind: 'board' | 'object' | 'record' | 'page'
  label: string
  /** It was deleted since (the label is the one saved with the time). */
  gone: boolean
}

/** What a target is called now, or what it was called when time went on it. */
export function describeTarget(b: Board, on: TimeTarget | undefined, saved?: string): TargetInfo {
  if (!on) return { kind: 'board', label: isWiki(b) ? 'The wiki' : 'The board', gone: false }
  if ('item' in on) {
    const it = getItem(b, on.item)
    return { kind: 'object', label: it ? (it.hiddenBy ? 'A hidden note' : objectLabel(it)) : (saved ?? `Object ${on.item}`), gone: !it }
  }
  if ('record' in on) {
    const ds = D.getDataset(b, on.dataset)
    const r = ds?.records.find((x) => x.id === on.record)
    return { kind: 'record', label: ds && r ? `${D.recordTitle(ds, r)} (${ds.name})` : (saved ?? 'A record'), gone: !r }
  }
  const p = getPage(b, on.page)
  return { kind: 'page', label: p ? p.title || 'Untitled' : (saved ?? 'A page'), gone: !p }
}

/** The name to keep with new time, so it still reads right after the target is deleted. */
function labelFor(b: Board, on: TimeTarget | undefined): string | undefined {
  if (!on) return undefined
  // A hidden brainstorm note's words stay hidden.
  if ('item' in on && getItem(b, on.item)?.hiddenBy) return undefined
  const t = describeTarget(b, on)
  return t.gone ? undefined : t.label.slice(0, 120)
}

// ----- timers and entries ----------------------------------------------------------------------

export const durationOf = (e: TimeEntry, now: number) => Math.max(0, (e.end ?? Math.max(now, e.start)) - e.start)

/** The timer this person has running on the board, if any. */
export const runningFor = (b: Board, p: Person) => (b.time ?? []).find((e) => e.end === undefined && samePerson(e, p))

/** Every timer running on the board. */
export const running = (b: Board) => (b.time ?? []).filter((e) => e.end === undefined)

const withTime = (b: Board, time: TimeEntry[]): Board => {
  const next: Board = { ...b, time }
  if (!time.length) delete next.time
  return next
}

const replace = (b: Board, id: string, f: (e: TimeEntry) => TimeEntry | null): Board =>
  withTime(
    b,
    (b.time ?? []).flatMap((e) => {
      if (e.id !== id) return [e]
      const n = f(e)
      return n ? [n] : []
    }),
  )

/** Stops this person's running timer (at `now`, or at `end`); the board as it was when none runs. */
export function stopTimer(b: Board, p: Person, now: number, end = now): { board: Board; stopped?: TimeEntry } {
  const r = runningFor(b, p)
  if (!r) return { board: b }
  const stopped = { ...r, end: Math.min(Math.max(end, r.start), r.start + MAX_ENTRY) }
  return { board: replace(b, r.id, () => stopped), stopped }
}

/**
 * Starts a timer for a person on `on` (or the board). Each person has one timer at a time on a
 * board: one already running stops first.
 */
export function startTimer(b: Board, o: Person & { on?: TimeTarget; note?: string; by?: string; now: number; id?: string }): { board: Board; id: string; stopped?: TimeEntry } {
  const { board, stopped } = stopTimer(b, o, o.now)
  const id = o.id ?? uid()
  const label = labelFor(board, o.on)
  const e: TimeEntry = {
    id,
    who: clean(o.name, NAME_MAX) || 'Someone',
    ...(o.user ? { user: o.user } : {}),
    start: o.now,
    ...(o.on ? { on: o.on } : {}),
    ...(label ? { label } : {}),
    ...(o.note?.trim() ? { note: o.note.trim().slice(0, NOTE_MAX) } : {}),
    ...(o.by && o.by !== o.name ? { by: clean(o.by, NAME_MAX) } : {}),
  }
  const time = [...(board.time ?? []), e]
  if (time.length > MAX_ENTRIES) time.splice(0, time.length - MAX_ENTRIES)
  return { board: withTime(board, time), id, ...(stopped ? { stopped } : {}) }
}

/** Time logged by hand, from `start` to `end`. Throws with words a person can act on when it can't be right. */
export function logTime(b: Board, o: Person & { on?: TimeTarget; start: number; end: number; note?: string; by?: string; id?: string }): { board: Board; id: string } {
  if (!isTime(o.start) || !isTime(o.end)) throw new Error('The times aren’t valid')
  if (o.end <= o.start) throw new Error('The end has to be after the start')
  if (o.end - o.start > MAX_ENTRY) throw new Error('One entry can be a week at most')
  const id = o.id ?? uid()
  const label = labelFor(b, o.on)
  const e: TimeEntry = {
    id,
    who: clean(o.name, NAME_MAX) || 'Someone',
    ...(o.user ? { user: o.user } : {}),
    start: o.start,
    end: o.end,
    ...(o.on ? { on: o.on } : {}),
    ...(label ? { label } : {}),
    ...(o.note?.trim() ? { note: o.note.trim().slice(0, NOTE_MAX) } : {}),
    ...(o.by && o.by.trim().toLowerCase() !== o.name.trim().toLowerCase() ? { by: clean(o.by, NAME_MAX) } : {}),
  }
  return { board: withTime(b, [...(b.time ?? []), e].slice(-MAX_ENTRIES)), id }
}

export interface EntryChange {
  start?: number
  /** null: running again (only for the newest entry of a person with no other timer running). */
  end?: number | null
  note?: string
  on?: TimeTarget | null
  who?: Person
}

/** Changes one entry; throws with words a person can act on when the change can't be right. */
export function updateEntry(b: Board, id: string, c: EntryChange): Board {
  const e = (b.time ?? []).find((x) => x.id === id)
  if (!e) throw new Error('That time entry is gone')
  const next: TimeEntry = { ...e }
  if (c.start !== undefined) {
    if (!isTime(c.start)) throw new Error('The start isn’t a valid time')
    next.start = c.start
  }
  if (c.end !== undefined) {
    if (c.end === null) delete next.end
    else if (!isTime(c.end)) throw new Error('The end isn’t a valid time')
    else next.end = c.end
  }
  if (next.end !== undefined && next.end <= next.start) throw new Error('The end has to be after the start')
  if (next.end !== undefined && next.end - next.start > MAX_ENTRY) throw new Error('One entry can be a week at most')
  if (c.note !== undefined) {
    const note = c.note.trim().slice(0, NOTE_MAX)
    if (note) next.note = note
    else delete next.note
  }
  if (c.on !== undefined) {
    if (c.on) {
      next.on = c.on
      const label = labelFor(b, c.on)
      if (label) next.label = label
      else delete next.label
    } else {
      delete next.on
      delete next.label
    }
  }
  if (c.who) {
    next.who = clean(c.who.name, NAME_MAX) || next.who
    if (c.who.user) next.user = c.who.user
    else delete next.user
  }
  if (next.end === undefined && e.end !== undefined && (b.time ?? []).some((x) => x.id !== id && x.end === undefined && samePerson(x, { name: next.who, user: next.user })))
    throw new Error(`${next.who} already has a timer running`)
  return replace(b, id, () => next)
}

export const deleteEntry = (b: Board, id: string): Board => replace(b, id, () => null)

// ----- totals ---------------------------------------------------------------------------------

/** Time on each object, and who's tracking it now: for the badges on the board. */
export function itemTime(b: Board, now: number): Map<Id, { ms: number; running: string[] }> {
  const out = new Map<Id, { ms: number; running: string[] }>()
  for (const e of b.time ?? []) {
    if (!e.on || !('item' in e.on)) continue
    const t = out.get(e.on.item) ?? { ms: 0, running: [] }
    t.ms += durationOf(e, now)
    if (e.end === undefined) t.running.push(e.who)
    out.set(e.on.item, t)
  }
  return out
}

/** Time on a mind-map idea and every idea under it. */
export function branchTime(b: Board, id: Id, now: number, totals = itemTime(b, now)): number {
  const kids = new Map<Id, Id[]>()
  for (const i of b.items) if (i.kind === 'mind' && i.parent !== undefined) kids.set(i.parent, [...(kids.get(i.parent) ?? []), i.id])
  let ms = 0
  const stack = [id]
  const seen = new Set<Id>()
  while (stack.length) {
    const n = stack.pop()!
    if (seen.has(n)) continue
    seen.add(n)
    ms += totals.get(n)?.ms ?? 0
    stack.push(...(kids.get(n) ?? []))
  }
  return ms
}

/** Time on one record. */
export const recordTime = (b: Board, dataset: string, record: string, now: number) =>
  (b.time ?? []).reduce((s, e) => (e.on && 'record' in e.on && e.on.dataset === dataset && e.on.record === record ? s + durationOf(e, now) : s), 0)

export interface TimeFilter {
  /** Only time from this moment… */
  from?: number
  /** …to this one (time either side is cut off). */
  to?: number
  /** Only this person's. */
  who?: Person
  /** Only time on this (an object's includes ideas under it, for a mind map). */
  on?: TimeTarget
}

export interface TimeSummary {
  total: number
  entries: { entry: TimeEntry; ms: number }[]
  byPerson: { who: string; user?: string; ms: number }[]
  byTarget: { key: string; on?: TimeTarget; label: string; kind: TargetInfo['kind']; gone: boolean; ms: number }[]
  /** Local days (YYYY-MM-DD), oldest first. */
  byDay: { day: string; ms: number }[]
}

const localDay = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The time that matches, cut to the span, totalled by person, by what it was on and by day; newest first. */
export function summarize(b: Board, f: TimeFilter, now: number): TimeSummary {
  // An object's time includes the ideas under it.
  let keys: Set<string> | null = null
  if (f.on) {
    keys = new Set([targetKey(f.on)])
    if ('item' in f.on) {
      const kids = new Map<Id, Id[]>()
      for (const i of b.items) if (i.parent !== undefined) kids.set(i.parent, [...(kids.get(i.parent) ?? []), i.id])
      const stack = [...(kids.get(f.on.item) ?? [])]
      while (stack.length) {
        const n = stack.pop()!
        if (keys.has(`i:${n}`)) continue
        keys.add(`i:${n}`)
        stack.push(...(kids.get(n) ?? []))
      }
    }
  }
  const from = f.from ?? -Infinity
  const to = f.to ?? Infinity
  const entries: TimeSummary['entries'] = []
  const people = new Map<string, { who: string; user?: string; ms: number }>()
  const targets = new Map<string, TimeSummary['byTarget'][number]>()
  const days = new Map<string, number>()
  for (const e of b.time ?? []) {
    if (f.who && !samePerson(e, f.who)) continue
    if (keys && !keys.has(targetKey(e.on))) continue
    const end = e.end ?? Math.max(now, e.start)
    const s = Math.max(e.start, from)
    const z = Math.min(end, to)
    // Within the span (a timer started inside it counts even at zero length).
    if (z < s || (z === s && !(e.end === undefined && e.start >= from && e.start <= to))) continue
    const ms = z - s
    entries.push({ entry: e, ms })
    const pk = personKey(e)
    const p = people.get(pk) ?? { who: e.who, ...(e.user ? { user: e.user } : {}), ms: 0 }
    p.ms += ms
    people.set(pk, p)
    const tk = targetKey(e.on)
    if (!targets.has(tk)) targets.set(tk, { key: tk, ...(e.on ? { on: e.on } : {}), ...describeTarget(b, e.on, e.label), ms: 0 })
    targets.get(tk)!.ms += ms
    // Split across days at local midnight.
    for (let t = s; t < z; ) {
      const d = new Date(t)
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
      const cut = Math.min(next, z)
      days.set(localDay(t), (days.get(localDay(t)) ?? 0) + (cut - t))
      t = cut
    }
  }
  entries.sort((a, z) => z.entry.start - a.entry.start)
  return {
    total: entries.reduce((s, x) => s + x.ms, 0),
    entries,
    byPerson: [...people.values()].sort((a, z) => z.ms - a.ms),
    byTarget: [...targets.values()].sort((a, z) => z.ms - a.ms),
    byDay: [...days].sort(([a], [z]) => (a < z ? -1 : 1)).map(([day, ms]) => ({ day, ms })),
  }
}

/** Entries that overlap another of the same person's (someone tracking two things at once by mistake). */
export function overlapping(b: Board, now: number): Set<string> {
  const out = new Set<string>()
  const byPerson = new Map<string, TimeEntry[]>()
  for (const e of b.time ?? []) byPerson.set(personKey(e), [...(byPerson.get(personKey(e)) ?? []), e])
  for (const list of byPerson.values()) {
    const sorted = list.slice().sort((a, z) => a.start - z.start)
    let reach = -Infinity
    let last: TimeEntry | null = null
    for (const e of sorted) {
      if (last && e.start < reach) {
        out.add(e.id)
        out.add(last.id)
      }
      const end = e.end ?? now
      if (end > reach) {
        reach = end
        last = e
      }
    }
  }
  return out
}

/** The entries as CSV: one row each, for a spreadsheet or an invoice. */
export function timeCsv(b: Board, s: TimeSummary): string {
  const iso = (t: number) => new Date(t).toISOString()
  const head = ['Person', 'On', 'Kind', 'Start', 'End', 'Hours', 'Note', 'Logged by']
  const rows = s.entries.map(({ entry: e, ms }) => {
    const t = describeTarget(b, e.on, e.label)
    return [e.who, t.label + (t.gone ? ' (deleted)' : ''), t.kind, iso(e.start), e.end ? iso(e.end) : 'running', hours(ms).toFixed(2), e.note ?? '', e.by ?? '']
  })
  const cell = (c: string) => (/[",\n]/.test(c) || /^[=+\-@]/.test(c) ? `"${(/^[=+\-@]/.test(c) ? `'${c}` : c).replace(/"/g, '""')}"` : c)
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n'
}
