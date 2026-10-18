import { describe, expect, it } from 'vitest'
import { merge3 } from './merge'

const lines = (...l: string[]) => l.join('\n')

describe('merging two people’s edits to a page', () => {
  it('keeps both when they changed different lines', () => {
    const base = lines('# Trip', '- Flights', '- Hotel', '- Car')
    const mine = lines('# Trip to Lisbon', '- Flights', '- Hotel', '- Car')
    const theirs = lines('# Trip', '- Flights', '- Hotel', '- Car', '- Insurance')
    expect(merge3(base, mine, theirs)).toBe(lines('# Trip to Lisbon', '- Flights', '- Hotel', '- Car', '- Insurance'))
  })

  it('keeps both versions of a line both changed, mine first', () => {
    const base = lines('a', 'b', 'c')
    expect(merge3(base, lines('a', 'B mine', 'c'), lines('a', 'B theirs', 'c'))).toBe(lines('a', 'B mine', 'B theirs', 'c'))
    // The same change on both sides counts once.
    expect(merge3(base, lines('a', 'same', 'c'), lines('a', 'same', 'c'))).toBe(lines('a', 'same', 'c'))
  })

  it('keeps both lines added at the same place', () => {
    const base = lines('a', 'b')
    expect(merge3(base, lines('a', 'mine', 'b'), lines('a', 'theirs', 'b'))).toBe(lines('a', 'mine', 'theirs', 'b'))
  })

  it('takes one side’s deletion alongside the other’s addition elsewhere', () => {
    const base = lines('one', 'two', 'three', 'four')
    expect(merge3(base, lines('one', 'three', 'four'), lines('one', 'two', 'three', 'four', 'five'))).toBe(lines('one', 'three', 'four', 'five'))
  })

  it('returns the only changed side unchanged', () => {
    expect(merge3('x', 'x', 'y')).toBe('y')
    expect(merge3('x', 'y', 'x')).toBe('y')
  })

  it('copes with big pages quickly', () => {
    const big = Array.from({ length: 5000 }, (_, k) => `line ${k}`)
    const mine = [...big]
    mine[10] = 'mine'
    const theirs = [...big]
    theirs[4000] = 'theirs'
    const t = performance.now()
    const merged = merge3(big.join('\n'), mine.join('\n'), theirs.join('\n')).split('\n')
    expect(performance.now() - t).toBeLessThan(500)
    expect(merged[10]).toBe('mine')
    expect(merged[4000]).toBe('theirs')
  })
})
