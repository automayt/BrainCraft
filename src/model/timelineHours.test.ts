import { describe, expect, it } from 'vitest'
import { objectLine } from '../ai/boardText'
import { applyOps, type Op } from '../api/ops'
import { getObject } from '../api/queries'
import { emptyBoard } from './board'
import { cleanItem } from './sanitize'
import { canSketch } from './sketch'
import { fakeMeasure } from './test-helpers'
import * as TL from './timeline'
import * as TH from './timelineHours'
import type { Board, Item, TimelineData, TimelineEntry } from './types'

const ctx = { measure: fakeMeasure }
const day = TL.toDay
const entry = (o: Partial<TimelineEntry> & { start: string }): TimelineEntry => ({ id: o.title ?? 'e', lane: 'a', title: 'Work', color: '#888888', ...o })

/** A team's timeline: Sam and Priya with hours a week, a studio with a rate, and a budget of 200 hours. */
const TEAM: Op = {
  op: 'createTimeline',
  title: 'Launch team',
  budget: { hours: 200 },
  lanes: [
    {
      name: 'Sam',
      capacity: 40,
      entries: [
        { title: 'Research', start: '2026-11-16', end: '2026-11-20', hours: 30, spent: 12 },
        { title: 'Launch prep', start: '2026-11-30', end: '2026-12-04', hours: 8, per: 'day' },
      ],
    },
    {
      name: 'Priya',
      capacity: 32,
      budget: 60,
      entries: [
        { title: 'Build', start: '2026-11-18', end: '2026-11-27', hours: 70 },
        { title: 'Docs', start: '2026-11-23', end: '2026-11-27', hours: 20, tentative: true },
      ],
    },
    { name: 'Design studio', rate: 90, entries: [{ title: 'Brand', start: '2026-11-17', end: '2026-11-21', hours: 25 }, { title: 'Go live', start: '2026-12-07' }] },
  ],
}
const made = (op: Op = TEAM): { b: Board; item: Item; t: TimelineData } => {
  const b = applyOps(emptyBoard(), [op], ctx).board
  const item = b.items.find((i) => i.kind === 'timeline')!
  return { b, item, t: item.timeline! }
}

describe('days and weeks', () => {
  it('knows working days from weekends', () => {
    // 16 November 2026 is a Monday.
    expect(TH.isWorkday(day('2026-11-16'))).toBe(true)
    expect(TH.isWorkday(day('2026-11-20'))).toBe(true)
    expect(TH.isWorkday(day('2026-11-21'))).toBe(false)
    expect(TH.isWorkday(day('2026-11-22'))).toBe(false)
    expect(TH.workdays(day('2026-11-16'), day('2026-11-20'))).toBe(5)
    expect(TH.workdays(day('2026-11-16'), day('2026-11-22'))).toBe(5)
    expect(TH.workdays(day('2026-11-18'), day('2026-11-27'))).toBe(8)
    expect(TH.workdays(day('2026-11-21'), day('2026-11-22'))).toBe(0)
    expect(TH.workdays(day('2026-11-20'), day('2026-11-16'))).toBe(0)
    expect(TH.workdays(day('2026-01-01'), day('2026-12-31'))).toBe(261)
  })

  it('finds the week and the month a day is in', () => {
    expect(TL.fromDay(TH.weekOf(day('2026-11-19')))).toBe('2026-11-16')
    expect(TL.fromDay(TH.weekOf(day('2026-11-16')))).toBe('2026-11-16')
    expect(TL.fromDay(TH.weekOf(day('2026-11-22')))).toBe('2026-11-16')
    expect(TL.fromDay(TH.monthOf(day('2026-11-19')))).toBe('2026-11-01')
  })
})

