import { describe, expect, it } from 'vitest'
import { pressMovesBoard, scrollsItself, wheelIsBoards } from './canvasTakes'

/** A stand-in element: its parent, how it's styled, how much it holds, and what it is. */
interface Fake {
  parentElement: Fake | null
  overflowX: string
  overflowY: string
  scrollHeight: number
  clientHeight: number
  scrollWidth: number
  clientWidth: number
  is: string
  closest(selector: string): Fake | null
}

function el(o: Partial<Omit<Fake, 'closest'>> = {}): Fake {
  const me: Fake = {
    parentElement: null,
    overflowX: 'visible',
    overflowY: 'visible',
    scrollHeight: 100,
    clientHeight: 100,
    scrollWidth: 100,
    clientWidth: 100,
    is: 'div',
    ...o,
    closest(selector) {
      const kinds = selector.split(',').map((s) => s.trim())
      for (let at: Fake | null = me; at; at = at.parentElement) if (kinds.includes(at.is)) return at
      return null
    },
  }
  return me
}

const styled = (e: Element) => e as unknown as Fake
const as = (f: Fake) => f as unknown as Element
const wheel = (o: Partial<{ ctrlKey: boolean; metaKey: boolean; deltaX: number; deltaY: number; shiftKey: boolean }> = {}) => ({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 100, shiftKey: false, ...o })

describe('the wheel over something that keeps the board out', () => {
  // A selected timeline: its body clips what it holds and scrolls nothing.
  const body = el({ overflowX: 'hidden', overflowY: 'hidden' })
  const bar = el({ parentElement: body })

  it('still moves the board when nothing under it scrolls', () => {
    expect(scrollsItself(as(bar), as(body), 0, 100, styled)).toBe(false)
    expect(wheelIsBoards(wheel(), as(bar), as(body), styled)).toBe(true)
    // Clipped is not scrolling, however much it holds.
    const full = el({ overflowY: 'hidden', scrollHeight: 900 })
    expect(wheelIsBoards(wheel(), as(el({ parentElement: full })), as(full), styled)).toBe(true)
  })

  it('leaves the wheel to a list with more than fits, even at its end', () => {
    const column = el({ parentElement: body, overflowY: 'auto', scrollHeight: 700, clientHeight: 300 })
    const card = el({ parentElement: column })
    expect(scrollsItself(as(card), as(body), 0, 100, styled)).toBe(true)
    expect(wheelIsBoards(wheel(), as(card), as(body), styled)).toBe(false)
    expect(wheelIsBoards(wheel({ deltaY: -100 }), as(card), as(body), styled)).toBe(false)
    // Sideways it has nothing to scroll: the board takes that.
    expect(wheelIsBoards(wheel({ deltaX: 60, deltaY: 0 }), as(card), as(body), styled)).toBe(true)
    // Shift turns the wheel sideways.
    expect(wheelIsBoards(wheel({ shiftKey: true }), as(card), as(body), styled)).toBe(true)
    const wide = el({ parentElement: body, overflowX: 'scroll', scrollWidth: 900, clientWidth: 300 })
    expect(wheelIsBoards(wheel({ shiftKey: true }), as(el({ parentElement: wide })), as(body), styled)).toBe(false)
  })

  it('doesn’t count a list that holds no more than fits', () => {
    const column = el({ parentElement: body, overflowY: 'auto', scrollHeight: 300, clientHeight: 300 })
    expect(wheelIsBoards(wheel(), as(el({ parentElement: column })), as(body), styled)).toBe(true)
  })

  it('never looks past the thing keeping the board out', () => {
    const page = el({ overflowY: 'auto', scrollHeight: 5000, clientHeight: 800 })
    const kept = el({ parentElement: page })
    expect(scrollsItself(as(el({ parentElement: kept })), as(kept), 0, 100, styled)).toBe(false)
    // The thing itself counts.
    const scroller = el({ parentElement: page, overflowY: 'scroll', scrollHeight: 900, clientHeight: 200 })
    expect(scrollsItself(as(scroller), as(scroller), 0, 100, styled)).toBe(true)
  })

  it('always gives a pinch to the board', () => {
    const column = el({ parentElement: body, overflowY: 'auto', scrollHeight: 700, clientHeight: 300 })
    expect(wheelIsBoards(wheel({ ctrlKey: true }), as(column), as(body), styled)).toBe(true)
    expect(wheelIsBoards(wheel({ metaKey: true }), as(column), as(body), styled)).toBe(true)
  })
})

describe('a press over something that keeps the board out', () => {
  const body = el()
  const bar = el({ parentElement: body })
  const input = el({ parentElement: body, is: 'input' })
  const inBox = el({ parentElement: el({ parentElement: body, is: 'textarea' }) })
  const none = { space: false, hand: false }
  const mouse = (button: number) => ({ button, pointerType: 'mouse' })

  it('moves the board with the middle and right buttons', () => {
    expect(pressMovesBoard(mouse(1), as(bar), none)).toBe(true)
    expect(pressMovesBoard(mouse(2), as(bar), none)).toBe(true)
    // The left button is the object's own.
    expect(pressMovesBoard(mouse(0), as(bar), none)).toBe(false)
  })

  it('moves it with the left button while Space is held, or with the hand tool out', () => {
    expect(pressMovesBoard(mouse(0), as(bar), { space: true, hand: false })).toBe(true)
    expect(pressMovesBoard(mouse(0), as(bar), { space: false, hand: true })).toBe(true)
  })

  it('leaves a place for typing its own presses, bar the middle button', () => {
    for (const field of [input, inBox]) {
      expect(pressMovesBoard(mouse(2), as(field), none)).toBe(false)
      expect(pressMovesBoard(mouse(0), as(field), { space: true, hand: false })).toBe(false)
      expect(pressMovesBoard(mouse(1), as(field), none)).toBe(true)
    }
  })

  it('leaves fingers to the object', () => {
    expect(pressMovesBoard({ button: 0, pointerType: 'touch' }, as(bar), { space: true, hand: true })).toBe(false)
  })
})
