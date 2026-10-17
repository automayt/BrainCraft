import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, newItem } from './board'
import * as K from './kanban'
import * as T from './table'
import * as TL from './timeline'
import type { TableData } from './types'

function people(): TableData {
  return T.tableFromText('Name\tAge\tCity\nZoe\t9\tOslo\nAdam\t31\tRome\nMia\t100\t\nBo\t\tOslo')
}

const names = (t: TableData) => T.viewRows(t).map((r) => r.cells[t.columns[0].id])

describe('tables', () => {
  it('builds from pasted cells, first row as headers', () => {
    const t = people()
    expect(t.columns.map((c) => c.name)).toEqual(['Name', 'Age', 'City'])
    expect(t.rows).toHaveLength(4)
    expect(T.looksTabular('a\tb\nc\td')).toBe(true)
    expect(T.looksTabular('just\ttext')).toBe(false)
  })

  it('sorts numbers naturally, empties last, and cycles direction', () => {
    let t = people()
    const age = t.columns[1].id
    t = T.cycleSort(t, age)
    expect(names(t)).toEqual(['Zoe', 'Adam', 'Mia', 'Bo'])
    t = T.cycleSort(t, age)
    expect(names(t)).toEqual(['Mia', 'Adam', 'Zoe', 'Bo'])
    t = T.cycleSort(t, age)
    expect(t.sort).toBeUndefined()
  })

  it('filters by column, case-insensitively', () => {
    let t = people()
    t = T.setFilter(t, t.columns[2].id, 'oSL')
    expect(names(t)).toEqual(['Zoe', 'Bo'])
    expect(T.activeFilters(t)).toBe(1)
    t = T.setFilter(t, t.columns[2].id, '')
    expect(names(t)).toHaveLength(4)
  })

  it('hides and restores rows and columns', () => {
    let t = people()
    t = T.setRowHidden(t, t.rows[0].id, true)
    t = T.setColumnHidden(t, t.columns[2].id, true)
    expect(names(t)).toEqual(['Adam', 'Mia', 'Bo'])
    expect(T.viewColumns(t).map((c) => c.name)).toEqual(['Name', 'Age'])
    expect(T.hiddenCount(t)).toEqual({ rows: 1, columns: 1 })
    expect(T.viewRows({ ...t, showHidden: true })).toHaveLength(4)
    t = T.unhideAll(t)
    expect(T.hiddenCount(t)).toEqual({ rows: 0, columns: 0 })
  })

  it('inserts and deletes rows and columns', () => {
    let t = people()
    let col: string, row: string
    ;[t, col] = T.addColumn(t, t.columns[0].id, 'Email')
    expect(t.columns.map((c) => c.name)).toEqual(['Name', 'Email', 'Age', 'City'])
    ;[t, row] = T.addRow(t, t.rows[0].id, true)
    expect(t.rows[0].id).toBe(row)
    t = T.setCell(t, row, col, 'x@y.z')
    t = T.cycleSort(t, col)
    t = T.deleteColumn(t, col)
    expect(t.sort).toBeUndefined()
    expect(t.rows[0].cells).toEqual({})
    expect(T.deleteRow(t, row).rows).toHaveLength(4)
  })

  it('exports what is shown as CSV and sizes itself to fit', () => {
    let t = people()
    t = T.setFilter(t, t.columns[0].id, 'a')
    t = T.setRowHidden(t, t.rows[1].id, true)
    expect(T.toCsv(t)).toBe('Name,Age,City\nMia,100,')
    expect(T.parseDelimited('a,"b, c","say ""hi"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ])
    const small = T.tableSize(T.newTable(['A'], 1))
    const big = T.tableSize(people())
    expect(big.h).toBeGreaterThan(small.h)
  })
})

describe('kanban', () => {
  it('adds, edits, moves and deletes cards', () => {
    let k = K.newKanban()
    const [todo, doing] = k.columns
    let id: string
    expect(todo.cards).toEqual([])
    ;[k] = K.addCard(k, todo.id, 'Seed')
    ;[k, id] = K.addCard(k, todo.id, 'Write spec')
    k = K.updateCard(k, id, { due: '2026-10-20', color: '#f00' })
    k = K.updateCard(k, id, { color: '' })
    expect(K.findCard(k, id)).toMatchObject({ card: { title: 'Write spec', due: '2026-10-20' }, column: 0, index: 1 })
    expect(K.findCard(k, id)!.card.color).toBeUndefined()
    k = K.moveCard(k, id, doing.id, 0)
    expect(K.findCard(k, id)).toMatchObject({ column: 1, index: 0 })
    k = K.moveCard(k, k.columns[0].cards[0].id, doing.id, 5)
    expect(k.columns[1].cards.map((c) => c.title)).toEqual(['Write spec', 'Seed'])
    expect(K.deleteCard(k, id).columns[1].cards).toHaveLength(1)
  })

  it('manages columns', () => {
    let k = K.newKanban()
    let id: string
    ;[k, id] = K.addColumn(k, 'Review')
    k = K.renameColumn(k, id, 'QA')
    k = K.moveColumn(k, id, -1)
    expect(k.columns.map((c) => c.title)).toEqual(['To do', 'In progress', 'QA', 'Done'])
    expect(K.moveColumn(k, k.columns[0].id, -1)).toBe(k)
    expect(K.deleteColumn(k, id).columns).toHaveLength(3)
  })
})

describe('timeline', () => {
  const NOW = TL.toDay('2026-10-14')

  it('converts dates', () => {
    expect(TL.fromDay(TL.toDay('2026-02-28') + 1)).toBe('2026-03-01')
    expect(TL.today(new Date(2026, 9, 14, 23, 30))).toBe(NOW)
  })

  it('fits the range to entries and today, with a margin', () => {
    const t = TL.newTimeline(NOW)
    const r = TL.visibleRange(t, t.entries, NOW)
    expect(r.start).toBeLessThan(NOW - 3)
    expect(r.end).toBeGreaterThan(NOW + 21)
    expect(TL.visibleRange({ ...t, range: { start: '2026-01-01', end: '2026-01-31' } }, t.entries).end - TL.toDay('2026-01-01')).toBe(30)
  })

  it('labels the axis by day, week or month', () => {
    const start = TL.toDay('2026-10-01')
    expect(TL.ticks(start, start + 6, 40).map((x) => x.label)).toEqual(['Oct 1', '2', '3', '4', '5', '6', '7'])
    expect(TL.ticks(start, start + 14, 10).map((x) => x.label)).toEqual(['Oct 5', 'Oct 12'])
    expect(TL.ticks(start, start + 100, 2).map((x) => x.label)).toEqual(['Oct', 'Nov', 'Dec', 'Jan 2027'])
  })

  it('stacks overlapping entries in a lane', () => {
    const e = (id: string, start: string, end?: string) => ({ id, lane: 'a', title: id, start, end, color: '#000' })
    const rows = TL.packRows([e('a', '2026-10-01', '2026-10-05'), e('b', '2026-10-03', '2026-10-04'), e('c', '2026-10-06'), e('d', '2026-10-07')], 3)
    expect(Object.fromEntries(rows)).toEqual({ a: 0, b: 1, c: 0, d: 1 })
  })

  it('moves and resizes entries', () => {
    expect(TL.shiftDates({ start: '2026-10-01', end: '2026-10-05' }, 3)).toEqual({ start: '2026-10-04', end: '2026-10-08' })
    expect(TL.shiftDates({ start: '2026-10-01', end: '2026-10-05' }, 10, 'start')).toEqual({ start: '2026-10-04', end: '2026-10-05' })
    expect(TL.shiftDates({ start: '2026-10-01', end: '2026-10-05' }, -10, 'end')).toEqual({ start: '2026-10-01', end: '2026-10-02' })
    expect(TL.shiftDates({ start: '2026-10-01' }, -1)).toEqual({ start: '2026-09-30', end: undefined })
  })

  it('shows dated cards from followed Kanban boards and flags overdue ones', () => {
    let k = K.newKanban()
    let late: string, done: string, undated: string
    ;[k, late] = K.addCard(k, k.columns[0].id, 'Late')
    k = K.updateCard(k, late, { start: '2026-10-01', due: '2026-10-10' })
    ;[k, done] = K.addCard(k, k.columns[2].id, 'Shipped')
    k = K.updateCard(k, done, { due: '2026-10-02' })
    ;[k, undated] = K.addCard(k, k.columns[1].id, 'Someday')
    let b = emptyBoard()
    let kid: number
    ;[b, kid] = addItem(b, newItem('kanban', { x: 0, y: 0, w: 1, h: 1 }, { text: 'Sprint', kanban: k }))
    const t = TL.toggleSource({ lanes: [], entries: [] }, kid)
    const shown = TL.shownTimeline(b, t, NOW)
    expect(shown.lanes).toEqual([{ id: `kanban:${kid}`, name: 'Sprint', linked: true }])
    expect(shown.entries.map((e) => [e.title, e.start, e.end, e.overdue, e.done])).toEqual([
      ['Late', '2026-10-01', '2026-10-10', true, false],
      ['Shipped', '2026-10-02', undefined, false, true],
    ])
    expect(undated).toBeTruthy()
    expect(TL.toggleSource(t, kid).sources).toEqual([])
  })

  it('zooms and pans the range', () => {
    const r = { start: TL.toDay('2026-10-01'), end: TL.toDay('2026-10-31') }
    expect(TL.zoomRange(r, 0.5)).toEqual({ start: '2026-10-09', end: '2026-10-24' })
    expect(TL.panRange(r, 7).start).toBe('2026-10-08')
  })
})