describe('the hours on a span', () => {
  it('are what was planned in all, or for each working day or week of it', () => {
    expect(TH.plannedHours(entry({ start: '2026-11-16', end: '2026-11-20', hours: 30 }))).toBe(30)
    // Five working days at 8 a day; a fortnight at 10 a week.
    expect(TH.plannedHours(entry({ start: '2026-11-16', end: '2026-11-20', hours: 8, per: 'day' }))).toBe(40)
    expect(TH.plannedHours(entry({ start: '2026-11-16', end: '2026-11-27', hours: 10, per: 'week' }))).toBe(20)
    // Its last day counts: Monday to the Monday after is six working days.
    expect(TH.plannedHours(entry({ start: '2026-11-16', end: '2026-11-23', hours: 1, per: 'day' }))).toBe(6)
    // A milestone is its one day; a weekend's work still counts by the day.
    expect(TH.plannedHours(entry({ start: '2026-11-16', hours: 3, per: 'day' }))).toBe(3)
    expect(TH.plannedHours(entry({ start: '2026-11-21', end: '2026-11-22', hours: 4, per: 'day' }))).toBe(8)
    expect(TH.plannedHours(entry({ start: '2026-11-16', end: '2026-11-20' }))).toBeUndefined()
  })

  it('are spread evenly over its working days', () => {
    const build = entry({ start: '2026-11-18', end: '2026-11-27', hours: 80 })
    // Eight working days at 10: three in its first week, five in its second.
    expect(TH.hoursWithin(build, day('2026-11-16'), day('2026-11-22'))).toBe(30)
    expect(TH.hoursWithin(build, day('2026-11-23'), day('2026-11-29'))).toBe(50)
    expect(TH.hoursWithin(build, day('2026-11-30'), day('2026-12-06'))).toBe(0)
    expect(TH.hoursWithin(build, day('2026-11-21'), day('2026-11-22'))).toBe(0)
    expect(TH.hoursWithin(entry({ start: '2026-11-16', end: '2026-11-20' }), day('2026-11-16'), day('2026-11-22'))).toBe(0)
  })

  it('read as people write them', () => {
    expect(TH.entryHours(entry({ start: '2026-11-16', end: '2026-11-20', hours: 30 }))).toBe('30 h')
    expect(TH.entryHours(entry({ start: '2026-11-16', end: '2026-11-20', hours: 30, spent: 12 }))).toBe('12 of 30 h')
    expect(TH.entryHours(entry({ start: '2026-11-16', end: '2026-11-20', hours: 7.5, per: 'day' }))).toBe('7.5 h a day')
    expect(TH.entryHours(entry({ start: '2026-11-16', end: '2026-11-20', spent: 4 }))).toBe('4 h spent')
    expect(TH.entryHours(entry({ start: '2026-11-16', end: '2026-11-20' }))).toBe('')
    expect(TH.formatHours(1240)).toBe('1,240 h')
    expect(TH.formatHours(26.25)).toBe('26.3 h')
    expect(TH.formatMoney(2250)).toBe('$2,250')
    expect(TH.formatMoney(850.5, '€')).toBe('€850.5')
    expect(TH.formatMoney(1200, 'kr')).toBe('1,200 kr')
  })
})

