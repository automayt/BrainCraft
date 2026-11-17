/**
 * Managing time on a timeline. A lane is someone (or a team, a client, a machine) whose time is
 * being planned; an entry is a span of that time on something, with the hours planned for it and
 * the hours spent so far. From those: what each lane and the whole timeline add up to, how loaded
 * each lane is week by week against the hours it has, and how the hours stand against a budget
 * (in all for a fixed amount of work, or each week or month for a retainer).
 *
 * Nothing here is required: a timeline with no hours is the plain timeline it always was, and
 * every figure is worked out from whichever of these were given. Pure functions.
 */

import { fromDay, toDay, tracksTime } from './timeline'

export { tracksTime }
import type { TimelineBudget, TimelineData, TimelineEntry, TimelineLane } from './types'

/** The most hours an entry or a budget can hold (a century of work), and the most a lane has in a week. */
export const HOURS_MAX = 1_000_000
export const WEEK_MAX = 24 * 7

/** Monday to Friday. Day 0 (1970-01-01) was a Thursday. */
export const isWorkday = (day: number) => {
  const d = (((day + 4) % 7) + 7) % 7
  return d >= 1 && d <= 5
}

/** The Monday on or before a day. */
export const weekOf = (day: number) => day - ((((day + 3) % 7) + 7) % 7)

/** The first of the month a day is in. */
export const monthOf = (day: number) => toDay(`${fromDay(day).slice(0, 7)}-01`)

/** An entry's first and last day (a milestone is one day). */
export const daysOf = (e: Pick<TimelineEntry, 'start' | 'end'>): [number, number] => {
  const s = toDay(e.start)
  return [s, Math.max(s, e.end ? toDay(e.end) : s)]
}

/** Working days from `from` to `to`, both counted. */
export function workdays(from: number, to: number): number {
  if (to < from) return 0
  const days = to - from + 1
  const weeks = Math.floor(days / 7)
  let n = weeks * 5
  for (let d = from + weeks * 7; d <= to; d++) if (isWorkday(d)) n++
  return n
}

/** The days an entry's hours are spread over: its working days, or every day of it when it has none (a weekend). */
function spread(e: Pick<TimelineEntry, 'start' | 'end'>): { from: number; to: number; work: boolean; days: number } {
  const [from, to] = daysOf(e)
  const work = workdays(from, to)
  return work ? { from, to, work: true, days: work } : { from, to, work: false, days: to - from + 1 }
}

/** The hours planned for an entry in all; undefined when it has none. */
export function plannedHours(e: TimelineEntry): number | undefined {
  if (e.hours === undefined) return undefined
  if (!e.per) return e.hours
  const { days, work } = spread(e)
  // A weekend's work is still counted by the day; a week is five of them.
  const n = work ? days : days
  return e.per === 'day' ? e.hours * n : (e.hours * n) / 5
}

/** The part of an entry's planned hours that falls on the days `from` to `to` (spread evenly over its days). */
export function hoursWithin(e: TimelineEntry, from: number, to: number): number {
  const total = plannedHours(e)
  if (!total) return 0
  const s = spread(e)
  const a = Math.max(from, s.from)
  const z = Math.min(to, s.to)
  if (z < a) return 0
  const inside = s.work ? workdays(a, z) : z - a + 1
  return (total * inside) / s.days
}

export interface Hours {
  /** Planned and settled. */
  planned: number
  /** Planned but not settled yet (tentative entries), apart from `planned`. */
  tentative: number
  spent: number
}

const add = (into: Hours, e: TimelineEntry) => {
  const p = plannedHours(e) ?? 0
  if (e.tentative) into.tentative += p
  else into.planned += p
  into.spent += e.spent ?? 0
}

/** How a figure stands against what it's held to: fine, nearly all of it used (nine tenths), or over. */
export type Standing = 'ok' | 'near' | 'over'
export const standing = (used: number, of: number): Standing => (of <= 0 ? (used > 0 ? 'over' : 'ok') : used > of + 1e-9 ? 'over' : used >= of * 0.9 ? 'near' : 'ok')

export interface LaneHours extends Hours {
  lane: string
  /** What its hours cost, planned and spent, when it has a rate. */
  cost?: { planned: number; spent: number }
  /** Against the lane's own budget, when it has one: what's left (below zero when over), and how it stands. */
  left?: number
  standing?: Standing
}

