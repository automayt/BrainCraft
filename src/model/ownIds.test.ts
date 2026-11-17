import { describe, expect, it } from 'vitest'
import { applyOps, type Op } from '../api/ops'
import { addItem, emptyBoard, newItem } from './board'
import { fromJson, toJson } from './serialize'
import * as T from './table'
import { fakeMeasure } from './test-helpers'
import type { Board, Item } from './types'

const ctx = { measure: fakeMeasure }
const run = (ops: Op[], board = emptyBoard()) => applyOps(board, ops, ctx).board
const only = (b: Board, kind: Item['kind']) => b.items.find((i) => i.kind === kind)!
const distinct = (ids: string[]) => new Set(ids).size === ids.length

describe('rows, cards and spans that are alike are still each their own', () => {
  it('gives every row of a rewritten table its own identity, however many begin the same way', () => {
    const made = run([{ op: 'createTable', title: 'Decisions and actions', columns: ['Type', 'What'], rows: [['Action', 'Book it'], ['Decision', 'Move it']] }])
    const id = only(made, 'table').id
    const was = only(made, 'table').table!.rows
    const again = run([{ op: 'setTable', id, columns: ['Type', 'What'], rows: [['Action', 'Write it up'], ['Action', 'Book it'], ['Action', 'Send it'], ['Decision', 'Move it']] }], made)
    const t = only(again, 'table').table!
    expect(distinct(t.rows.map((r) => r.id))).toBe(true)
    // The rows that say what they said are the rows they were, wherever they are now.
    expect(t.rows[1].id).toBe(was[0].id)
    expect(t.rows[3].id).toBe(was[1].id)
    // So sorting shows each row once.
    const sorted = T.viewRows(T.setSort(t, t.columns[1].id))
    expect(sorted.map((r) => r.cells[t.columns[1].id])).toEqual(['Book it', 'Move it', 'Send it', 'Write it up'])
    expect(distinct(sorted.map((r) => r.id))).toBe(true)
    // And changing one cell changes one row.
    const changed = T.setCell(t, t.rows[0].id, t.columns[1].id, 'Write it all up')
    expect(changed.rows.map((r) => r.cells[t.columns[1].id])).toEqual(['Write it all up', 'Book it', 'Send it', 'Move it'])
  })

  it('keeps a hidden row hidden when it’s said again among rows that begin like it', () => {
    const made = run([{ op: 'createTable', title: 'Notes', columns: ['Type', 'What'], rows: [['Action', 'Book it'], ['Action', 'Send it']] }])
    const i = only(made, 'table')
    const hidden = { ...made, items: made.items.map((x) => (x.id === i.id ? { ...x, table: T.setRowHidden(i.table!, i.table!.rows[1].id, true) } : x)) }
    const again = run([{ op: 'setTable', id: i.id, columns: ['Type', 'What'], rows: [['Action', 'A new one'], ['Action', 'Send it'], ['Action', 'Book it']] }], hidden)
    const t = only(again, 'table').table!
    expect(t.rows.map((r) => `${r.cells[t.columns[1].id]}${r.hidden ? ' (hidden)' : ''}`)).toEqual(['A new one', 'Send it (hidden)', 'Book it'])
    expect(distinct(t.rows.map((r) => r.id))).toBe(true)
  })

  it('keeps a changed row’s identity by how it begins, once the unchanged ones have theirs', () => {
    const made = run([{ op: 'createTable', title: 'Agenda', columns: ['Item', 'Covered'], rows: [['Venue', ''], ['Budget', '']] }])
    const i = only(made, 'table')
    const again = run([{ op: 'setTable', id: i.id, columns: ['Item', 'Covered'], rows: [['Budget', '✓'], ['Venue', '']] }], made)
    const t = only(again, 'table').table!
    expect(t.rows.map((r) => r.id)).toEqual([i.table!.rows[1].id, i.table!.rows[0].id])
  })

  it('gives two columns of one name each their own cells', () => {
    const made = run([{ op: 'createTable', title: 'Notes', columns: ['Who'], rows: [['Sam']] }])
    const again = run([{ op: 'setTable', id: only(made, 'table').id, columns: ['Who', 'Who'], rows: [['Sam', 'Priya']] }], made)
    const t = only(again, 'table').table!
    expect(distinct(t.columns.map((c) => c.id))).toBe(true)
    expect(t.columns.map((c) => t.rows[0].cells[c.id])).toEqual(['Sam', 'Priya'])
  })

  it('gives two Kanban cards of one title each their own identity', () => {
    const made = run([{ op: 'createKanban', title: 'Actions', columns: [{ title: 'To do', cards: ['Follow up'] }, { title: 'Done' }] }])
    const id = only(made, 'kanban').id
    const card = only(made, 'kanban').kanban!.columns[0].cards[0].id
    const again = run([{ op: 'setKanban', id, columns: [{ title: 'To do', cards: ['Follow up', 'Follow up'] }, { title: 'Done', cards: ['Follow up'] }, { title: 'Done' }] }], made)
    const k = only(again, 'kanban').kanban!
    const cards = k.columns.flatMap((c) => c.cards.map((x) => x.id))
    expect(cards).toHaveLength(3)
    expect(distinct(cards)).toBe(true)
    expect(cards[0]).toBe(card)
    expect(distinct(k.columns.map((c) => c.id))).toBe(true)
  })

  it('gives two spans of one name each their own identity, and each keeps its own hours', () => {
    const made = run([
      {
        op: 'createTimeline',
        title: 'Launch',
        lanes: [
          { name: 'Sam', entries: [{ title: 'Launch prep', start: '2026-12-01', end: '2026-12-04', hours: 20 }] },
          { name: 'Priya', entries: [{ title: 'Launch prep', start: '2026-12-01', end: '2026-12-04', hours: 12 }, { title: 'Docs', start: '2026-11-23', end: '2026-11-27', hours: 30 }] },
        ],
      } as Op,
    ])
    const id = only(made, 'timeline').id
    const before = only(made, 'timeline').timeline!
    // Sent again without hours, Priya first, and Docs given to Sam.
    const again = run(
      [
        {
          op: 'setTimeline',
          id,
          lanes: [
            { name: 'Priya', entries: [{ title: 'Launch prep', start: '2026-12-01', end: '2026-12-04' }] },
            { name: 'Sam', entries: [{ title: 'Launch prep', start: '2026-12-01', end: '2026-12-04' }, { title: 'Docs', start: '2026-11-23', end: '2026-11-27' }] },
          ],
        } as Op,
      ],
      made,
    )
    const t = only(again, 'timeline').timeline!
    expect(distinct(t.entries.map((e) => e.id))).toBe(true)
    const lane = (name: string) => t.lanes.find((l) => l.name === name)!.id
    const hours = (name: string, title: string) => t.entries.find((e) => e.lane === lane(name) && e.title === title)?.hours
    expect([hours('Sam', 'Launch prep'), hours('Priya', 'Launch prep'), hours('Sam', 'Docs')]).toEqual([20, 12, 30])
    // Each is the span it was.
    const idOf = (data: typeof t, who: string, title: string) => data.entries.find((e) => e.lane === data.lanes.find((l) => l.name === who)!.id && e.title === title)!.id
    expect(idOf(t, 'Sam', 'Launch prep')).toBe(idOf(before, 'Sam', 'Launch prep'))
    expect(idOf(t, 'Priya', 'Launch prep')).toBe(idOf(before, 'Priya', 'Launch prep'))
    expect(idOf(t, 'Sam', 'Docs')).toBe(idOf(before, 'Priya', 'Docs'))
  })
})