describe('what a timeline’s hours add up to', () => {
  it('lane by lane and in all, with what’s not settled apart', () => {
    const { t } = made()
    const h = TH.timelineHours(t, day('2026-11-16'))
    expect(h.lanes.map((l) => [l.planned, l.tentative, l.spent])).toEqual([
      [70, 0, 12],
      [70, 20, 0],
      [25, 0, 0],
    ])
    expect(h).toMatchObject({ planned: 165, tentative: 20, spent: 12 })
    // Only the studio has a rate.
    expect(h.cost).toEqual({ planned: 2250, spent: 0 })
    expect(h.lanes[2].cost).toEqual({ planned: 2250, spent: 0 })
    expect(h.lanes[0].cost).toBeUndefined()
  })

  it('stands against the lane’s own budget and the timeline’s', () => {
    const { t } = made()
    const h = TH.timelineHours(t, day('2026-11-16'))
    // Priya has 70 planned of the 60 set aside for her.
    expect(h.lanes[1]).toMatchObject({ left: -10, standing: 'over' })
    expect(h.lanes[0].standing).toBeUndefined()
    expect(h.budget).toMatchObject({ hours: 200, used: 165, left: 35, standing: 'ok', over: [] })
    // Nine tenths used is nearly all of it; more than all is over. Spent counts when it's the greater.
    expect(TH.standing(89, 100)).toBe('ok')
    expect(TH.standing(90, 100)).toBe('near')
    expect(TH.standing(100, 100)).toBe('near')
    expect(TH.standing(100.5, 100)).toBe('over')
    expect(TH.standing(0, 0)).toBe('ok')
    expect(TH.standing(1, 0)).toBe('over')
    const spent = TH.timelineHours({ ...t, entries: t.entries.map((e) => (e.title === 'Research' ? { ...e, spent: 90 } : e)) }).budget!
    expect(spent).toMatchObject({ used: 165, standing: 'ok' })
    const blown = TH.timelineHours({ ...t, budget: { hours: 100 }, entries: t.entries.map((e) => (e.title === 'Research' ? { ...e, spent: 190 } : e)) }).budget!
    expect(blown).toMatchObject({ used: 190, left: -90, standing: 'over' })
  })

  it('holds a retainer to its hours each month, or each week', () => {
    const { t } = made()
    const monthly = TH.timelineHours({ ...t, budget: { hours: 120, per: 'month' } }, day('2026-11-16')).budget!
    // November holds everything but Launch prep's December days (four of its five).
    expect(monthly.per).toBe('month')
    expect(monthly.over.map((p) => [TL.fromDay(p.from), TL.fromDay(p.to), p.hours])).toEqual([['2026-11-01', '2026-11-30', 153]])
    expect(monthly.current).toMatchObject({ hours: 153, of: 120, standing: 'over' })
    // It stands by its fullest month, not by everything together.
    expect(monthly).toMatchObject({ used: 153, left: -33, standing: 'over' })
    // A month runs to its last day, whichever that is.
    const december = TH.budgetPeriods({ lanes: t.lanes, entries: [entry({ start: '2026-12-01', end: '2026-12-31', hours: 46 })] }, { hours: 40, per: 'month' })
    expect(december.map((p) => [TL.fromDay(p.from), TL.fromDay(p.to), p.hours])).toEqual([['2026-12-01', '2026-12-31', 46]])
    const turn = TH.budgetPeriods({ lanes: t.lanes, entries: [entry({ start: '2027-01-29', end: '2027-03-02', hours: 23 })] }, { hours: 40, per: 'month' })
    expect(turn.map((p) => [TL.fromDay(p.from), TL.fromDay(p.to)])).toEqual([
      ['2027-01-01', '2027-01-31'],
      ['2027-02-01', '2027-02-28'],
      ['2027-03-01', '2027-03-31'],
    ])
    const weekly = TH.timelineHours({ ...t, budget: { hours: 90, per: 'week' } }, day('2026-12-01')).budget!
    expect(weekly.over.map((p) => TL.fromDay(p.from))).toEqual([])
    expect(weekly.current).toMatchObject({ hours: 40 })
    expect(TH.timelineHours({ ...t, budget: { hours: 60, per: 'week' } }).budget!.over.map((p) => TL.fromDay(p.from))).toEqual(['2026-11-16', '2026-11-23'])
    // Nothing planned: no periods at all.
    expect(TH.budgetPeriods({ lanes: t.lanes, entries: [] }, { hours: 10, per: 'week' })).toEqual([])
  })

  it('shows how full each lane’s weeks are, and where it has too much', () => {
    const { t } = made()
    const priya = t.lanes[1]
    const load = TH.laneLoad(t, priya, day('2026-11-16'), day('2026-12-06'))
    // Build is 8.75 hours on each of its eight days; Docs (not settled, but meant) 4 on each of its five.
    expect(load.map((p) => [TL.fromDay(p.from), p.hours, p.standing])).toEqual([
      ['2026-11-16', 26.25, 'ok'],
      ['2026-11-23', 63.75, 'over'],
      ['2026-11-30', 0, 'ok'],
    ])
    expect(TH.overloaded(t, priya).map((p) => TL.fromDay(p.from))).toEqual(['2026-11-23'])
    expect(TH.overloaded(t, t.lanes[0])).toEqual([])
    // A lane with no hours a week has no load to show.
    expect(TH.laneLoad(t, t.lanes[2], day('2026-11-16'), day('2026-12-06'))).toEqual([])
    expect(TH.overloaded(t, t.lanes[2])).toEqual([])
  })

  it('is told to the assistant in words, with what needs attention', () => {
    const { t } = made()
    const said = TH.hoursText(t, day('2026-11-16'))
    expect(said).toContain('Sam: planned 70 h, spent 12 h, has 40 h a week')
    expect(said).toContain('Priya: planned 70 h, tentative 20 h, has 32 h a week, budget 60 h (10 h over), over in the week of 23 Nov (63.8 h)')
    expect(said).toContain('Design studio: planned 25 h, cost $2,250')
    expect(said).toContain('In all: planned 165 h, tentative 20 h, spent 12 h, cost $2,250, budget 200 h (35 h left)')
    expect(TH.hoursText({ ...t, budget: { hours: 120, per: 'month' } }, day('2026-11-16'))).toContain('budget 120 h a month, over in 1 Nov (153 h)')
    // A plain timeline has nothing to say about hours.
    expect(TH.hoursText(TL.newTimeline(day('2026-11-16')))).toBe('')
  })
})

