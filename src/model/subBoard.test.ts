import { describe, expect, it } from 'vitest'
import { addItem, connect, emptyBoard, getItem, newItem } from './board'
import { boardOfFrame, frameMembers, withoutFrame } from './subBoard'
import type { Board, Id } from './types'

/** A frame holding two connected notes and half a mind map's worth of a map; a note and a line outside. */
function setup() {
  let b: Board = emptyBoard('Big')
  let frame: Id, a: Id, z: Id, out: Id, root: Id, idea: Id
  ;[b, frame] = addItem(b, newItem('frame', { x: 1000, y: 500, w: 800, h: 600 }, { text: 'Launch' }))
  ;[b, a] = addItem(b, newItem('sticky', { x: 1100, y: 600, w: 200, h: 200 }, { text: 'Inside A' }))
  ;[b, z] = addItem(b, newItem('sticky', { x: 1400, y: 600, w: 200, h: 200 }, { text: 'Inside Z' }))
  ;[b, out] = addItem(b, newItem('sticky', { x: 0, y: 0, w: 200, h: 200 }, { text: 'Outside' }))
  // A mind map whose central idea is in the frame and one idea pokes out of it.
  ;[b, root] = addItem(b, newItem('mind', { x: 1100, y: 900, w: 120, h: 50 }, { text: 'Map' }))
  ;[b, idea] = addItem(b, newItem('mind', { x: 1900, y: 900, w: 120, h: 50 }, { text: 'Far idea', parent: root, side: 'right' }))
  b = connect(b, a, z)[0]
  b = connect(b, out, a)[0]
  b = connect(b, out, z)[0]
  return { b, frame, a, z, out, root, idea }
}

describe('a frame moved to a board of its own', () => {
  it('takes the frame, what’s in it and whole mind maps', () => {
    const { b, frame, a, z, out, root, idea } = setup()
    expect(frameMembers(b, frame)).toEqual(new Set([frame, a, z, root, idea]))
    expect(frameMembers(b, out).size).toBe(0)
  })

  it('makes a board of them, the frame at the top left, with the lines between them', () => {
    const { b, frame, a, z } = setup()
    const part = boardOfFrame(b, frame)!
    expect(part.title).toBe('Launch')
    expect(part.items).toHaveLength(5)
    expect(getItem(part, frame)).toMatchObject({ x: 0, y: 0 })
    expect(getItem(part, a)).toMatchObject({ x: 100, y: 100 })
    expect(part.connectors.map((c) => [c.from, c.to])).toEqual([[a, z]])
    expect(part.nextId).toBe(b.nextId)
    // With the way back: a card above the frame, linking to the board it came from.
    const back = boardOfFrame(b, frame, { key: 'BIG', title: 'Big' })!
    const card = back.items.find((i) => i.linkTo)!
    expect(card).toMatchObject({ id: b.nextId, y: -150, linkTo: { board: 'BIG', label: 'Big' } })
    expect(card.text).toBe('↩ Back to Big')
    expect(back.nextId).toBe(b.nextId + 1)
  })

  it('leaves a card linking there, with lines from outside ending at it once', () => {
    const { b, frame, out } = setup()
    const { board, card } = withoutFrame(b, frame, 'NEWBOARD123')!
    expect(board.items.map((i) => i.text)).toEqual(['Outside', expect.stringContaining('Launch')])
    expect(getItem(board, card)).toMatchObject({ x: 1000, y: 500, linkTo: { board: 'NEWBOARD123', label: 'Launch' } })
    expect(getItem(board, card)!.text).toContain('4 objects')
    // Two lines from Outside into the frame become one to the card.
    expect(board.connectors.map((c) => [c.from, c.to])).toEqual([[out, card]])
    expect(board.nextId).toBe(card + 1)
  })

  it('does nothing for something that isn’t a frame', () => {
    const { b, out } = setup()
    expect(boardOfFrame(b, out)).toBeNull()
    expect(withoutFrame(b, out, 'x')).toBeNull()
  })
})
