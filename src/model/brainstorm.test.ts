import { describe, expect, it } from 'vitest'
import { addItem, emptyBoard, getItem, newItem } from './board'
import { maskFor, openRound, reveal, roundStats, stampNew, startBrainstorm } from './brainstorm'

const sticky = (text: string) => newItem('sticky', { x: 0, y: 0, w: 100, h: 100 }, { text })

describe('private brainstorm', () => {
  it('stamps notes written while a round is open, and only then', () => {
    let b = emptyBoard()
    let before = b
    ;[b] = addItem(b, sticky('before the round'))
    expect(stampNew(before, b, 'Sam').items[0].hiddenBy).toBeUndefined()
    let card: number
    ;[b, card] = startBrainstorm(b, { x: 0, y: 0 }, 'Sam', 'Garage layout?')
    expect(openRound(b)?.id).toBe(card)
    before = b
    let note: number
    ;[b, note] = addItem(b, sticky('Pegboard wall'))
    b = stampNew(before, b, 'Sam')
    expect(getItem(b, note)!.hiddenBy).toBe('Sam')
    // Notes that were already there aren't claimed by whoever edits next.
    expect(getItem(stampNew(b, { ...b }, 'Alex'), note)!.hiddenBy).toBe('Sam')
  })

  it('blanks other people’s notes, not your own', () => {
    let b = emptyBoard()
    ;[b] = startBrainstorm(b, { x: 0, y: 0 }, 'Sam')
    let sams: number, alexs: number
    ;[b, sams] = addItem(b, { ...sticky('Sam idea'), hiddenBy: 'Sam' })
    ;[b, alexs] = addItem(b, { ...sticky('Alex idea'), hiddenBy: 'Alex', notes: [{ id: 'n', text: 'spoiler', at: 1 }] })
    const forSam = maskFor(b, 'Sam')
    expect(getItem(forSam, sams)!.text).toBe('Sam idea')
    expect(getItem(forSam, alexs)).toMatchObject({ text: '', masked: true })
    expect(getItem(forSam, alexs)!.notes).toBeUndefined()
    // The real board keeps everything.
    expect(getItem(b, alexs)!.text).toBe('Alex idea')
    expect(roundStats(b)).toEqual({ notes: 2, people: 2 })
    // Nothing to hide: the same board comes back.
    expect(maskFor(emptyBoard(), 'Sam').items).toEqual([])
  })

  it('reveals everything and closes the round', () => {
    let b = emptyBoard()
    let card: number, note: number
    ;[b, card] = startBrainstorm(b, { x: 0, y: 0 }, 'Sam')
    ;[b, note] = addItem(b, { ...sticky('Alex idea'), hiddenBy: 'Alex' })
    b = reveal(b, card)
    expect('hiddenBy' in getItem(b, note)!).toBe(false)
    expect(getItem(b, card)!.brainstorm!.revealed).toBe(true)
    expect(openRound(b)).toBeUndefined()
    expect(maskFor(b, 'Sam')).toBe(b)
  })

  it('shows hidden notes again if the round card is deleted', () => {
    let b = emptyBoard()
    let note: number
    ;[b] = addItem(b, { ...sticky('Alex idea'), hiddenBy: 'Alex' })
    note = b.items[0].id
    expect(getItem(maskFor(b, 'Sam'), note)!.text).toBe('Alex idea')
  })
})

describe('brainstorm rounds', () => {
  it('doesn’t hide notes from an earlier round again, and masks the back too', () => {
    let b = emptyBoard()
    let card1: number, card2: number
    ;[b, card1] = startBrainstorm(b, { x: 0, y: 0 }, 'Sam')
    const before = b
    ;[b] = addItem(b, { ...sticky('round one'), back: 'secret back' })
    b = stampNew(before, b, 'Sam')
    const note = b.items[b.items.length - 1]
    expect(note.hiddenRound).toBe(card1)
    expect(getItem(maskFor(b, 'Alex'), note.id)).toMatchObject({ text: '', masked: true })
    expect(getItem(maskFor(b, 'Alex'), note.id)!.back).toBeUndefined()
    // The first card is deleted without a reveal, then a new round starts.
    b = { ...b, items: b.items.filter((i) => i.id !== card1) }
    ;[b, card2] = startBrainstorm(b, { x: 0, y: 0 }, 'Jo')
    expect(card2).not.toBe(card1)
    expect(getItem(maskFor(b, 'Alex'), note.id)!.text).toBe('round one')
    expect(roundStats(b)).toEqual({ notes: 0, people: 0 })
  })
})