describe('whether a timeline shows hours', () => {
  it('does when something on it has them, or when it’s asked to; and not when it’s asked not to', () => {
    const plain = TL.newTimeline(day('2026-11-16'))
    expect(TL.tracksTime(plain)).toBe(false)
    expect(TL.tracksTime({ ...plain, time: true })).toBe(true)
    expect(TL.tracksTime({ ...plain, budget: { hours: 10 } })).toBe(true)
    expect(TL.tracksTime({ ...plain, lanes: plain.lanes.map((l, k) => (k ? l : { ...l, capacity: 40 })) })).toBe(true)
    expect(TL.tracksTime({ ...plain, entries: plain.entries.map((e, k) => (k ? e : { ...e, spent: 2 })) })).toBe(true)
    const { t } = made()
    expect(TL.tracksTime(t)).toBe(true)
    // Put out of sight, everything stays as it was set.
    const hidden = TL.withoutHours(t)
    expect(TL.tracksTime(hidden)).toBe(false)
    expect(hidden.entries).toBe(t.entries)
    expect(hidden.budget).toEqual({ hours: 200 })
    // A budget set again brings them back.
    expect(TL.tracksTime(TL.withBudget(hidden, { hours: 150 }))).toBe(true)
    expect(TL.withBudget(t, undefined).budget).toBeUndefined()
    expect(TL.withCurrency(t, ' € ').currency).toBe('€')
    expect('currency' in TL.withCurrency({ ...t, currency: '€' }, '')).toBe(false)
  })
})

