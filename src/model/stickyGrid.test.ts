import { describe, expect, it } from 'vitest'
import { emptyBoard } from './board'
import { listLines, stickyGrid } from './stickyGrid'

describe('many sticky notes at once', () => {
  it('reads flat lists, with or without bullets', () => {
    expect(listLines('Pegboard wall\nTool chest\n\nLift')).toEqual(['Pegboard wall', 'Tool chest', 'Lift'])
    expect(listLines('- one\n* two\n3. three\n[ ] four\n[x] five')).toEqual(['one', 'two', 'three', 'four', 'five'])
  })

  it('leaves outlines, single lines and prose alone', () => {
    expect(listLines('Root\n  Child')).toBeNull()
    expect(listLines('# Plan\nStep')).toBeNull()
    expect(listLines('Just one line')).toBeNull()
    expect(listLines(`${'This is a long sentence that keeps going. '.repeat(5)}\nAnd another`)).toBeNull()
  })

  it('lays the notes out in a grid around the point', () => {
    const [b, ids] = stickyGrid(emptyBoard(), ['a', 'b', 'c', 'd', 'e'], { x: 0, y: 0 })
    expect(ids).toHaveLength(5)
    const xs = new Set(b.items.map((i) => i.x))
    const ys = new Set(b.items.map((i) => i.y))
    expect([xs.size, ys.size]).toEqual([3, 2])
    expect(b.items.map((i) => i.text)).toEqual(['a', 'b', 'c', 'd', 'e'])
    // Centred: as much to the left of the point as to the right.
    const left = Math.min(...b.items.map((i) => i.x))
    const right = Math.max(...b.items.map((i) => i.x + i.w))
    expect(left + right).toBeCloseTo(0)
  })
})
