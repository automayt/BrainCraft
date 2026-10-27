import { describe, expect, it } from 'vitest'
import { applyOps } from '../api/ops'
import { diff, applyPatches } from '../collab/patch'
import { addItem, emptyBoard, newItem } from './board'
import * as D from './dataset'
import { fromJson, toJson } from './serialize'
import { fakeMeasure } from './test-helpers'
import * as T from './timeTracking'
import type { Board } from './types'
import * as W from './wiki'
import { readBoard } from '../../server/boardReads'

const H = 3_600_000
const M = 60_000
const T0 = new Date(2026, 9, 26, 9, 0).getTime()
const ann = { name: 'Ann', user: 'u-ann' }
const bo = { name: 'Bo' }

function board() {
  let b = emptyBoard()
  let a: number, c: number
  ;[b, a] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'Design the logo' }))
  ;[b, c] = addItem(b, newItem('rect', { x: 200, y: 0, w: 100, h: 100 }, { text: 'Write the copy' }))
  return { b, a, c }
}

describe('time tracking', () => {
  it('runs one timer per person, stopping the last when a new one starts', () => {
    let { b, a, c } = board()
    const first = T.startTimer(b, { ...ann, on: { item: a }, now: T0 })
    b = first.board
    expect(T.runningFor(b, ann)?.id).toBe(first.id)
    // Bo's timer runs alongside Ann's.
    b = T.startTimer(b, { ...bo, on: { item: a }, now: T0 + 5 * M }).board
    const second = T.startTimer(b, { ...ann, on: { item: c }, note: 'first draft', now: T0 + 30 * M })
    b = second.board
    expect(second.stopped).toMatchObject({ id: first.id, end: T0 + 30 * M })
    expect(T.running(b).map((e) => e.who).sort()).toEqual(['Ann', 'Bo'])
    // Ann by account, whatever her name is now.
    expect(T.runningFor(b, { name: 'Ann Smith', user: 'u-ann' })?.id).toBe(second.id)
    const stop = T.stopTimer(b, ann, T0 + 90 * M)
    b = stop.board
    expect(stop.stopped).toMatchObject({ start: T0 + 30 * M, end: T0 + 90 * M, note: 'first draft', label: 'Write the copy' })
    expect(T.stopTimer(b, ann, T0 + 2 * H).stopped).toBeUndefined()
    const totals = T.itemTime(b, T0 + 2 * H)
    expect(totals.get(a)).toEqual({ ms: 30 * M + 115 * M, running: ['Bo'] })
    expect(totals.get(c)).toEqual({ ms: 60 * M, running: [] })
  })

  it('logs time by hand for someone else, and refuses times that can’t be right', () => {
    const { b, a } = board()
    const { board: logged, id } = T.logTime(b, { ...bo, by: 'Ann', on: { item: a }, start: T0, end: T0 + 45 * M, note: 'call' })
    expect(logged.time![0]).toMatchObject({ id, who: 'Bo', by: 'Ann', on: { item: a }, label: 'Design the logo', note: 'call' })
    expect(() => T.logTime(b, { ...bo, start: T0, end: T0 })).toThrow(/after the start/)
    expect(() => T.logTime(b, { ...bo, start: T0, end: T0 + 8 * 24 * H })).toThrow(/a week at most/)
    expect(() => T.logTime(b, { ...bo, start: NaN, end: T0 })).toThrow(/valid/)
  })

  it('edits entries without letting them go wrong', () => {
    let { b, a } = board()
    const { board: b1, id } = T.logTime(b, { ...ann, start: T0, end: T0 + H })
    b = T.startTimer(b1, { ...ann, on: { item: a }, now: T0 + 2 * H }).board
    b = T.updateEntry(b, id, { end: T0 + 30 * M, note: '  fixed  ', on: { item: a } })
    expect(b.time![0]).toMatchObject({ end: T0 + 30 * M, note: 'fixed', label: 'Design the logo' })
    expect(() => T.updateEntry(b, id, { end: T0 - M })).toThrow(/after the start/)
    // Ann already has a timer running: this one can't run again too.
    expect(() => T.updateEntry(b, id, { end: null })).toThrow(/already has a timer running/)
    b = T.updateEntry(b, id, { who: bo, on: null })
    expect(b.time![0]).toMatchObject({ who: 'Bo' })
    expect(b.time![0].user).toBeUndefined()
    expect(b.time![0].on).toBeUndefined()
    expect(T.deleteEntry(b, id).time).toHaveLength(1)
    expect(() => T.updateEntry(b, 'nope', { note: 'x' })).toThrow(/gone/)
  })

  it('sums up by person, by what it was on and by day, cut to a span', () => {
    let { b, a, c } = board()
    // Ann: 22:00 to 02:00 across midnight on a; Bo: an hour on c the next morning.
    const night = new Date(2026, 9, 26, 22, 0).getTime()
    b = T.logTime(b, { ...ann, on: { item: a }, start: night, end: night + 4 * H }).board
    b = T.logTime(b, { ...bo, on: { item: c }, start: night + 12 * H, end: night + 13 * H }).board
    const all = T.summarize(b, {}, night + 20 * H)
    expect(T.hours(all.total)).toBe(5)
    expect(all.byPerson.map((p) => [p.who, T.hours(p.ms)])).toEqual([
      ['Ann', 4],
      ['Bo', 1],
    ])
    expect(all.byDay).toEqual([
      { day: '2026-10-26', ms: 2 * H },
      { day: '2026-10-27', ms: 3 * H },
    ])
    // The 27th only: Ann's time after midnight, and Bo's.
    const day = T.summarize(b, { from: new Date(2026, 9, 27).getTime(), to: new Date(2026, 9, 28).getTime() }, night + 20 * H)
    expect(T.hours(day.total)).toBe(3)
    expect(T.summarize(b, { who: bo }, night + 20 * H).byTarget.map((t) => t.label)).toEqual(['Write the copy'])
    expect(T.summarize(b, { on: { item: a } }, night + 20 * H).total).toBe(4 * H)
  })

  it('totals a mind-map branch, and keeps a deleted target’s name', () => {
    let b = applyOps(emptyBoard(), [{ op: 'createMindMap', outline: 'Launch\n- Site\n  - Copy\n- Ads' }], { measure: fakeMeasure }).board
    const id = (t: string) => b.items.find((i) => i.text === t)!.id
    b = T.logTime(b, { ...ann, on: { item: id('Copy') }, start: T0, end: T0 + H }).board
    b = T.logTime(b, { ...ann, on: { item: id('Site') }, start: T0 + H, end: T0 + 2 * H }).board
    b = T.logTime(b, { ...ann, on: { item: id('Ads') }, start: T0 + 2 * H, end: T0 + 3 * H }).board
    expect(T.branchTime(b, id('Site'), T0)).toBe(2 * H)
    expect(T.branchTime(b, b.items.find((i) => i.kind === 'mind' && i.parent === undefined)!.id, T0)).toBe(3 * H)
    expect(T.summarize(b, { on: { item: id('Site') } }, T0).total).toBe(2 * H)
    const copy = id('Copy')
    b = { ...b, items: b.items.filter((i) => i.id !== copy) }
    expect(T.describeTarget(b, { item: copy }, 'Copy')).toEqual({ kind: 'object', label: 'Copy', gone: true })
  })

  it('flags someone tracking two things at once', () => {
    let { b } = board()
    b = T.logTime(b, { ...ann, start: T0, end: T0 + H }).board
    b = T.logTime(b, { ...ann, start: T0 + 30 * M, end: T0 + 2 * H }).board
    b = T.logTime(b, { ...bo, start: T0, end: T0 + H }).board
    b = T.logTime(b, { ...ann, start: T0 + 3 * H, end: T0 + 4 * H }).board
    const ids = b.time!.map((e) => e.id)
    expect([...T.overlapping(b, T0)].sort()).toEqual([ids[0], ids[1]].sort())
  })

  it('reads durations as people type them', () => {
    expect(T.parseDuration('90')).toBe(90)
    expect(T.parseDuration('1h 30m')).toBe(90)
    expect(T.parseDuration('1.5h')).toBe(90)
    expect(T.parseDuration('1,5 hours')).toBe(90)
    expect(T.parseDuration('1:30')).toBe(90)
    expect(T.parseDuration('2 hours and 15 minutes')).toBe(135)
    expect(T.parseDuration('1d')).toBe(1440)
    expect(T.parseDuration('soon')).toBeNull()
    expect(T.parseDuration('1h tea')).toBeNull()
    expect(T.parseDuration('0')).toBeNull()
    expect(T.formatDuration(90 * M)).toBe('1h 30m')
    expect(T.formatDuration(2 * H)).toBe('2h')
    expect(T.formatDuration(20_000)).toBe('<1m')
    expect(T.formatClock(3723_000)).toBe('1:02:03')
  })

  it('keeps entries through a save and a live session, dropping bad ones', () => {
    let { b, a } = board()
    b = T.startTimer(b, { ...ann, on: { item: a }, now: T0 }).board
    b = T.logTime(b, { ...bo, start: T0, end: T0 + H }).board
    const raw = JSON.parse(toJson(b)) as Board
    raw.time!.push({ id: 'bad', who: 'X', start: T0, end: T0 - 1 }, { id: 'bad2', who: '', start: T0 }, { ...raw.time![0] })
    const back = fromJson(JSON.stringify(raw))
    expect(back.time).toHaveLength(2)
    expect(back.time![0].end).toBeUndefined()
    // Each entry its own patch: two people's changes never clash.
    const stopped = T.stopTimer(back, ann, T0 + H).board
    const patches = diff(back, stopped)
    expect(patches).toEqual([{ k: 'time', id: back.time![0].id, v: stopped.time![0] }])
    expect(applyPatches(back, patches).time).toEqual(stopped.time)
    expect(applyPatches(stopped, [{ k: 'time', id: stopped.time![0].id, v: null }]).time).toHaveLength(1)
  })

  it('assigns people and estimates, only to what can have a status', () => {
    let { b, a, c } = board()
    let f: number
    ;[b, f] = addItem(b, newItem('frame', { x: 0, y: 300, w: 100, h: 100 }))
    b = T.assign(b, [a, c, f], ['Ann', ' ann ', 'Bo'])
    expect(b.items.map((i) => i.assignees)).toEqual([['Ann', 'Bo'], ['Ann', 'Bo'], undefined])
    b = T.assign(b, [a], ['bo'], 'remove')
    b = T.assign(b, [c], ['Cy'], 'add')
    expect(b.items.map((i) => i.assignees)).toEqual([['Ann'], ['Ann', 'Bo', 'Cy'], undefined])
    b = T.setEstimate(b, [a, f], 90)
    expect(b.items.map((i) => i.estimate)).toEqual([90, undefined, undefined])
    const back = fromJson(toJson(b))
    expect(back.items[1].assignees).toEqual(['Ann', 'Bo', 'Cy'])
    expect(back.items[0].estimate).toBe(90)
    expect(T.peopleOn(b, ['Dee'])).toEqual(['Ann', 'Bo', 'Cy', 'Dee'])
    b = T.assign(b, [a], [])
    expect(b.items[0].assignees).toBeUndefined()
  })

  it('shows time tracked on database records, for rollups to sum', () => {
    let b = applyOps(emptyBoard(), [{ op: 'createDatabase', title: 'Tasks', fields: ['Task'], records: [{ Task: 'Logo' }, { Task: 'Copy' }] }], { measure: fakeMeasure }).board
    const ds = b.datasets![0]
    b = D.updateDataset(b, ds.id, (d) => D.addField(d, 'Time', 'tracked')[0])
    b = T.logTime(b, { ...ann, on: { dataset: ds.id, record: ds.records[0].id }, start: T0, end: T0 + 90 * M }).board
    b = T.startTimer(b, { ...bo, on: { dataset: ds.id, record: ds.records[0].id }, now: T0 }).board
    const shown = D.withComputed(b, D.getDataset(b, ds.id)!, new Date(T0 + 30 * M))
    const f = D.fieldByName(shown, 'Time')!
    expect(shown.records.map((r) => r.values[f.id])).toEqual([2, undefined])
    expect(D.display(shown, f, 2)).toBe('2h')
    expect(T.describeTarget(b, { dataset: ds.id, record: ds.records[0].id }).label).toBe('Logo (Tasks)')
  })
})