describe('a timeline’s layout', () => {
  it('is as tall as its lanes need, and wider down the side when lanes carry hours', () => {
    const { b, item, t } = made()
    const L = TL.timelineLayout(b, t, item.w, day('2026-11-16'))
    expect(L.labelW).toBe(TL.LABEL_W_HOURS)
    expect(L.lanes).toHaveLength(3)
    // Priya's two spans overlap, so her lane has two rows; she and Sam have a band for how full their weeks are.
    const one = TL.ROW_H + TL.LANE_PAD * 2
    expect(L.lanes.map((l) => l.height)).toEqual([one + TL.LOAD_H, one + TL.ROW_H + TL.LOAD_H, one])
    expect(L.lanes.map((l) => l.top)).toEqual([0, one + TL.LOAD_H + 1, 2 * one + TL.ROW_H + 2 * TL.LOAD_H + 2])
    expect(L.height).toBe(TL.HEAD_H + TL.AXIS_H + L.lanesH + TL.ADD_H + TL.FOOT_H + 2)
    // The object was made that tall.
    expect(item.h).toBe(TL.timelineLayout(b, t, item.w).height)
    const plain = TL.timelineLayout(b, TL.newTimeline(day('2026-11-16')), 1000, day('2026-11-16'))
    expect(plain.labelW).toBe(TL.LABEL_W)
  })

  it('hugs its lanes when one is added or taken away', () => {
    const { b, item } = made()
    const more = TL.hugged(b, { ...item, timeline: TL.addLane(item.timeline!, 'Avery')[0] })
    expect(more.h).toBe(item.h + TL.ROW_H + TL.LANE_PAD * 2 + 1)
    const fewer = TL.hugged(b, { ...item, timeline: TL.deleteLane(item.timeline!, item.timeline!.lanes[2].id) })
    expect(fewer.h).toBe(item.h - (TL.ROW_H + TL.LANE_PAD * 2 + 1))
    // Already right: the same object.
    expect(TL.hugged(b, item)).toBe(item)
    const note = b.items[0]
    expect(TL.hugged(b, { ...note, kind: 'sticky', timeline: undefined })).toMatchObject({ kind: 'sticky' })
  })

  it('lays out the days it’s given while it’s being dragged along', () => {
    const { b, item, t } = made()
    const L = TL.timelineLayout(b, t, item.w, day('2026-11-16'), { start: day('2026-12-01'), end: day('2026-12-31') })
    expect(L.range).toEqual({ start: day('2026-12-01'), end: day('2026-12-31') })
    expect(L.days).toBe(30)
    expect(L.pxPerDay).toBeCloseTo((item.w - TL.LABEL_W_HOURS - 2) / 30)
  })
})

