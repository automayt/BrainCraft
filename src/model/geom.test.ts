import { describe, expect, it } from 'vitest'
import { distToSegment, ellipseBorderPoint, ellipseContains, rectBorderPoint, remap } from './geom'

describe('geom', () => {
  it('measures distance to a segment', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(distToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(distToSegment({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(Math.SQRT2)
  })

  it('finds where rays leave rectangles and ellipses', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 }
    expect(rectBorderPoint(r, { x: 200, y: 25 })).toEqual({ x: 100, y: 25 })
    expect(rectBorderPoint(r, { x: 50, y: -100 })).toEqual({ x: 50, y: 0 })
    const p = ellipseBorderPoint(r, { x: 500, y: 25 })
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(25)
    expect(ellipseContains(r, { x: 50, y: 25 })).toBe(true)
    expect(ellipseContains(r, { x: 2, y: 2 })).toBe(false)
  })

  it('remaps points between rectangles', () => {
    expect(remap({ x: 5, y: 5 }, { x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 20, h: 40 })).toEqual({ x: 110, y: 120 })
  })
})