describe('boards that already have rows sharing an identity are put right when read', () => {
  const read = (b: Board) => fromJson(toJson(b))
  const withItem = (kind: Item['kind'], more: Partial<Item>) => addItem(emptyBoard(), newItem(kind, { x: 0, y: 0, w: 400, h: 200 }, more))[0]

  it('gives each row and column of a table its own, the same way every time', () => {
    const table = {
      columns: [{ id: 'a', name: 'Type', width: 150 }, { id: 'b', name: 'What', width: 150 }, { id: 'b', name: 'Who', width: 150 }],
      rows: [
        { id: 'r', cells: { a: 'Action', b: 'Book it' } },
        { id: 'r', cells: { a: 'Action', b: 'Send it' } },
        { id: 'r~2', cells: { a: 'Decision', b: 'Move it' } },
        { id: 'r', cells: { a: 'Action', b: 'Write it' }, hidden: true },
      ],
    }
    const b = withItem('table', { text: 'Decisions', table })
    const t = only(read(b), 'table').table!
    expect(t.rows.map((r) => r.id)).toEqual(['r', 'r~2', 'r~2~2', 'r~3'])
    expect(t.rows.map((r) => r.cells.b)).toEqual(['Book it', 'Send it', 'Move it', 'Write it'])
    expect(t.rows[3].hidden).toBe(true)
    // The two columns that shared an id showed the same cells: each has them now, under its own.
    expect(t.columns.map((c) => c.id)).toEqual(['a', 'b', 'b~2'])
    expect(t.rows.map((r) => r.cells['b~2'])).toEqual(['Book it', 'Send it', 'Move it', 'Write it'])
    // Read again (by someone else, or tomorrow): the same ids, so everyone agrees which row is which.
    expect(only(read(b), 'table').table).toEqual(t)
    // And once put right, reading changes nothing more.
    expect(only(read(read(b)), 'table').table).toEqual(t)
  })

  it('leaves a table whose rows are each their own exactly as it was', () => {
    const made = run([{ op: 'createTable', title: 'Notes', columns: ['Type', 'What'], rows: [['Action', 'Book it'], ['Action', 'Send it']] }])
    expect(only(read(made), 'table').table).toEqual(only(made, 'table').table)
  })

  it('does the same for Kanban cards and columns, and a timeline’s lanes and spans', () => {
    const kanban = { columns: [{ id: 'c', title: 'To do', cards: [{ id: 'k', title: 'Follow up' }, { id: 'k', title: 'Follow up' }] }, { id: 'c', title: 'Done', cards: [{ id: 'k', title: 'Follow up' }] }] }
    const k = only(read(withItem('kanban', { text: 'Actions', kanban })), 'kanban').kanban!
    expect(k.columns.map((c) => c.id)).toEqual(['c', 'c~2'])
    expect(k.columns.flatMap((c) => c.cards.map((x) => x.id))).toEqual(['k', 'k~2', 'k~3'])
    const timeline = {
      lanes: [{ id: 'l', name: 'Sam' }, { id: 'l', name: 'Priya' }],
      entries: [{ id: 'e', lane: 'l', title: 'Launch prep', start: '2026-12-01', color: '#888' }, { id: 'e', lane: 'l', title: 'Launch prep', start: '2026-12-01', color: '#888' }],
    }
    const t = only(read(withItem('timeline', { text: 'Launch', timeline })), 'timeline').timeline!
    expect(t.lanes.map((l) => l.id)).toEqual(['l', 'l~2'])
    expect(t.entries.map((e) => e.id)).toEqual(['e', 'e~2'])
  })

  it('never makes an id longer than an id can be', () => {
    const long = 'x'.repeat(64)
    const table = { columns: [{ id: 'a', name: 'A', width: 150 }], rows: [{ id: long, cells: {} }, { id: long, cells: {} }, { id: long, cells: {} }] }
    const ids = only(read(withItem('table', { text: 'T', table })), 'table').table!.rows.map((r) => r.id)
    expect(distinct(ids)).toBe(true)
    expect(Math.max(...ids.map((x) => x.length))).toBeLessThanOrEqual(64)
  })
})