describe('putting a span somewhere else with the mouse', () => {
  it('moves it in time, stretches an end, and takes it to another lane', () => {
    const { t } = made()
    const brand = t.entries.find((e) => e.title === 'Brand')!
    const [sam, priya] = t.lanes
    const at = (x: TimelineData) => {
      const e = x.entries.find((y) => y.id === brand.id)!
      return [x.lanes.find((l) => l.id === e.lane)!.name, e.start, e.end]
    }
    expect(at(TL.placeEntry(t, brand.id, 3))).toEqual(['Design studio', '2026-11-20', '2026-11-24'])
    expect(at(TL.placeEntry(t, brand.id, 2, 'end'))).toEqual(['Design studio', '2026-11-17', '2026-11-23'])
    expect(at(TL.placeEntry(t, brand.id, 0, undefined, priya.id))).toEqual(['Priya', '2026-11-17', '2026-11-21'])
    expect(at(TL.placeEntry(t, brand.id, -1, undefined, sam.id))).toEqual(['Sam', '2026-11-16', '2026-11-20'])
    // Its hours go with it.
    expect(TL.placeEntry(t, brand.id, 3, undefined, priya.id).entries.find((e) => e.id === brand.id)).toMatchObject({ hours: 25, title: 'Brand' })
    // Nowhere new, a lane that isn't there, or an entry that isn't: as it was.
    expect(TL.placeEntry(t, brand.id, 0)).toBe(t)
    expect(TL.placeEntry(t, brand.id, 0, undefined, brand.lane)).toBe(t)
    expect(at(TL.placeEntry(t, brand.id, 0, undefined, 'no-such-lane'))).toEqual(['Design studio', '2026-11-17', '2026-11-21'])
    expect(TL.placeEntry(t, 'nothing', 4)).toBe(t)
  })

  it('zooms time about the day under the pointer, and stretches the days in view to hold a span', () => {
    const r = { start: 100, end: 130 }
    // In: fewer days, the day under the pointer where it was (a third of the way along).
    const closer = TL.zoomAbout(r, 110, 0.5)
    expect(closer.end - closer.start).toBe(15)
    expect((110 - closer.start) / 15).toBeCloseTo(1 / 3, 1)
    const wider = TL.zoomAbout(r, 110, 2)
    expect(wider.end - wider.start).toBe(60)
    expect(wider.start).toBe(90)
    // Never closer than a week, nor further than twenty years.
    expect(TL.zoomAbout(r, 110, 0.01).end - TL.zoomAbout(r, 110, 0.01).start).toBe(6)
    expect(TL.zoomAbout(r, 110, 1e6).end - TL.zoomAbout(r, 110, 1e6).start).toBe(7300)
    expect(TL.rangeWith(r, 95, 140)).toEqual({ start: 95, end: 141 })
    expect(TL.rangeWith(r, 105, 110)).toEqual(r)
    expect(TL.rangeDays({ start: day('2026-11-16'), end: day('2026-11-30') })).toEqual({ start: '2026-11-16', end: '2026-11-30' })
  })

  it('changes what a lane has, and moves lanes up and down', () => {
    const { t } = made()
    const sam = t.lanes[0]
    expect(TL.updateLane(t, sam.id, { capacity: 30, rate: 80 }).lanes[0]).toEqual({ ...sam, capacity: 30, rate: 80 })
    const none = TL.updateLane(t, sam.id, { capacity: undefined }).lanes[0]
    expect('capacity' in none).toBe(false)
    expect(TL.updateLane(t, 'nobody', { capacity: 5 }).lanes).toEqual(t.lanes)
    expect(TL.moveLane(t, sam.id, 1).lanes.map((l) => l.name)).toEqual(['Priya', 'Sam', 'Design studio'])
    expect(TL.moveLane(t, sam.id, 5).lanes.map((l) => l.name)).toEqual(['Priya', 'Design studio', 'Sam'])
    expect(TL.moveLane(t, sam.id, -1)).toBe(t)
    expect(TL.moveLane(t, 'nobody', 1)).toBe(t)
  })
})