/** What a lane's entries add up to. */
export function laneHours(t: TimelineData, lane: TimelineLane): LaneHours {
  const h: LaneHours = { lane: lane.id, planned: 0, tentative: 0, spent: 0 }
  for (const e of t.entries) if (e.lane === lane.id) add(h, e)
  if (lane.rate !== undefined) h.cost = { planned: h.planned * lane.rate, spent: h.spent * lane.rate }
  if (lane.budget !== undefined) {
    const used = Math.max(h.planned, h.spent)
    h.left = lane.budget - used
    h.standing = standing(used, lane.budget)
  }
  return h
}

/** A week (or a month) of a lane or of the timeline: the hours planned in it, and what they're held to. */
export interface Period {
  /** Its first day. */
  from: number
  to: number
  hours: number
  of: number
  standing: Standing
}

/**
 * A lane's load, week by week, across the days `from` to `to`: the hours planned in each week
 * against the hours the lane has. Nothing when the lane has no capacity set. Tentative entries
 * count: they're time someone means to take.
 */
export function laneLoad(t: TimelineData, lane: TimelineLane, from: number, to: number): Period[] {
  if (lane.capacity === undefined) return []
  const mine = t.entries.filter((e) => e.lane === lane.id && e.hours !== undefined)
  const out: Period[] = []
  for (let w = weekOf(from); w <= to && out.length < 520; w += 7) {
    const hours = mine.reduce((n, e) => n + hoursWithin(e, w, w + 6), 0)
    out.push({ from: w, to: w + 6, hours, of: lane.capacity, standing: standing(hours, lane.capacity) })
  }
  return out
}

/** The weeks in which a lane has more planned than it has hours for, anywhere on the timeline. */
export function overloaded(t: TimelineData, lane: TimelineLane): Period[] {
  if (lane.capacity === undefined) return []
  const mine = t.entries.filter((e) => e.lane === lane.id && e.hours !== undefined)
  if (!mine.length) return []
  const first = Math.min(...mine.map((e) => daysOf(e)[0]))
  const last = Math.max(...mine.map((e) => daysOf(e)[1]))
  return laneLoad(t, lane, first, Math.min(last, first + 520 * 7)).filter((p) => p.standing === 'over')
}

export interface TimelineHours extends Hours {
  lanes: LaneHours[]
  /** What it all costs, when any lane has a rate (lanes without one cost nothing). */
  cost?: { planned: number; spent: number }
  /** Against the timeline's budget, when it has one. */
  budget?: {
    hours: number
    per?: 'week' | 'month'
    /** In all: what's used (the greater of planned and spent), what's left, and how it stands. */
    used: number
    left: number
    standing: Standing
    /** Each week or month: those with more than the budget, and the one `now` is in. */
    over: Period[]
    current?: Period
  }
}

const periodOf = (per: 'week' | 'month', day: number): [number, number] => {
  if (per === 'week') return [weekOf(day), weekOf(day) + 6]
  const first = monthOf(day)
  const d = new Date(first * 86_400_000)
  d.setUTCMonth(d.getUTCMonth() + 1)
  return [first, Math.round(d.getTime() / 86_400_000) - 1]
}

/** Each week or month the entries touch, with the hours planned in it against the budget. */
export function budgetPeriods(t: TimelineData, budget: TimelineBudget & { per: 'week' | 'month' }): Period[] {
  const with_ = t.entries.filter((e) => e.hours !== undefined)
  if (!with_.length) return []
  const first = Math.min(...with_.map((e) => daysOf(e)[0]))
  const last = Math.max(...with_.map((e) => daysOf(e)[1]))
  const out: Period[] = []
  for (let [a, z] = periodOf(budget.per, first); a <= last && out.length < 600; [a, z] = periodOf(budget.per, z + 1)) {
    const hours = with_.reduce((n, e) => n + hoursWithin(e, a, z), 0)
    out.push({ from: a, to: z, hours, of: budget.hours, standing: standing(hours, budget.hours) })
  }
  return out
}

/** What the whole timeline adds up to, lane by lane and in all, and how it stands against its budget. */
export function timelineHours(t: TimelineData, now?: number): TimelineHours {
  const lanes = t.lanes.map((l) => laneHours(t, l))
  const out: TimelineHours = { lanes, planned: 0, tentative: 0, spent: 0 }
  // Entries on lanes that aren't its own (a followed Kanban's cards) carry no hours.
  for (const h of lanes) {
    out.planned += h.planned
    out.tentative += h.tentative
    out.spent += h.spent
  }
  if (lanes.some((h) => h.cost)) out.cost = { planned: lanes.reduce((n, h) => n + (h.cost?.planned ?? 0), 0), spent: lanes.reduce((n, h) => n + (h.cost?.spent ?? 0), 0) }
  const b = t.budget
  if (b) {
    if (b.per) {
      const periods = budgetPeriods(t, { ...b, per: b.per })
      const current = now === undefined ? undefined : periods.find((p) => now >= p.from && now <= p.to)
      const worst = periods.reduce((m, p) => Math.max(m, p.hours), 0)
      out.budget = { hours: b.hours, per: b.per, used: worst, left: b.hours - worst, standing: standing(worst, b.hours), over: periods.filter((p) => p.standing === 'over'), ...(current ? { current } : {}) }
    } else {
      const used = Math.max(out.planned, out.spent)
      out.budget = { hours: b.hours, used, left: b.hours - used, standing: standing(used, b.hours), over: [] }
    }
  }
  return out
}

