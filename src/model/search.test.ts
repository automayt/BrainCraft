import { describe, expect, it } from 'vitest'
import { addItem, connect, emptyBoard, newItem } from './board'
import { addNote } from './notes'
import { lookup, search } from './search'
import type { Board, Item } from './types'

function board(): Board {
  let b = emptyBoard()
  const add = (i: Omit<Item, 'id'>) => {
    let id: number
    ;[b, id] = addItem(b, i)
    return id
  }
  const r = { x: 0, y: 0, w: 10, h: 10 }
  const a = add(newItem('sticky', r, { text: 'Launch plan for Q3' }))
  const c = add(newItem('flow', r, { text: 'Approve budget', shape: 'decision' }))
  add(
    newItem('table', r, {
      text: 'Vendors',
      table: { columns: [{ id: 'n', name: 'Name', width: 100 }, { id: 's', name: 'Status', width: 100 }], rows: [{ id: 'r1', cells: { n: 'Acme', s: 'Launch ready' } }] },
    }),
  )
  add(newItem('kanban', r, { text: 'Sprint', kanban: { columns: [{ id: 'k', title: 'Doing', cards: [{ id: 'x', title: 'Write launch blog' }] }] } }))
  b = addNote(b, c, 'Check with finance before launch')
  ;[b] = connect(b, a, c, { label: 'launch gate' })
  return b
}

describe('search', () => {
  it('finds matches everywhere, own text first', () => {
    const results = search(board(), 'launch')
    expect(results[0]).toMatchObject({ kind: 'sticky', where: 'Text' })
    const wheres = results.map((r) => r.where)
    expect(wheres).toContain('Comment')
    expect(wheres).toContain('Row 1 · Status')
    expect(wheres).toContain('Card in Doing')
    expect(wheres).toContain('Line label')
  })

  it('needs every word and can filter by kind', () => {
    const b = board()
    expect(search(b, 'launch blog').map((r) => r.where)).toEqual(['Card in Doing'])
    expect(search(b, 'launch', new Set(['flow'])).map((r) => r.where)).toEqual(['Comment'])
    expect(search(b, '   ')).toEqual([])
  })

  it('lists objects grouped by kind for lookup', () => {
    const entries = lookup(board())
    expect(entries.map((e) => e.kind)).toEqual(['sticky', 'flow', 'table', 'kanban'])
    expect(entries[1]).toMatchObject({ title: 'Approve budget', notes: 1 })
  })
})