describe('hours through the assistant’s operations', () => {
  it('makes a timeline with them, as tall as it needs', () => {
    const { item, t } = made()
    expect(t.budget).toEqual({ hours: 200 })
    expect(t.lanes.map((l) => [l.name, l.capacity, l.budget, l.rate])).toEqual([
      ['Sam', 40, undefined, undefined],
      ['Priya', 32, 60, undefined],
      ['Design studio', undefined, undefined, 90],
    ])
    expect(t.entries.map((e) => [e.title, e.hours, e.per, e.spent, e.tentative])).toEqual([
      ['Research', 30, undefined, 12, undefined],
      ['Launch prep', 8, 'day', undefined, undefined],
      ['Build', 70, undefined, undefined, undefined],
      ['Docs', 20, undefined, undefined, true],
      ['Brand', 25, undefined, undefined, undefined],
      ['Go live', undefined, undefined, undefined, undefined],
    ])
    expect(item.h).toBeGreaterThan(250)
  })

  it('keeps the hours lanes and entries had when they’re sent again without them, and takes new ones', () => {
    const { b, item } = made()
    const again = applyOps(
      b,
      [
        {
          op: 'setTimeline',
          id: item.id,
          lanes: [
            // Research given to Priya with new dates; Sam's hours a week changed; Brand's hours changed and settled.
            { name: 'Sam', capacity: 30, entries: [{ title: 'Launch prep', start: '2026-12-01', end: '2026-12-04' }] },
            { name: 'Priya', entries: [{ title: 'Research', start: '2026-11-23', end: '2026-11-27' }, { title: 'Docs', start: '2026-11-23', end: '2026-11-27', tentative: false, hours: 12, per: 'week' }] },
            { name: 'Design studio', entries: [{ title: 'Brand', start: '2026-11-17', end: '2026-11-21', hours: 40, spent: 5 }] },
          ],
        },
      ],
      ctx,
    ).board
    const t = again.items.find((i) => i.id === item.id)!.timeline!
    expect(t.lanes.map((l) => [l.name, l.capacity, l.budget, l.rate])).toEqual([
      ['Sam', 30, undefined, undefined],
      ['Priya', 32, 60, undefined],
      ['Design studio', undefined, undefined, 90],
    ])
    const by = (title: string) => t.entries.find((e) => e.title === title)!
    expect(by('Research')).toMatchObject({ start: '2026-11-23', hours: 30, spent: 12 })
    expect(t.lanes.find((l) => l.id === by('Research').lane)!.name).toBe('Priya')
    expect(by('Launch prep')).toMatchObject({ hours: 8, per: 'day', start: '2026-12-01' })
    expect(by('Docs')).toMatchObject({ hours: 12, per: 'week' })
    expect('tentative' in by('Docs')).toBe(false)
    expect(by('Brand')).toMatchObject({ hours: 40, spent: 5 })
    // The budget stays, changes, or goes.
    expect(t.budget).toEqual({ hours: 200 })
    const lanes = [{ name: 'Sam', entries: [{ title: 'Launch prep', start: '2026-11-30', end: '2026-12-04', hours: 36 }] }]
    const setItem = (budget: unknown) => {
      const board = applyOps(b, [{ op: 'setTimeline', id: item.id, lanes, budget } as Op], ctx).board
      return { board, item: board.items.find((i) => i.id === item.id)! }
    }
    const set = (budget: unknown) => setItem(budget).item.timeline!
    expect(set({ hours: 80, per: 'month' }).budget).toEqual({ hours: 80, per: 'month' })
    expect(set(null).budget).toBeUndefined()
    // Hours given in all replace hours that were for each day.
    const prep = set(undefined).entries.find((e) => e.title === 'Launch prep')!
    expect(prep.hours).toBe(36)
    expect('per' in prep).toBe(false)
    // One lane where there were three: no taller than it needs.
    const one = setItem(undefined)
    expect(one.item.h).toBe(TL.timelineLayout(one.board, one.item.timeline!, item.w).height)
    expect(one.item.h).toBeLessThan(item.h)
  })

  it('says what’s wrong with hours that make no sense', () => {
    const bad = (entry: object, more: object = {}) => () => applyOps(emptyBoard(), [{ op: 'createTimeline', lanes: [{ name: 'Sam', entries: [{ title: 'Work', start: '2026-11-16', end: '2026-11-20', ...entry }] }], ...more } as Op], ctx)
    expect(bad({ hours: -1 })).toThrow(/hours" is a number of hours, 0 or more/)
    expect(bad({ hours: 'lots' })).toThrow(/a number of hours/)
    expect(bad({ hours: 4, per: 'month' })).toThrow(/"day" or "week"/)
    expect(bad({ per: 'day' })).toThrow(/needs "hours"/)
    expect(bad({ spent: Infinity })).toThrow(/a number of hours/)
    expect(bad({}, { budget: { per: 'month' } })).toThrow(/budget.hours/)
    expect(bad({}, { budget: { hours: 10, per: 'year' } })).toThrow(/"week" or "month"/)
    expect(() => applyOps(emptyBoard(), [{ op: 'createTimeline', lanes: [{ name: 'Sam', capacity: -5 }] } as Op], ctx)).toThrow(/capacity/)
    // More than could ever be worked is brought down to the most there is.
    const huge = made({ op: 'createTimeline', lanes: [{ name: 'Sam', capacity: 999, entries: [{ title: 'Work', start: '2026-11-16', hours: 1e12 }] }] }).t
    expect(huge.lanes[0].capacity).toBe(TH.WEEK_MAX)
    expect(huge.entries[0].hours).toBe(TH.HOURS_MAX)
  })

  it('is read back by the assistant: on the board’s list, and in full', () => {
    const { b, item } = made()
    const line = objectLine(item)
    expect(line).toContain('Research 2026-11-16..2026-11-20 12 of 30 h')
    expect(line).toContain('Launch prep 2026-11-30..2026-12-04 8 h a day')
    expect(line).toContain('Docs 2026-11-23..2026-11-27 20 h (tentative)')
    expect(line).toContain('Go live 2026-12-07')
    expect(line).toContain('hours:"Sam: planned 70 h')
    expect(line).toContain('budget 200 h (35 h left)')
    const full = getObject(b, item.id) as { data: { totals: { planned: number }; inWords: string; lanes: unknown[] } }
    expect(full.data.totals.planned).toBe(165)
    expect(full.data.inWords).toContain('Priya: planned 70 h')
    expect(full.data.lanes).toHaveLength(3)
    // A plain timeline reads as it always did.
    const plain = made({ op: 'createTimeline', lanes: [{ name: 'Plan', entries: [{ title: 'Research', start: '2026-11-16', end: '2026-11-20' }] }] })
    expect(objectLine(plain.item)).toContain('lanes:"Plan[Research 2026-11-16..2026-11-20]"')
    expect(objectLine(plain.item)).not.toContain('hours:')
    expect('totals' in (getObject(plain.b, plain.item.id) as { data: object }).data).toBe(false)
  })
})

describe('hours that arrive from a file or from someone else', () => {
  it('are kept when they make sense, and left out when they don’t', () => {
    const { item } = made()
    // As it arrives: anything at all in any field.
    const raw = JSON.parse(JSON.stringify(item)) as Record<string, unknown> & { timeline: Record<string, unknown> & { lanes: Record<string, unknown>[]; entries: Record<string, unknown>[] } }
    expect(cleanItem(raw)!.timeline).toEqual(item.timeline)
    raw.timeline.time = false
    raw.timeline.currency = '  €uros and more'
    raw.timeline.budget = { hours: 1e12, per: 'fortnight' }
    raw.timeline.lanes[0] = { ...raw.timeline.lanes[0], capacity: 5000, budget: -3, rate: 'cheap' }
    raw.timeline.entries[0] = { ...raw.timeline.entries[0], hours: -4, per: 'day', spent: NaN, tentative: 'yes' }
    raw.timeline.entries[1] = { ...raw.timeline.entries[1], hours: 6, per: 'month', spent: 2, tentative: true }
    const t = cleanItem(raw)!.timeline!
    expect(t.time).toBe(false)
    expect(t.currency).toBe('€uro')
    expect(t.budget).toEqual({ hours: TH.HOURS_MAX })
    expect(t.lanes[0]).toEqual({ id: item.timeline!.lanes[0].id, name: 'Sam', capacity: TH.WEEK_MAX })
    expect(t.entries[0].hours).toBeUndefined()
    expect(t.entries[0].per).toBeUndefined()
    expect(t.entries[0].spent).toBeUndefined()
    expect(t.entries[0].tentative).toBeUndefined()
    expect(t.entries[1]).toMatchObject({ hours: 6, spent: 2, tentative: true })
    expect(t.entries[1].per).toBeUndefined()
    // No budget without a number of hours.
    raw.timeline.budget = { per: 'week' }
    expect(cleanItem(raw)!.timeline!.budget).toBeUndefined()
  })

  it('can be drawn by hand', () => {
    expect(canSketch('timeline')).toBe(true)
    const { item } = made()
    expect(cleanItem({ ...item, sketch: true })!.sketch).toBe(true)
  })
})