// ----- in words -------------------------------------------------------------------------------

/** Hours as people write them: "30 h", "7.5 h", "1,240 h". */
export function formatHours(n: number): string {
  const r = Math.round(n * 10) / 10
  return `${r.toLocaleString('en-US', { maximumFractionDigits: 1 })} h`
}

/** Money with its sign: "$1,200", "€850.50", "1,200 kr" (signs of more than one letter go after). */
export function formatMoney(n: number, sign = '$'): string {
  const s = (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
  return /^[^\p{L}]$/u.test(sign) ? `${sign}${s}` : `${s} ${sign}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "17 Nov", for the week or month a period starts on. */
export const shortDay = (day: number) => {
  const d = new Date(day * 86_400_000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** An entry's hours as written on it: "30 h", "4 h a day", "19 of 30 h" once some are spent. */
export function entryHours(e: TimelineEntry): string {
  const planned = plannedHours(e)
  if (planned === undefined) return e.spent !== undefined ? `${formatHours(e.spent)} spent` : ''
  if (e.spent !== undefined) return `${formatHours(e.spent).replace(' h', '')} of ${formatHours(planned)}`
  return e.per ? `${formatHours(e.hours!)} a ${e.per}` : formatHours(planned)
}

/**
 * The timeline's hours as the assistant reads them: each lane with what it has and what's planned
 * and spent, then the totals, the budget, and what needs attention (who has too much in which week,
 * what's over its budget).
 */
export function hoursText(t: TimelineData, now?: number): string {
  if (!tracksTime(t)) return ''
  const h = timelineHours(t, now)
  const money = (n: number) => formatMoney(n, t.currency)
  const parts: string[] = []
  for (const lane of t.lanes) {
    const l = h.lanes.find((x) => x.lane === lane.id)!
    if (!l.planned && !l.tentative && !l.spent && lane.capacity === undefined && lane.budget === undefined) continue
    const bits = [`planned ${formatHours(l.planned)}`]
    if (l.tentative) bits.push(`tentative ${formatHours(l.tentative)}`)
    if (l.spent) bits.push(`spent ${formatHours(l.spent)}`)
    if (lane.capacity !== undefined) bits.push(`has ${formatHours(lane.capacity)} a week`)
    if (lane.budget !== undefined) bits.push(`budget ${formatHours(lane.budget)} (${l.left! < 0 ? `${formatHours(-l.left!)} over` : `${formatHours(l.left!)} left`})`)
    if (l.cost) bits.push(`cost ${money(l.cost.planned)}`)
    const over = overloaded(t, lane)
    if (over.length) bits.push(`over in ${over.slice(0, 4).map((p) => `the week of ${shortDay(p.from)} (${formatHours(p.hours)})`).join(', ')}${over.length > 4 ? ` and ${over.length - 4} more weeks` : ''}`)
    parts.push(`${lane.name}: ${bits.join(', ')}`)
  }
  const all = [`planned ${formatHours(h.planned)}`]
  if (h.tentative) all.push(`tentative ${formatHours(h.tentative)}`)
  if (h.spent) all.push(`spent ${formatHours(h.spent)}`)
  if (h.cost) all.push(`cost ${money(h.cost.planned)}`)
  if (h.budget) {
    const b = h.budget
    if (b.per) all.push(`budget ${formatHours(b.hours)} a ${b.per}${b.over.length ? `, over in ${b.over.slice(0, 4).map((p) => `${b.per === 'week' ? 'the week of ' : ''}${shortDay(p.from)} (${formatHours(p.hours)})`).join(', ')}` : ', never over'}`)
    else all.push(`budget ${formatHours(b.hours)} (${b.left < 0 ? `${formatHours(-b.left)} over` : `${formatHours(b.left)} left`})`)
  }
  parts.push(`In all: ${all.join(', ')}`)
  return parts.join('. ')
}
