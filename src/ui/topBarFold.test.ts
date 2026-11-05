import { describe, expect, it } from 'vitest'
import { FOLDS, isFolded, refold } from './topBarFold'

/** The bar's width at each level, and the level it settles on for `room`. */
const WIDTHS = [700, 500, 460, 370, 330, 290, 220]
function settle(room: number, from: number, seen: number[]) {
  let level = from
  for (let k = 0; k < 20; k++) {
    const next = refold(level, WIDTHS[level], room, seen)
    if (next === level) return level
    level = next
  }
  throw new Error('It never settled')
}

describe('folding the top bar', () => {
  it('folds only as far as it has to', () => {
    expect(settle(800, 0, [])).toBe(0)
    expect(settle(480, 0, [])).toBe(2)
    expect(settle(300, 0, [])).toBe(5)
  })

  it('comes back as the window widens, and not before it fits', () => {
    const seen: number[] = []
    expect(settle(300, 0, seen)).toBe(5)
    expect(settle(350, 5, seen)).toBe(4)
    expect(settle(349, 4, seen)).toBe(4)
    expect(settle(1000, 4, seen)).toBe(0)
  })

  it('settles even when a remembered width has gone stale', () => {
    const seen = [100, 100]
    expect(settle(480, 2, seen)).toBe(2)
  })

  it('stops at the last step, however little room there is', () => {
    expect(settle(10, 0, [])).toBe(FOLDS.length)
  })

  it('says what has gone at each level', () => {
    expect(isFolded('search', 0)).toBe(false)
    expect(isFolded('search', 1)).toBe(true)
    expect(isFolded('help', 1)).toBe(false)
    expect(isFolded('share', FOLDS.length)).toBe(true)
  })
})
