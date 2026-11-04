import { describe, expect, it } from 'vitest'
import { tiltFor } from './liftedCard'

describe('a lifted card', () => {
  it('leans the way it moves, more when faster, and only so far', () => {
    expect(tiltFor(0)).toBe(0)
    expect(tiltFor(0.3)).toBeGreaterThan(0)
    expect(tiltFor(-0.3)).toBeLessThan(0)
    expect(tiltFor(0.6)).toBeGreaterThan(tiltFor(0.3))
    expect(tiltFor(50)).toBe(7)
    expect(tiltFor(-50)).toBe(-7)
  })
})
