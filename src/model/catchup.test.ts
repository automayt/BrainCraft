import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, newItem, remove, updateItem } from './board'
import { catchUp, catchUpSummary, catchUpText } from './catchup'
import { addNote } from './notes'
import type { Board, Id } from './types'

function base(): [Board, Id, Id, Id] {
  let b = emptyBoard('Trip')
  let a: Id, z: Id, gone: Id
  ;[b, a] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'Lisbon' }))
  ;[b, z] = addItem(b, newItem('sticky', { x: 200, y: 0, w: 100, h: 100 }, { text: 'Porto' }))
  ;[b, gone] = addItem(b, newItem('sticky', { x: 400, y: 0, w: 100, h: 100 }, { text: 'Faro' }))
  return [b, a, z, gone]
}

describe('since you were here', () => {
  it('finds new, changed and removed objects and new comments', () => {
    const [before, a, z, gone] = base()
    let now = updateItem(before, a, (i) => ({ ...i, text: 'Lisbon (2 nights)' }))
    now = addNote(now, z, 'Booked!', 'Sam', 1)
    now = remove(now, new Set([gone]))
    let fresh: Id
    ;[now, fresh] = addItem(now, newItem('sticky', { x: 0, y: 300, w: 100, h: 100 }, { text: 'Coimbra' }))
    const c = catchUp(before, now, 1000)!
    expect(c.added).toEqual([fresh])
    expect(c.changed).toEqual([a])
    expect(c.removed.map((i) => i.text)).toEqual(['Faro'])
    expect(c.comments).toEqual([{ id: z, count: 1 }])
    expect(catchUpSummary(c)).toBe('1 new · 1 changed · 1 removed · 1 comment')
    expect(catchUpText(c, now)).toContain('Added: Coimbra')
  })

  it('ignores small nudges and nothing-changed', () => {
    const [before, a] = base()
    expect(catchUp(before, before, 0)).toBeNull()
    const nudged = updateItem(before, a, (i) => ({ ...i, x: i.x + 10 }))
    expect(catchUp(before, nudged, 0)).toBeNull()
    const moved = updateItem(before, a, (i) => ({ ...i, x: i.x + 400 }))
    expect(catchUp(before, moved, 0)!.changed).toEqual([a])
  })
})

describe('who changed it', () => {
  it('signs real changes, not layout nudges or comments', async () => {
    const { addItem, newItem, updateItem } = await import('./board')
    const { stampAuthors, catchUp, catchUpPeople, listNames } = await import('./catchup')
    let b: import('./types').Board = { version: 1, title: 't', items: [], connectors: [], nextId: 1 }
    let a: number, z: number
    ;[b, a] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'one' }))
    ;[b, z] = addItem(b, newItem('sticky', { x: 300, y: 0, w: 100, h: 100 }, { text: 'two' }))
    const start = b
    // Sam edits one note and nudges the other a little.
    let next = updateItem(b, a, (i) => ({ ...i, text: 'one!' }))
    next = updateItem(next, z, (i) => ({ ...i, x: i.x + 5 }))
    next = stampAuthors(b, next, 'Sam')
    expect(next.items.find((i) => i.id === a)!.by).toBe('Sam')
    expect(next.items.find((i) => i.id === z)!.by).toBeUndefined()
    // Alex comments on the second one: comments carry their own author.
    const commented = stampAuthors(next, updateItem(next, z, (i) => ({ ...i, notes: [{ id: 'n1', text: 'hi', at: 1, author: 'Alex' }] })), 'Alex')
    expect(commented.items.find((i) => i.id === z)!.by).toBeUndefined()
    const news = catchUp(start, commented, 0)!
    expect(catchUpPeople(news, commented)).toEqual(['Sam', 'Alex'])
    expect(listNames(['Sam'])).toBe('Sam')
    expect(listNames(['Sam', 'Alex', 'Jo', 'Riley'])).toBe('Sam, Alex and 2 others')
    // Nothing changed: same board back.
    expect(stampAuthors(commented, commented, 'Sam')).toBe(commented)
  })
})

describe('since you were here, in a wiki', () => {
  it('lists new, rewritten and removed pages, and who wrote them', async () => {
    const W = await import('./wiki')
    const { catchUpPeople } = await import('./catchup')
    let before = W.emptyWiki('Trip', 1)
    let plan: string, food: string, beds: string
    ;[before, plan] = W.addPage(before, { title: 'Plan', text: 'Fly' }, 2)
    ;[before, food] = W.addPage(before, { title: 'Food', text: 'Tapas' }, 3)
    ;[before, beds] = W.addPage(before, { title: 'Beds' }, 4)
    let now = W.setPageBody(before, plan, 'Fly, then train', 10, 'Ana')
    now = W.trashPage(now, food, 11)
    let fresh: string
    ;[now, fresh] = W.addPage(now, { title: 'Packing' }, 12, 'Sam')
    const c = catchUp(before, now, 5)!
    expect(c.pages).toEqual({ added: [fresh], changed: [plan], removed: [{ id: food, title: 'Food' }] })
    expect(catchUpSummary(c)).toBe('1 new page · 1 page changed · 1 page removed')
    expect(catchUpPeople(c, now)).toEqual(['Sam', 'Ana'])
    expect(catchUpText(c, now)).toContain('Changed pages: Plan (by Ana)')
    // Nothing new: no news (a rename counts, though).
    expect(catchUp(before, before, 5)).toBeNull()
    expect(catchUp(before, W.setPageMeta(before, beds, { title: 'Sleeping' }), 5)!.pages!.changed).toEqual([beds])
  })
})
