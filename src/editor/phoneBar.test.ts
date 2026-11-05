import { describe, expect, it, vi } from 'vitest'
import * as B from '../model/board'
import { emptyBoard } from '../model/board'
import { fakeMeasure } from '../model/test-helpers'
import { Editor } from './Editor'

/** A phone's view of one 100 × 60 box with its top edge at `y`, and where the board would slide to. */
function slide(y: number, h = 60) {
  const [b, id] = B.addItem(emptyBoard(), B.newItem('rect', { x: 20, y, w: 100, h }))
  const e = new Editor(b, fakeMeasure)
  e.viewport = { w: 375, h: 700 }
  e.camera = { x: 0, y: 0, zoom: 1 }
  e.select([id])
  const fly = vi.spyOn(e, 'flyTo').mockImplementation(() => {})
  e.keepSelectionClear()
  return fly.mock.calls[0]?.[0].y
}

describe('the selection on a phone', () => {
  it('stays put when the bottom bars leave it clear', () => {
    expect(slide(300)).toBeUndefined()
    expect(slide(500, 68)).toBeUndefined()
  })

  it('slides up from under them', () => {
    expect(slide(560)).toBe(-52)
  })

  it('stops short of the top bars when it is too tall to clear them', () => {
    expect(slide(200, 490)).toBe(-84)
  })

  it('slides for a line too', () => {
    const [b, p] = B.addItem(emptyBoard(), B.newItem('rect', { x: 20, y: 300, w: 100, h: 60 }))
    const [c, q] = B.addItem(b, B.newItem('rect', { x: 20, y: 620, w: 100, h: 60 }))
    const [linked, line] = B.connect(c, p, q)
    const e = new Editor(linked, fakeMeasure)
    e.viewport = { w: 375, h: 700 }
    e.camera = { x: 0, y: 0, zoom: 1 }
    e.selectedConnector = line!
    const fly = vi.spyOn(e, 'flyTo').mockImplementation(() => {})
    e.keepSelectionClear()
    expect(fly).toHaveBeenCalledOnce()
  })
})
