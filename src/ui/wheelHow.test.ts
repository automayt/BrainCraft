import { describe, expect, it } from 'vitest'
import { type WheelLike, newWheelMemo, wheelHow } from './wheelHow'

const ev = (e: Partial<WheelLike>): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false, timeStamp: 0, ...e })

describe('what scrolling does to the board', () => {
  it('zooms with a mouse wheel, in any browser', () => {
    expect(wheelHow(ev({ deltaY: 100, wheelDeltaY: -120 }), newWheelMemo())).toBe('zoom')
    expect(wheelHow(ev({ deltaY: 3, deltaMode: 1 }), newWheelMemo())).toBe('zoom')
    expect(wheelHow(ev({ deltaY: -125, wheelDeltaY: 120 }), newWheelMemo())).toBe('zoom')
  })

  it('moves the board for a two-finger trackpad swipe, for the whole swipe', () => {
    const memo = newWheelMemo()
    expect(wheelHow(ev({ deltaY: 4, wheelDeltaY: -12, timeStamp: 1000 }), memo)).toBe('pan')
    // Later in the same swipe the numbers grow, but it's still the trackpad.
    expect(wheelHow(ev({ deltaY: 60, wheelDeltaY: -180, timeStamp: 1016 }), memo)).toBe('pan')
    expect(wheelHow(ev({ deltaY: 2.5, timeStamp: 3000 }), newWheelMemo())).toBe('pan')
  })

  it('pinches with Ctrl, and pans with Shift or sideways', () => {
    expect(wheelHow(ev({ deltaY: 5, ctrlKey: true }), newWheelMemo())).toBe('pinch')
    expect(wheelHow(ev({ deltaY: 100, shiftKey: true }), newWheelMemo())).toBe('pan')
    expect(wheelHow(ev({ deltaX: 30, deltaY: 2 }), newWheelMemo())).toBe('pan')
  })

  it('tells a mouse from a trackpad again after a pause', () => {
    const memo = newWheelMemo()
    wheelHow(ev({ deltaY: 4, wheelDeltaY: -12, timeStamp: 0 }), memo)
    expect(wheelHow(ev({ deltaY: 100, wheelDeltaY: -120, timeStamp: 2000 }), memo)).toBe('zoom')
  })
})
