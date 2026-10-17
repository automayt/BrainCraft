import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, newItem, updateItem } from '../model/board'
import { addNote, linkToken } from '../model/notes'
import type { Board } from '../model/types'
import { MemoryKV } from './kv'
import { Library } from './library'
import { LinkIndex, linkKey } from './links'

function boardWith(title: string, description = '', note = ''): Board {
  let b: Board = { ...emptyBoard(), title }
  let id: number
  ;[b, id] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 10, h: 10 }, { text: `${title} sticky` }))
  if (description) b = updateItem(b, id, (i) => ({ ...i, description }))
  if (note) b = addNote(b, id, note, 'Sam', 1)
  return b
}

describe('links between boards', () => {
  it('finds links to a board from the others, by key and by name', async () => {
    const lib = new Library(new MemoryKV())
    let t = 1000
    lib.now = () => t++
    const cars = await lib.create(boardWith('Cars'))
    const garage = await lib.create(boardWith('Garage', `Next up: ${linkToken('Cars', { board: cars })}`))
    const todo = await lib.create(boardWith('Todo', '', 'Check [[cars]] and [[Cars]] again'))
    await lib.create(boardWith('Other', 'Nothing here'))
    const index = new LinkIndex(lib)

    const found = await index.to([cars], await lib.list(), cars)
    expect(found.map((l) => [l.boardTitle, l.fromLabel, l.note ? 'comment' : 'description', l.text])).toEqual(
      expect.arrayContaining([
        ['Garage', 'Garage sticky', 'description', 'Next up: Cars'],
        ['Todo', 'Todo sticky', 'comment', 'Check cars and Cars again'],
      ]),
    )
    expect(found).toHaveLength(2)
    expect(found.find((l) => l.boardId === todo)?.note?.author).toBe('Sam')

    // Renaming the target changes what [[Name]] links point at; the index notices.
    await lib.rename(cars, 'Vehicles')
    const after = await index.to([cars], await lib.list(), cars)
    expect(after.map((l) => l.boardId)).toEqual([garage])
  })

  it('uses the live-session id as the link key once a board is shared', () => {
    expect(linkKey({ id: 'local' })).toBe('local')
    expect(linkKey({ id: 'local', live: { server: 's', id: 'live1', key: 'k', role: 'edit' } })).toBe('live1')
  })
})
