import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, newItem } from './board'
import { addNote } from './notes'
import { slides, startSlide } from './slides'
import type { Board } from './types'

function frame(b: Board, text: string, x: number, y: number, w = 400, h = 300): [Board, number] {
  return addItem(b, newItem('frame', { x, y, w, h }, { text }))
}

describe('slides', () => {
  it('orders frames in rows, top to bottom and left to right', () => {
    let b = emptyBoard()
    ;[b] = frame(b, 'Four', 500, 420)
    ;[b] = frame(b, 'Two', 500, 10)
    ;[b] = frame(b, 'One', 0, 0)
    ;[b] = frame(b, 'Three', 0, 400)
    expect(slides(b).map((s) => s.title)).toEqual(['One', 'Two', 'Three', 'Four'])
  })

  it('leaves room for the frame title and carries comments as notes', () => {
    let b = emptyBoard()
    let id: number
    ;[b, id] = frame(b, 'Intro', 0, 0)
    b = addNote(b, id, 'Mention the pilot results')
    const [s] = slides(b)
    expect(s.rect.y).toBeLessThan(0)
    expect(s.rect.h).toBeGreaterThan(300)
    expect(s.notes).toEqual(['Mention the pilot results'])
  })

  it('treats a board without frames as one slide', () => {
    let b = emptyBoard('Loose ideas')
    ;[b] = addItem(b, newItem('sticky', { x: 10, y: 10, w: 100, h: 100 }))
    const list = slides(b)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ title: 'Loose ideas', notes: [] })
    expect(list[0].id).toBeUndefined()
    expect(slides(emptyBoard())).toEqual([])
  })

  it('starts on the selected frame or the frame around the selection', () => {
    let b = emptyBoard()
    let note: number, second: number
    ;[b] = frame(b, 'One', 0, 0)
    ;[b, second] = frame(b, 'Two', 500, 0)
    ;[b, note] = addItem(b, newItem('sticky', { x: 550, y: 50, w: 100, h: 100 }))
    const list = slides(b)
    expect(startSlide(b, list, [second])).toBe(1)
    expect(startSlide(b, list, [note])).toBe(1)
    expect(startSlide(b, list, [])).toBe(0)
  })
})