describe('time through operations', () => {
  const run = (b: Board, ops: Parameters<typeof applyOps>[1], who?: T.Person, now = T0) => applyOps(b, ops, { measure: fakeMeasure, now, ...(who ? { who } : {}) })

  it('starts, stops and logs time, for whoever is asking or someone named', () => {
    let { b, a } = board()
    b = run(b, [{ op: 'startTimer', on: a, note: 'sketches' }], ann).board
    expect(T.runningFor(b, ann)).toMatchObject({ who: 'Ann', user: 'u-ann', on: { item: a }, note: 'sketches' })
    b = run(b, [{ op: 'stopTimer', at: T0 + 30 * M }], ann, T0 + H).board
    expect(b.time![0].end).toBe(T0 + 30 * M)
    const logged = run(b, [{ op: 'logTime', who: 'Bo', on: a, duration: '1h 15m', end: '2026-10-26T12:00' }], ann)
    expect(logged.results[0].entry).toBeTruthy()
    expect(logged.board.time![1]).toMatchObject({ who: 'Bo', by: 'Ann', start: new Date(2026, 9, 26, 10, 45).getTime(), end: new Date(2026, 9, 26, 12, 0).getTime() })
    // Naming yourself keeps your account.
    expect(run(b, [{ op: 'logTime', who: 'ann', duration: 30 }], ann).board.time![1].user).toBe('u-ann')
    expect(() => run(b, [{ op: 'startTimer' }])).toThrow(/whose time/)
    expect(() => run(b, [{ op: 'stopTimer', who: 'Cy' }], ann)).toThrow(/no timer running/)
    expect(() => run(b, [{ op: 'logTime', duration: 'soon' }], ann)).toThrow(/"duration"/)
    expect(() => run(b, [{ op: 'logTime', start: '09:00', end: '08:00' }], ann)).toThrow(/after the start/)
    const id = logged.results[0].entry!
    expect(run(logged.board, [{ op: 'deleteTime', entry: id }], ann).board.time).toHaveLength(1)
  })

  it('puts time on database records and wiki pages by name', () => {
    let b = applyOps(emptyBoard(), [{ op: 'createDatabase', title: 'Tasks', fields: ['Task'], records: [{ Task: 'Logo' }] }], { measure: fakeMeasure }).board
    b = run(b, [{ op: 'logTime', on: { record: 'logo' }, duration: '2h' }], ann).board
    expect(b.time![0].on).toEqual({ dataset: b.datasets![0].id, record: b.datasets![0].records[0].id })
    expect(() => run(b, [{ op: 'logTime', on: { record: 'Nope' }, duration: '2h' }], ann)).toThrow(/matches no record/)
    let w = W.emptyWiki('Team')
    ;[w] = W.addPage(w, { title: 'Budget' })
    w = run(w, [{ op: 'startTimer', on: { page: 'Budget' } }], ann).board
    expect(T.describeTarget(w, T.runningFor(w, ann)!.on).label).toBe('Budget')
  })

  it('assigns people and sets estimates with update', () => {
    let { b, a } = board()
    b = run(b, [{ op: 'update', id: a, assignees: ['Ann', 'Bo'], estimate: '1h 30m' }]).board
    expect(b.items[0]).toMatchObject({ assignees: ['Ann', 'Bo'], estimate: 90 })
    b = run(b, [{ op: 'update', id: a, assignees: null, estimate: null }]).board
    expect(b.items[0].assignees).toBeUndefined()
    expect(b.items[0].estimate).toBeUndefined()
    expect(() => run(b, [{ op: 'update', id: a, estimate: 'whenever' }])).toThrow(/"estimate"/)
  })

  it('reads time over HTTP, as JSON or CSV, without hidden notes’ words', () => {
    let { b, a } = board()
    b = T.logTime(b, { ...ann, on: { item: a }, start: T0, end: T0 + 90 * M, note: 'first pass' }).board
    b = T.logTime(b, { ...bo, start: T0, end: T0 + 30 * M }).board
    const r = readBoard(b, ['time'], new URLSearchParams())!
    expect(r.body).toMatchObject({ hours: 2, byPerson: [{ who: 'Ann', hours: 1.5 }, { who: 'Bo', hours: 0.5 }] })
    const mine = readBoard(b, ['time'], new URLSearchParams('who=bo'))!
    expect((mine.body as { hours: number }).hours).toBe(0.5)
    const csv = readBoard(b, ['time'], new URLSearchParams('format=csv'))!.text!
    expect(csv.split('\n')[0]).toBe('Person,On,Kind,Start,End,Hours,Note,Logged by')
    expect(csv).toContain('Ann,Design the logo,object,')
    expect(readBoard(b, ['time'], new URLSearchParams('from=nope'))!.status).toBe(400)
    // A hidden brainstorm note keeps its words, even as a timer's target.
    let h: number
    ;[b, h] = addItem(b, newItem('sticky', { x: 0, y: 400, w: 100, h: 100 }, { text: 'secret idea', hiddenBy: 'Bo' }))
    b = T.startTimer(b, { ...bo, on: { item: h }, now: T0 }).board
    expect(JSON.stringify(readBoard(b, ['time'], new URLSearchParams())!.body)).not.toContain('secret idea')
  })
})
