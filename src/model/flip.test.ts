import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, getItem, newItem } from './board'
import { flip, isFlipCard, setFlipCard, sides } from './flip'

describe('flip cards', () => {
  it('turns a sticky note into a card with a back, and flips it', () => {
    let b = emptyBoard()
    let id: number, rect: number
    ;[b, id] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'Capital of Peru?' }))
    ;[b, rect] = addItem(b, newItem('rect', { x: 0, y: 0, w: 100, h: 100 }))
    b = setFlipCard(b, [id, rect], true)
    expect(isFlipCard(getItem(b, id)!)).toBe(true)
    expect(getItem(b, rect)!.back).toBeUndefined()
    b = flip(b, [id])
    expect(getItem(b, id)).toMatchObject({ text: '', back: 'Capital of Peru?', flipped: true })
    // Writing on the back is just editing the text while it's showing.
    b = { ...b, items: b.items.map((i) => (i.id === id ? { ...i, text: 'Lima' } : i)) }
    expect(sides(getItem(b, id)!)).toEqual({ front: 'Capital of Peru?', back: 'Lima' })
    b = flip(b, [id])
    expect(getItem(b, id)).toMatchObject({ text: 'Capital of Peru?', back: 'Lima', flipped: false })
  })

  it('keeps the front when the back is taken off', () => {
    let b = emptyBoard()
    let id: number
    ;[b, id] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text: 'Front' }))
    b = flip(setFlipCard(b, [id], true), [id])
    b = setFlipCard(b, [id], false)
    const card = getItem(b, id)!
    expect(card.text).toBe('Front')
    expect('back' in card || 'flipped' in card).toBe(false)
  })
})
